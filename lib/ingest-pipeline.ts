import 'server-only';
import { NextResponse } from 'next/server';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { supabaseAdmin } from '@/lib/supabase';
import { apiError } from '@/lib/api-error';
import { reserveUsage, settleUsage, releaseUsage, type ActualTokens } from '@/lib/usage';
import { logAudit, type AuditActor } from '@/lib/audit';
import { parseVoyageBatchResponse } from '@/lib/claude';
import {
  INGEST_BATCH_SIZE,
  INGEST_CHUNK_OVERLAP,
  INGEST_CHUNK_SIZE,
  INGEST_MAX_CHUNKS,
  estimateIngestTokens,
  findSuspiciousUpload,
  suspiciousUploadMessage,
} from '@/lib/ingest';

// Indeksiranje već pročitanog teksta u bazu znanja: pasusi → detekcija sumnjivog sadržaja (409) → rezervacija →
// upis dokumenta → Voyage po paketima → rollback pri grešci → audit. Zajedničko za /api/ingest (PDF i Word) i
// /api/ingest/text (prepis slikanog dokumenta, Faza 3.5). Pozivalac je već proverio IP burst, prijavu i fajl.

export type IndexDocumentInput = {
  actor: AuditActor;
  ip: string | null;
  // Već očišćen naziv (sanitizeTitle)
  title: string;
  text: string;
  acknowledge: boolean;
  fileKind: 'pdf' | 'docx' | 'image';
  sizeBytes: number;
  // Broj strana slikanog dokumenta (ide u audit document_uploaded)
  pages?: number;
};

// Greška sa porukom koja sme da stigne do korisnika (sve ostalo dobija opštu poruku)
class IngestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function indexDocumentText(input: IndexDocumentInput): Promise<NextResponse> {
  const { actor, ip, title, text, acknowledge, fileKind, sizeBytes, pages } = input;
  // Rezervacija iz usage ledger-a MORA biti zatvorena na svakom izlazu (vidi finally):
  // inače ostaje 'reserved' i troši korisnikov limit po proceni.
  let reservation: { id: string; userId: string } | null = null;
  let closed = false;
  const spent: ActualTokens = {};
  const addEmbedTokens = (n: number) => {
    spent.embed = (spent.embed ?? 0) + n;
  };
  const pageMeta: Record<string, number> = pages !== undefined ? { pages } : {};

