// Gradnja RAG konteksta za system prompt. Tekst dokumenata i ime fajla dolaze od korisnika, pa su
// NEPOUZDANI: svaki izvod ide u svoj <izvod> blok, a znakovi < i > se u sadržaju i nazivu escape-uju,
// pa dokument ne može da zatvori blok, lažira novi izvod ni da se predstavi kao uputstvo sistema.

export const MAX_TITLE_LENGTH = 120;

export type RagChunk = { document_title: string; content: string };

// Ime fajla bira korisnik: uklanjamo kontrolne i nevidljive znakove (zero-width, bidi override),
// prelome redova (uklj. Unicode separatore reda i pasusa) pretvaramo u razmak i skraćujemo.
export function sanitizeTitle(title: unknown): string {
  if (typeof title !== 'string') return 'dokument';
  const clean = title
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, MAX_TITLE_LENGTH).join('').trim() || 'dokument';
}

const escapeAngle = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeAngle(s).replace(/"/g, '&quot;');

export function buildRagContext(chunks: RagChunk[]): string {
  return chunks
    .map((c) => `<izvod naziv="${escapeAttr(sanitizeTitle(c.document_title))}">\n${escapeAngle(String(c.content ?? ''))}\n</izvod>`)
    .join('\n\n');
}
