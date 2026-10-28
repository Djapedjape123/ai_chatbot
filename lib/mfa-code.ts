// Pomoćne funkcije za dvostepenu prijavu (2.5.3): unos koda i prikaz QR koda.
// Bez zavisnosti (nema zod-a ni Next uvoza), da ih sme da koristi klijentski kod bez povećanja bundle-a.
// Kod nikad ne stiže do našeg servera: pregledač ga šalje direktno Supabase Auth-u.

// Aplikacije za autentifikaciju prikazuju kod kao "123 456", pa se razmaci, crtice i nedeljivi razmak
// (pri kopiranju) uklanjaju. Prihvata se samo tačno 6 ASCII cifara.
export function normalizeMfaCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}

const SUPABASE_SVG_PREFIX = 'data:image/svg+xml;utf-8,';
const SAFE_SVG_PREFIX = 'data:image/svg+xml;utf8,';

// Supabase vraća QR kao SVG: prefiks "data:image/svg+xml;utf-8," i sirov SVG tekst iza njega. Sirov "#"
// (npr. fill="#000") browser tretira kao početak fragmenta i seče sliku, pa se tekst kodira.
// Sve što nema očekivani prefiks se odbija (null): u <img> ne ide ono što ne prepoznajemo.
export function qrImageSrc(qrCode: unknown): string | null {
  if (typeof qrCode !== 'string' || !qrCode.startsWith(SUPABASE_SVG_PREFIX)) return null;
  return SAFE_SVG_PREFIX + encodeURIComponent(qrCode.slice(SUPABASE_SVG_PREFIX.length));
}
