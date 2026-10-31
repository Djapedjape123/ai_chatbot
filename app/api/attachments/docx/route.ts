import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { attachmentFormInput, attachmentFormSchema } from '@/lib/validation';
import { enforceIpBurst } from '@/lib/usage';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { detectFileType } from '@/lib/file-type';
import { readFileInWorker } from '@/lib/file-read';
import { describeRejection, type UploadRejection } from '@/lib/upload-rejection';

// Čitanje fajla ide u worker nit sa ograničenjem od 20 s
export const maxDuration = 60;

// Word prilog uz pitanje (Faza 3): isti pregled kao za dokument u bazi znanja (tip po sadržaju, aktivan sadržaj,
// zip bomba, vreme čitanja), ali se NIŠTA ne čuva i ne šalje van servera: vraća se samo tekst, koji pregledač
// lepi u pitanje. Zato nema rezervacije u ledger-u (nema Voyage ni Claude poziva); od poplave štiti IP burst.
export async function POST(req: Request) {
  try {
    // 0. IP burst zaštita pre autentifikacije i čitanja tela (isto kao /api/ingest)
    const ip = getClientIp(req.headers);
    const burstBlock = await enforceIpBurst(ip);
    if (burstBlock) return burstBlock;

    const { user, errorResponse } = await requireUser();
    if (!user) return errorResponse!;
    const actor = { id: user.id, email: user.email };

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return apiError('Neispravan zahtev.', 400, 'invalid_request');
    }
    const parsed = attachmentFormSchema.safeParse(attachmentFormInput(formData));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
    }
    const { file } = parsed.data;

    // Odbijanje ide u audit kao blokirano otpremanje sa oznakom konteksta, bez naziva fajla i sadržaja
    const reject = async (rejection: UploadRejection, fileKind?: 'pdf' | 'docx') => {
      const d = describeRejection(rejection, 'attachment');
      if (d.audit) {
        await logAudit(actor, 'document_upload_blocked', {
          ip,
          metadata: { ...d.audit, context: 'attachment', ...(fileKind ? { file_kind: fileKind } : {}), size_bytes: file.size },
        });
      } else {
        console.error('Prilog: čitanje fajla nije uspelo:', rejection.reason);
      }
      return apiError(d.message, d.status, d.code);
    };

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = detectFileType(bytes);
    // Za prilog je podržan samo Word: PDF i sve nepoznato se odbija kao nepodržan tip
    if (kind === 'pdf' || kind === 'unknown') return reject({ ok: false, reason: 'unsupported_type' });
    if (kind === 'legacy_doc' || kind === 'encrypted_office') return reject({ ok: false, reason: kind });

    const read = await readFileInWorker({ kind: 'docx', bytes });
    if (!read.ok) return reject(read, 'docx');

    if (read.text.trim().length === 0) {
      await logAudit(actor, 'document_upload_blocked', {
        ip,
        metadata: { reason: 'no_text', context: 'attachment', file_kind: 'docx', size_bytes: file.size },
      });
      return apiError('Word dokument ne sadrži tekst.', 400, 'no_text');
    }

    return NextResponse.json({ text: read.text });
  } catch (error) {
    console.error('Attachment Exception:', error);
    return apiError('Interna greška prilikom čitanja priloga.', 500, 'internal_error');
  }
}
