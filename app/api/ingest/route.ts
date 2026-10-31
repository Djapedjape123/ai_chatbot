import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { ingestFormInput, ingestFormSchema } from '@/lib/validation';
import { sanitizeTitle } from '@/lib/rag-context';
import { enforceIpBurst, reserveUsage, settleUsage, releaseUsage, type ActualTokens } from '@/lib/usage';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { parseVoyageBatchResponse } from '@/lib/claude';
import { detectFileType } from '@/lib/file-type';
import { readFileInWorker } from '@/lib/file-read';
import { describeRejection, type UploadRejection } from '@/lib/upload-rejection';
import {
  INGEST_BATCH_SIZE,
  INGEST_CHUNK_OVERLAP,
  INGEST_CHUNK_SIZE,
  INGEST_MAX_CHUNKS,
  estimateIngestTokens,
  findSuspiciousUpload,
  suspiciousUploadMessage,
} from '@/lib/ingest';

// Čitanje fajla (do 20 s) + do 17 poziva Voyage-a (po 15s timeout) ne staje u podrazumevani limit funkcije
export const maxDuration = 60;

// Greška sa porukom koja sme da stigne do korisnika (sve ostalo dobija opštu poruku)
class IngestError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function POST(req: Request) {
  // Rezervacija iz usage ledger-a MORA biti zatvorena na svakom izlazu (vidi finally):
  // inače ostaje 'reserved' i troši korisnikov limit po proceni.
  let reservation: { id: string; userId: string } | null = null;
  let closed = false;
  const spent: ActualTokens = {};
  const addEmbedTokens = (n: number) => {
    spent.embed = (spent.embed ?? 0) + n;
  };

  try {
    // 0. IP burst zaštita (pre autentifikacije i parsiranja tela: poplava zahteva i ponovljena neispravna
    //    otpremanja ne smeju da pune audit log ni da troše CPU na PDF-ovima)
    const ip = getClientIp(req.headers);
    const burstBlock = await enforceIpBurst(ip);
    if (burstBlock) return burstBlock;

    // 0.2 Autentifikacija (pre bilo kakvog parsiranja tela)
    const { user, errorResponse } = await requireUser();
    if (!user) return errorResponse!;
    const actor = { id: user.id, email: user.email };

    // 0.5 Validacija (zod): fajl je obavezan, ne prazan i najviše 4MB; acknowledge je 'true' ili 'false'. Tip se ne
    //     proverava ovde: ime i MIME dolaze od korisnika, pa tip određuje sadržaj fajla (korak 1).
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError('Neispravan zahtev.', 400, 'invalid_request');
    }
    const parsed = ingestFormSchema.safeParse(ingestFormInput(formData));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
    }
    const { file, acknowledge } = parsed.data;

    // Ime fajla bira korisnik, a ulazi u kontekst za AI: čistimo ga pre upisa
    const title = sanitizeTitle(file.name);

    // 1. Tip fajla po SADRŽAJU (magični bajtovi), pa čitanje u worker niti sa ograničenjem vremena: provera
    //    aktivnog sadržaja i zip bombi, granice (strane, veličina) i izvlačenje teksta. Odbijanje je greška korisnika
    //    (400) i ne troši ledger (rezervacija je tek posle); razlog ide u audit, bez naziva fajla i sadržaja.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = detectFileType(bytes);
    const reject = async (rejection: UploadRejection, fileKind?: 'pdf' | 'docx') => {
      const d = describeRejection(rejection);
      if (d.audit) {
        await logAudit(actor, 'document_upload_blocked', {
          ip,
          metadata: { ...d.audit, ...(fileKind ? { file_kind: fileKind } : {}), size_bytes: file.size },
        });
      } else {
        console.error('Ingest: čitanje fajla nije uspelo:', rejection.reason);
      }
      return apiError(d.message, d.status, d.code);
    };

    if (kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });
    if (kind === 'legacy_doc' || kind === 'encrypted_office') return reject({ ok: false, reason: kind });

    const read = await readFileInWorker({ kind, bytes });
    if (!read.ok) return reject(read, kind);
    const rawText = read.text;

    if (rawText.trim().length === 0) {
      await logAudit(actor, 'document_upload_blocked', { ip, metadata: { reason: 'no_text', file_kind: kind, size_bytes: file.size } });
      return apiError(
        kind === 'pdf' ? 'PDF ne sadrži tekst ili je skenirana slika (potreban je OCR).' : 'Word dokument ne sadrži tekst.',
        400,
        'no_text'
      );
    }

    // 2. Pasusi. Zid za ogromne dokumente važi PRE upisa, pa nema šta da se poništava.
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: INGEST_CHUNK_SIZE,
      chunkOverlap: INGEST_CHUNK_OVERLAP,
    });
    const chunkTexts = (await textSplitter.createDocuments([rawText])).map((d) => d.pageContent);

    if (chunkTexts.length > INGEST_MAX_CHUNKS) {
      await logAudit(actor, 'document_upload_blocked', {
        ip,
        metadata: { reason: 'too_many_chunks', chunks: chunkTexts.length, file_kind: kind, size_bytes: file.size },
      });
      return apiError(
        `Dokument je prevelik za obradu. Ograničen je na ${INGEST_MAX_CHUNKS} pasusa, a ovaj ima ${chunkTexts.length}.`,
        400,
        'too_many_chunks'
      );
    }

    // 3. Sumnjiv sadržaj: upozorenje bez indeksiranja i bez potrošnje. Korisnik odlučuje i šalje ponovo
    //    sa acknowledge=true. U audit idu samo oznake obrazaca, nikad delovi teksta.
    const suspicious = findSuspiciousUpload(title, rawText);
    if (suspicious.suspicious && !acknowledge) {
      await logAudit(actor, 'suspicious_content_flagged', {
        ip,
        metadata: { patterns: suspicious.patterns, acknowledged: false, size_bytes: file.size },
      });
      return apiError(suspiciousUploadMessage(suspicious.patterns), 409, 'suspicious_content');
    }

    // 4. Atomska rezervacija (20 dokumenata dnevno + budžet tokena za Voyage). Fail-closed.
    const reserved = await reserveUsage(actor, 'ingest', estimateIngestTokens(chunkTexts), ip);
    if (!reserved.ok) return reserved.errorResponse;
    reservation = { id: reserved.reservationId, userId: user.id };

    // 5. Upisujemo ZAGLAVLJE dokumenta u bazu (upisi idu preko service_role, sa user_id iz verifikovanog korisnika)
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .insert({ title, user_id: user.id })
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
          user_id: user.id,
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
      await settleUsage(reservation.id, user.id, spent);
      closed = true;

      // 8. Audit: ko je otpremio dokument (ID i brojevi, nikad naziv ni tekst)
      await logAudit(actor, 'document_uploaded', {
        resourceType: 'document',
        resourceId: document.id,
        ip,
        metadata: {
          chunks: chunkTexts.length,
          file_kind: kind,
          size_bytes: file.size,
          embed_tokens: spent.embed ?? 0,
          suspicious: suspicious.suspicious,
        },
      });
      if (suspicious.suspicious) {
        await logAudit(actor, 'suspicious_content_flagged', {
          resourceType: 'document',
          resourceId: document.id,
          ip,
          metadata: { patterns: suspicious.patterns, acknowledged: true, size_bytes: file.size },
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
        .eq('user_id', user.id);
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
