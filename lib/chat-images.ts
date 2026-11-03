// Slike uz pitanje u /api/chat (Faza 3.5): provera svih slika, procena tokena, blokovi za Claude i oznaka
// koja se čuva u istoriji umesto slike. Slike se ne čuvaju nigde: postoje samo u memoriji tokom zahteva.
// Bez server-only importa, da bi se moglo testirati (npm test).
import { inspectJpeg, type JpegRejection } from './image-inspect.ts';
import { MAX_IMAGES_PER_QUESTION } from './image-limits.ts';
import { TRANSCRIPTION_EMPTY_MARKER } from './prompts.ts';

export type CheckedImage = { bytes: Uint8Array; width: number; height: number };

export type ImageRejection = JpegRejection | { ok: false; reason: 'image_count' };

// index je redni broj slike (od 1) koja je odbijena, ili 0 kad je problem u broju slika
export type ImagesInspection = { ok: true; images: CheckedImage[] } | { ok: false; index: number; rejection: ImageRejection };

export function inspectImages(list: Uint8Array[]): ImagesInspection {
  if (list.length === 0 || list.length > MAX_IMAGES_PER_QUESTION) {
    return { ok: false, index: 0, rejection: { ok: false, reason: 'image_count' } };
  }
  const images: CheckedImage[] = [];
  for (let i = 0; i < list.length; i++) {
    const r = inspectJpeg(list[i]);
    if (!r.ok) return { ok: false, index: i + 1, rejection: r };
    images.push({ bytes: r.bytes, width: r.width, height: r.height });
  }
  return { ok: true, images };
}

// Claude računa sliku kao (širina x visina) / 750 tokena; slika je već smanjena na najviše 2000px
export function estimateImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}

// Oznaka u istoriji je u lib/image-label.ts (koristi je i pregledač)
export { imageCountLabel, imageMessageContent } from './image-label.ts';

export type ClaudeContentBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
  | { type: 'text'; text: string };

// Slike idu pre teksta pitanja (preporuka za vision)
export function buildImageUserContent(images: CheckedImage[], text: string): ClaudeContentBlock[] {
  return [
    ...images.map((img): ClaudeContentBlock => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(img.bytes).toString('base64') },
    })),
    { type: 'text', text },
  ];
}

// --- Prepis jedne strane slikanog dokumenta (POST /api/ingest/transcribe) ---

// Gusto kucana A4 strana je oko 1.000-1.500 tokena; 4.096 ostavlja prostor i za tabele
export const TRANSCRIBE_MAX_OUTPUT_TOKENS = 4096;
// System prompt za prepis i kratka poruka uz sliku
export const TRANSCRIBE_PROMPT_ALLOWANCE_TOKENS = 600;

export function estimateTranscriptionTokens(width: number, height: number): number {
  return estimateImageTokens(width, height) + TRANSCRIBE_PROMPT_ALLOWANCE_TOKENS + TRANSCRIBE_MAX_OUTPUT_TOKENS;
}

// null = na slici nema teksta (prazan odgovor ili oznaka iz prompta)
export function parseTranscription(answer: string): string | null {
  const text = answer.trim();
  return text.length === 0 || text === TRANSCRIPTION_EMPTY_MARKER ? null : text;
}