  try {
    // 2. Pasusi. Zid za ogromne dokumente važi PRE upisa, pa nema šta da se poništava.
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: INGEST_CHUNK_SIZE,
      chunkOverlap: INGEST_CHUNK_OVERLAP,
    });
    const chunkTexts = (await textSplitter.createDocuments([text])).map((d) => d.pageContent);

    if (chunkTexts.length > INGEST_MAX_CHUNKS) {
      await logAudit(actor, 'document_upload_blocked', {
        ip,
        metadata: { reason: 'too_many_chunks', chunks: chunkTexts.length, file_kind: fileKind, size_bytes: sizeBytes },
      });
      return apiError(
        `Dokument je prevelik za obradu. Ograničen je na ${INGEST_MAX_CHUNKS} pasusa, a ovaj ima ${chunkTexts.length}.`,
        400,
        'too_many_chunks'
      );
    }

    // 3. Sumnjiv sadržaj: upozorenje bez indeksiranja i bez potrošnje. Korisnik odlučuje i šalje ponovo
    //    sa acknowledge=true. U audit idu samo oznake obrazaca, nikad delovi teksta.
    const suspicious = findSuspiciousUpload(title, text);
    if (suspicious.suspicious && !acknowledge) {
      await logAudit(actor, 'suspicious_content_flagged', {
        ip,
        metadata: { patterns: suspicious.patterns, acknowledged: false, size_bytes: sizeBytes },
      });
      return apiError(suspiciousUploadMessage(suspicious.patterns), 409, 'suspicious_content');
    }

    // 4. Atomska rezervacija (20 dokumenata dnevno + budžet tokena za Voyage). Fail-closed.
    const reserved = await reserveUsage(actor, 'ingest', estimateIngestTokens(chunkTexts), ip);
    if (!reserved.ok) return reserved.errorResponse;
    reservation = { id: reserved.reservationId, userId: actor.id };

    // 5. Upisujemo ZAGLAVLJE dokumenta u bazu (upisi idu preko service_role, sa user_id iz verifikovanog korisnika)
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({ title, user_id: actor.id })
      .select('id')
      .single();

    if (docError || !document) {
      console.error('Supabase Error (documents):', docError);
      return apiError('Greška pri čuvanju dokumenata u bazu.', 500, 'document_create_failed');
    }

    // --- 6. ROLLBACK MEHANIZAM (Zaštita od polovično obrađenih dokumenata) ---
    try {
      // Slanje na Voyage AI u paketićima
      for (let i = 0; i < chunkTexts.length; i += INGEST_BATCH_SIZE) {
        const batch = chunkTexts.slice(i, i + INGEST_BATCH_SIZE);

        // Zahtev ide na Voyage: i ako se prekine (timeout, mreža), servis je paket verovatno već obradio.
        // Procena paketa zato ide u potrošnju odmah; briše se samo kad API izričito odbije zahtev.
        const batchEstimate = estimateIngestTokens(batch);
        addEmbedTokens(batchEstimate);

        // Timeout zaštita (15 sekundi max po paketu)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        let voyageRes: Response;
        try {
          voyageRes = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
            },
            body: JSON.stringify({ input: batch, model: 'voyage-law-2' }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (!voyageRes.ok) {
          console.error('Voyage API Error:', await voyageRes.text());
          addEmbedTokens(-batchEstimate);
          throw new IngestError('Greška u komunikaciji sa AI servisom za vektore.', 'embedding_failed');
        }

        // Svaki pasus mora da dobije svoj vektor: neispravan oblik odgovora ne sme u bazu
        const voyage = parseVoyageBatchResponse(await voyageRes.json(), batch.length);
        if (!voyage) {
          console.error('Voyage API Error: neočekivan oblik odgovora');
          throw new IngestError('Greška u komunikaciji sa AI servisom za vektore.', 'embedding_failed');
        }
        // Stvarna potrošnja iz odgovora. Ako API ne vrati broj, ostaje procena (nula bi zaobišla budžet).
        addEmbedTokens((voyage.tokens ?? batchEstimate) - batchEstimate);

        // Priprema i upis pasusa i vektora
        const insertData = batch.map((content, index) => ({
          document_id: document.id,
          user_id: actor.id,
          content,
          embedding: voyage.embeddings[index],
        }));

        const { error: chunkError } = await supabaseAdmin.from('document_chunks').insert(insertData);

        if (chunkError) {
          console.error('Supabase Error (document_chunks):', chunkError);
          throw new IngestError('Greška pri upisu vektora u bazu podataka.', 'chunk_insert_failed');
        }
      }

      // 7. Zatvaranje rezervacije stvarnom potrošnjom
      await settleUsage(reservation.id, actor.id, spent);
      closed = true;

      // 8. Audit: ko je otpremio dokument (ID i brojevi, nikad naziv ni tekst)
      await logAudit(actor, 'document_uploaded', {
        resourceType: 'document',
        resourceId: document.id,
        ip,
        metadata: {
          chunks: chunkTexts.length,
          file_kind: fileKind,
          ...pageMeta,
          size_bytes: sizeBytes,
          embed_tokens: spent.embed ?? 0,
          suspicious: suspicious.suspicious,
        },
      });
      if (suspicious.suspicious) {
        await logAudit(actor, 'suspicious_content_flagged', {
          resourceType: 'document',
          resourceId: document.id,
          ip,
          metadata: { patterns: suspicious.patterns, acknowledged: true, size_bytes: sizeBytes },
        });
      }

      return NextResponse.json({
        success: true,
        documentId: document.id,
        message: `Uspešno indeksiran dokument "${title}"! Ukupno pasusa: ${chunkTexts.length}`,
      });
    } catch (innerError) {
      // ROLLBACK: Brisanje nekompletnog dokumenta iz baze ukoliko se desila bilo kakva greška!
      console.error('Proces obrade prekinut. Pokrećem rollback...', innerError);
      const { error: rollbackError } = await supabaseAdmin
        .from('documents')
        .delete()
        .eq('id', document.id)
        .eq('user_id', actor.id);
      if (rollbackError) console.error('Rollback Error:', rollbackError);

      if (innerError instanceof IngestError) {
        return apiError(innerError.message, 500, innerError.code);
      }
      if (innerError instanceof Error && innerError.name === 'AbortError') {
        return apiError('AI servis za vektore ne odgovara na vreme. Pokušajte ponovo.', 504, 'embedding_timeout');
      }
      return apiError('Došlo je do greške pri obradi fajla.', 500, 'ingest_failed');
    }
  } catch (error) {
    console.error('Ingestion Exception:', error);
    return apiError('Interna greška prilikom uvoza fajla.', 500, 'internal_error');
  } finally {
    // Svaki neuspeh posle rezervacije: ne broji se u dnevni limit, a već potrošeni tokeni ostaju u budžetu
    if (reservation && !closed) {
      await releaseUsage(reservation.id, reservation.userId, spent);
    }
  }
}
