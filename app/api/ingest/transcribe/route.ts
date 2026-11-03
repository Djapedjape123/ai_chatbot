import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { transcribeFormInput, transcribeFormSchema } from '@/lib/validation';
import { enforceIpBurst, reserveUsage, releaseUsage, type ActualTokens } from '@/lib/usage';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { describeRejection } from '@/lib/upload-rejection';
import { buildTranscriptionPrompt } from '@/lib/prompts';
import { estimateTokens } from '@/lib/limits';
import { getClaudeModel, parseClaudeResponse } from '@/lib/claude';
import {
  TRANSCRIBE_MAX_OUTPUT_TOKENS,
  buildImageUserContent,
  estimateImageTokens,
  estimateTranscriptionTokens,
  inspectImages,
  parseTranscription,
} from '@/lib/chat-images';

// Jedna strana po zahtevu: Claude prepis traje do ~30 s
export const maxDuration = 60;
const CLAUDE_TIMEOUT_MS = 45_000;

// Prepis jedne strane slikanog dokumenta (Faza 3.5). Vraća SAMO tekst; ništa se ne upisuje u bazu i slika se ne
// čuva. Advokat pregleda i ispravlja prepis, pa ga šalje na /api/ingest/text, gde se dokument tek broji.
//
// Potrošnja bez migracije (plan, odluka 7): rezervacija je vrste 'ingest' (advokat na dnevnom limitu dokumenata
// dobija 429 PRE plaćanja prepisa), a zatvara se UVEK kao release sa stvarnim tokenima: tokeni ulaze u budžet,
// a dokument se ne broji. Broji se jednom, pri indeksiranju.
export async function POST(req: Request) {
  let reservation: { id: string; userId: string } | null = null;
  const spent: ActualTokens = {};

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
    const parsed = transcribeFormSchema.safeParse(transcribeFormInput(formData));
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400, 'invalid_request');
    }
    const { image } = parsed.data;

    // 1. Slika po SADRŽAJU (samo JPEG), bez metapodataka. Odbijanje ne troši ledger; u audit ide razlog,
    //    bez slike i bez naziva fajla.
    const checked = inspectImages([new Uint8Array(await image.arrayBuffer())]);
    if (!checked.ok) {
      const d = describeRejection(checked.rejection, 'image');
      if (d.audit) {
        await logAudit(actor, 'document_upload_blocked', {
          ip,
          metadata: { ...d.audit, file_kind: 'image', context: 'transcribe', size_bytes: image.size },
        });
      }
      return apiError(d.message, d.status, d.code);
    }
    const [page] = checked.images;

    // 2. Rezervacija (dnevni broj dokumenata + budžet tokena). Fail-closed.
    const reserved = await reserveUsage(actor, 'ingest', estimateTranscriptionTokens(page.width, page.height), ip);
    if (!reserved.ok) return reserved.errorResponse;
    reservation = { id: reserved.reservationId, userId: user.id };

    // 3. Claude prepisuje stranu. Zahtev ide na Claude: i ako se prekine, ulaz je verovatno obrađen, pa procena
    //    ulaza ostaje u budžetu (isto kao /api/chat).
    const systemPrompt = buildTranscriptionPrompt();
    const userText = 'Prepiši tekst sa ove strane.';
    const estimatedInputTokens = estimateTokens(systemPrompt + userText) + estimateImageTokens(page.width, page.height);
    spent.input = estimatedInputTokens;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
    let claudeRes: Response;
    try {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY as string,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: getClaudeModel(),
          max_tokens: TRANSCRIBE_MAX_OUTPUT_TOKENS,
          system: systemPrompt,
          messages: [{ role: 'user', content: buildImageUserContent([page], userText) }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!claudeRes.ok) {
      console.error('Transcribe Claude API Error:', await claudeRes.text());
      spent.input = undefined; // API je odbio zahtev bez obrade, pa nema potrošnje
      return apiError('Greška na AI servisu pri prepisu strane. Pokušajte ponovo.', 500, 'ai_service_error');
    }

    const claude = parseClaudeResponse(await claudeRes.json());
    if (!claude) {
      console.error('Transcribe Claude API Error: neočekivan oblik odgovora');
      return apiError('Greška na AI servisu pri prepisu strane. Pokušajte ponovo.', 500, 'ai_service_error');
    }
    spent.input = claude.inputTokens ?? estimatedInputTokens;
    spent.output = claude.outputTokens ?? estimateTokens(claude.answer);

    if (claude.stopReason === 'refusal') {
      return apiError('AI servis nije mogao da prepiše ovu stranu. Slikajte je ponovo.', 422, 'transcription_refused');
    }
    const text = parseTranscription(claude.answer);
    if (text === null) {
      return apiError('Na slici nije pronađen tekst. Slikajte stranu dokumenta ponovo, izbliza i pri dobrom svetlu.', 422, 'no_text');
    }

    // Prepis prekinut na granici izlaza: tekst se vraća, a advokat dobija upozorenje da proveri kraj strane
    return NextResponse.json({ text, truncated: claude.stopReason === 'max_tokens' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return apiError('AI servis ne odgovara na vreme. Pokušajte ponovo.', 504, 'ai_timeout');
    }
    console.error('Transcribe Exception:', error);
    return apiError('Interna greška prilikom prepisa strane.', 500, 'internal_error');
  } finally {
    // Uvek release: prepis ne troši dnevni broj dokumenata, a potrošeni tokeni ostaju u budžetu
    if (reservation) await releaseUsage(reservation.id, reservation.userId, spent);
  }
}
