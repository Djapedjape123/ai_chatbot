// Oznaka slika u istoriji razgovora (Faza 3.5). Poseban modul jer ga koristi i pregledač: ne sme da povuče
// lib/prompts.ts (sistemski prompt) u JS paket klijenta.

export function imageCountLabel(n: number): string {
  // Srpska množina: 1 slika, 2-4 slike, 5+ slika (više od 5 ne postoji)
  const word = n >= 2 && n <= 4 ? 'slike' : 'slika';
  return `📷 ${n} ${word}`;
}

// Ono što se upisuje u messages.content: oznaka i pitanje. Naredna pitanja ne vide sliku (odluka vlasnika).
export function imageMessageContent(n: number, query: string): string {
  return `${imageCountLabel(n)}\n\n${query}`;
}
