// Pomoćne funkcije za /api/ingest: ograničenja obrade, procena tokena za rezervaciju i upozorenje o
// sumnjivom sadržaju. Bez server-only importa, da bi se moglo testirati (npm test).
import { estimateTokens } from './limits.ts';
import { detectSuspiciousContent, PATTERN_LABELS, type PatternId, type SuspiciousResult } from './prompt-safety.ts';

// Vercel prima najviše ~4.5MB tela zahteva, pa je stvarni limit 4MB. Ovde (a ne u validation.ts) da bi ga
// koristio i klijent, bez uvlačenja zod-a u browser bundle.
export const MAX_FILE_SIZE = 4 * 1024 * 1024;

export const INGEST_CHUNK_SIZE = 1000;
export const INGEST_CHUNK_OVERLAP = 200;
// Zid za ogromne dokumente (sprečava probijanje API limita)
export const INGEST_MAX_CHUNKS = 500;
// Voyage prima pasuse u paketima; svaki paket je jedan poziv sa timeout-om
export const INGEST_BATCH_SIZE = 30;

// Procena za rezervaciju PRE poziva: svaki pasus ide na Voyage. Posle poziva se upisuje stvarna potrošnja.
export function estimateIngestTokens(chunks: string[]): number {
  return chunks.reduce((sum, chunk) => sum + estimateTokens(chunk), 0);
}

// Naziv fajla ulazi u kontekst za AI isto kao tekst, pa se proveravaju oba. Odvojeno, a ne spojeno:
// kraj naziva i početak teksta ne smeju da naprave obrazac koji nijedan od njih nema.
export function findSuspiciousUpload(title: string, text: string): SuspiciousResult {
  const patterns = [...new Set([...detectSuspiciousContent(title).patterns, ...detectSuspiciousContent(text).patterns])];
  return { suspicious: patterns.length > 0, patterns };
}

// Poruka za korisnika. Ne ispisuje interne ID-eve obrazaca, samo opis na srpskom.
export function suspiciousUploadMessage(patterns: string[]): string {
  const labels = patterns.filter((p): p is PatternId => p in PATTERN_LABELS).map((p) => PATTERN_LABELS[p]);
  const found = labels.length > 0 ? ` (${labels.join('; ')})` : '';
  return (
    `Dokument sadrži tekst koji liči na naredbe za AI asistenta${found}. ` +
    'Asistent ga neće izvršavati kao uputstvo, ali je moguće da je dokument namerno podmetnut. ' +
    'Ako mu verujete, nastavite klikom na „Ipak dodaj”.'
  );
}
