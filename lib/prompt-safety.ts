// Laka detekcija sumnjivih uputstava u otpremljenom dokumentu (2.4), bez dodatnog LLM poziva.
// Ne blokira: ingest vraća upozorenje, a korisnik odlučuje da li nastavlja (acknowledge=true).
// Ograda u samom kontekstu je u lib/rag-context.ts; ovo je samo rani signal korisniku.

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ђ: 'dj', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k',
  л: 'l', љ: 'lj', м: 'm', н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u',
  ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz', ш: 's',
};

// Mala slova, ćirilica u latinicu, bez dijakritika i nevidljivih znakova, jedan razmak.
// Tako "IGNORIŠI", "ignorisi" i "игнориши" daju isti tekst.
export function normalizeForDetection(text: string): string {
  return text
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (c) => CYRILLIC_TO_LATIN[c] ?? c)
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ');
}

const PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'ignore_instructions', re: /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|all|earlier)\b.{0,20}\b(instructions?|rules|prompts?)\b/ },
  { id: 'ignore_instructions', re: /\b(ignorisi|zanemari|zaboravi|ne obaziraj se na)\b.{0,30}\b(prethodn\w*|gornj\w*|sv\w*|ranij\w*)\b.{0,20}\b(uputstv\w*|instrukcij\w*|pravil\w*|naredb\w*)\b/ },
  { id: 'prompt_reference', re: /\b(system prompt|sistemsk\w* prompt|sistemsk\w* (uputstv|instrukcij)\w*)\b/ },
  { id: 'reveal_prompt', re: /\b(reveal|print|show|repeat)\b.{0,20}\b(your|the)\b.{0,10}\b(prompt|instructions)\b/ },
  { id: 'reveal_prompt', re: /\b(otkrij|ispisi|prikazi|ponovi)\b.{0,20}\b(svoj\w*|tvoj\w*)?\s?(prompt|uputstv\w*|instrukcij\w*)\b/ },
  { id: 'role_override', re: /\b(you are now|from now on you|act as)\b/ },
  { id: 'role_override', re: /\b(ti si sada|od sada (si|ces|budi)|ponasaj se kao)\b/ },
  { id: 'fake_delimiter', re: /<\/?\s*(izvod|rag_kontekst|system|instructions?)\b/ },
  { id: 'fake_delimiter', re: /\[\/?(inst|system)\]|<\|im_(start|end)\|>/ },
];

export type SuspiciousResult = { suspicious: boolean; patterns: string[] };

export function detectSuspiciousContent(text: string): SuspiciousResult {
  const normalized = normalizeForDetection(text);
  const patterns = [...new Set(PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.id))];
  return { suspicious: patterns.length > 0, patterns };
}
