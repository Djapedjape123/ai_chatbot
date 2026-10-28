// Gradnja RAG konteksta za system prompt. Tekst dokumenata i ime fajla dolaze od korisnika, pa su
// NEPOUZDANI: svaki izvod ide u svoj <izvod> blok, a znakovi < i > se u sadržaju i nazivu escape-uju,
// pa dokument ne može da zatvori blok, lažira novi izvod ni da se predstavi kao uputstvo sistema.

export const MAX_TITLE_LENGTH = 120;

export type RagChunk = { document_title: string; content: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ID-evi dokumenata iz kojih su uzeti izvodi, za audit ("ko je pročitao koji dokument").
// Propušta se isključivo UUID, nikad naziv ni tekst. Pasusi bez document_id (funkcija u bazi još
// nije ažurirana) se preskaču, pa audit dobija prazan spisak umesto greške.
export function uniqueDocumentIds(chunks: Record<string, unknown>[]): string[] {
  const ids = chunks
    .map((c) => c.document_id)
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id));
  return [...new Set(ids)];
}

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
