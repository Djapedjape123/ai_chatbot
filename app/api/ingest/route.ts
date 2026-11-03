import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { ingestFormInput, ingestFormSchema } from '@/lib/validation';
import { sanitizeTitle } from '@/lib/rag-context';
import { enforceIpBurst } from '@/lib/usage';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { detectFileType } from '@/lib/file-type';
import { readFileInWorker } from '@/lib/file-read';
import { describeRejection, type UploadRejection } from '@/lib/upload-rejection';
import { indexDocumentText } from '@/lib/ingest-pipeline';

// Čitanje fajla (do 20 s) + do 17 poziva Voyage-a (po 15s timeout) ne staje u podrazumevani limit funkcije
export const maxDuration = 60;

export async function POST(req: Request) {
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

    // 2-8. Pasusi, sumnjiv sadržaj (409), rezervacija, upis, Voyage, audit: lib/ingest-pipeline.ts
    return await indexDocumentText({ actor, ip, title, text: rawText, acknowledge, fileKind: kind, sizeBytes: file.size });
  } catch (error) {
    console.error('Ingestion Exception:', error);
    return apiError('Interna greška prilikom uvoza fajla.', 500, 'internal_error');
  }
}
