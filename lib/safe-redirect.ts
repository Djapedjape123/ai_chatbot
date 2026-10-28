// Parametar `next` (npr. u /auth/callback) sme da vodi samo na putanju na našem sajtu.
// Bez provere `${origin}${next}` sa next=@evil.com daje https://app@evil.com, koji browser otvara kao evil.com.
const BASE = 'http://localhost';

export function safeRedirectPath(next: string | null | undefined, fallback = '/'): string {
  // Mora da počinje sa /, a ne sa // ni /\ (oba otvaraju drugi sajt)
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  // Backslash i kontrolni znaci: browser briše tab i novi red iz URL-a, pa /<TAB>/evil.com postaje //evil.com
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;

  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return fallback;
    const path = url.pathname + url.search + url.hash;
    // /..//evil.com se normalizuje u //evil.com
    return path.startsWith('//') ? fallback : path;
  } catch {
    return fallback;
  }
}
