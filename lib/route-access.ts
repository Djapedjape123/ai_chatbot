// Stranice koje odjavljen korisnik sme da otvori (proxy.ts, pravilo 1). Sve ostalo vodi na /login.
// Tačno poređenje putanja (bez prefiksa), da slična putanja ne bi postala izuzetak.
//
// /set-password i /login/mfa NISU javne: traže sesiju (posle /auth/confirm, odnosno posle lozinke).
// /register nije javna jer je javna registracija ukinuta: nalog otvara administrator kancelarije pozivnicom.

const PUBLIC_PATHS = new Set([
  '/',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/auth/confirm',
  '/link-expired',
]);

export function isPublicPath(pathname: string): boolean {
  const normalized = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return PUBLIC_PATHS.has(normalized);
}
