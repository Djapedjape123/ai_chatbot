import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { transcriptIngestSchema } from '@/lib/validation';
import { sanitizeTitle } from '@/lib/rag-context';
import { enforceIpBurst } from '@/lib/usage';
import { getClientIp } from '@/lib/client-ip';
import { indexDocumentText } from '@/lib/ingest-pipeline';

// Do 40.000 znakova je najviše ~50 pasusa, odnosno 2 poziva Voyage-a (po 15 s)
export const maxDuration = 60;

// Indeksiranje prepisa slikanog dokumenta (Faza 3.5). Prepis je napravio /api/ingest/transcribe, a advokat ga je
// pregledao i možda ispravio. Odavde ide isti put kao PDF: pasusi, detekcija sumnjivog sadržaja (409 sa
// „Ipak dodaj”), rezervacija (ovde se dokument broji u dnevni limit), upis, Voyage, audit sa file_kind 'image'.
export async function POST(req: Request) {
  try {
    // 0. IP burst zaštita pre autentifikacije i čitanja tela
    const ip = getClientIp(req.headers);
    const burstBlock = await enforceIpBurst(ip);
    if (burstBlock) return burstBlock;

    const { user, errorResponse } = await requireUser();
    if (!user) return errorResponse!;
    const actor = { id: user.id, email: user.email };

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError('Neispravan zahtev.', 400, 'invalid_request');
    }
    const parsed = transcriptIngestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
    }
    const { text, pages, acknowledge } = parsed.data;
    // Naziv bira korisnik, a ulazi u kontekst za AI: čistimo ga pre upisa
    const title = sanitizeTitle(parsed.data.title);

    return await indexDocumentText({
      actor,
      ip,
      title,
      text,
      acknowledge,
      fileKind: 'image',
      sizeBytes: new TextEncoder().encode(text).byteLength,
      pages,
    });
  } catch (error) {
    console.error('Transcript Ingest Exception:', error);
    return apiError('Interna greška prilikom uvoza prepisa.', 500, 'internal_error');
  }
}
