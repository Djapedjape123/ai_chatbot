// Dvostepena prijava (MFA, 2.5.3): čista logika kapije. Bez server-only i Next uvoza, da bi se mogla testirati (npm test).
//
// Nalog sa potvrđenim faktorom (TOTP) ne sme da koristi aplikaciju sa sesijom koja je dobijena samo lozinkom (aal1).
// Kapija radi na dva mesta: proxy.ts (usmeravanje stranica) i requireUser() (API rute, server akcije, stranice),
// jer je proxy po dokumentaciji Next.js samo optimistički sloj, a Server Functions moraju same da proveravaju pristup.
//
// Nivo (aal) postoji samo u JWT-u pristupnog tokena, a faktori stižu iz getUser() (Auth server ih vraća sveže).
// Pravilo je zatvoreno: sve što se ne može pročitati ili nije tačno 'aal2' tretira se kao da kod nije unet.

import { safeRedirectPath } from './safe-redirect.ts';

export type Aal = 'aal1' | 'aal2';

export const MFA_LOGIN_PATH = '/login/mfa';
export const MFA_REQUIRED_MESSAGE =
  'Potrebna je dvostepena provera. Prijavite se ponovo i unesite kod iz aplikacije za autentifikaciju.';

// Čita nivo iz payload-a access tokena. Potpis se ovde NE proverava: pozivalac je prethodno pozvao
// supabase.auth.getUser(), pa je Auth server već potvrdio upravo taj token.
export function readAal(accessToken: unknown): Aal | null {
  if (typeof accessToken !== 'string') return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    const aal =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as { aal?: unknown }).aal : undefined;
    return aal === 'aal1' || aal === 'aal2' ? aal : null;
  } catch {
    return null;
  }
}

// Faktor koji je započet, a nije potvrđen kodom (status 'unverified'), ne obavezuje na kod pri prijavi.
export function countVerifiedFactors(factors: unknown): number {
  if (!Array.isArray(factors)) return 0;
  return factors.filter((f) => typeof f === 'object' && f !== null && (f as { status?: unknown }).status === 'verified').length;
}

// Kod se traži samo od naloga koji ima potvrđen faktor, a sesija nije aal2.
export function isMfaPending(input: { verifiedFactors: number; aal: unknown }): boolean {
  return input.verifiedFactors > 0 && input.aal !== 'aal2';
}

// Odredište posle unetog koda (parametar next iz URL-a). Sme samo putanja na našem sajtu (safeRedirectPath), a
// /login/mfa kao odredište pada na /chat: stranica bez obaveze koda preusmerava na next, pa bi vodila sama na sebe.
export function mfaNextPath(raw: unknown): string {
  const path = safeRedirectPath(typeof raw === 'string' ? raw : null, '/chat');
  const pathname = path.split(/[?#]/)[0];
  return pathname === MFA_LOGIN_PATH || pathname === `${MFA_LOGIN_PATH}/` ? '/chat' : path;
}

export type MfaGate = { kind: 'allow' } | { kind: 'deny' } | { kind: 'redirect'; to: string };

const ALLOW: MfaGate = { kind: 'allow' };
const DENY: MfaGate = { kind: 'deny' };

// Posle koda korisnik ne treba da se vrati na početnu ili prijavu, pa tamo /login/mfa ne dobija next (važi /chat).
const ENTRY_PAGES = new Set(['/', '/login', '/register', '/forgot-password']);

// Stranica za unos koda i /auth/* (callback, confirm: samo uspostavljaju sesiju i preusmeravaju dalje, kroz kapiju).
function isExempt(pathname: string): boolean {
  return pathname === MFA_LOGIN_PATH || pathname === `${MFA_LOGIN_PATH}/` || pathname.startsWith('/auth/');
}

// Šta proxy radi sa zahtevom ulogovanog korisnika:
//  - allow: nema obaveze koda, ili je kod unet, ili je ovo stranica za unos koda;
//  - redirect: stranica (GET/HEAD) vodi na /login/mfa i pamti gde je korisnik hteo da ode;
//  - deny: API i sve što nije GET/HEAD (server akcije su POST na putanju stranice) dobija 401, bez preusmeravanja.
export function decideMfaGate(input: {
  pathname: string;
  search?: string;
  method?: string;
  verifiedFactors: number;
  aal: unknown;
}): MfaGate {
  if (!isMfaPending(input)) return ALLOW;

  const { pathname } = input;
  if (isExempt(pathname)) return ALLOW;

  const method = (input.method ?? 'GET').toUpperCase();
  if (pathname === '/api' || pathname.startsWith('/api/') || (method !== 'GET' && method !== 'HEAD')) return DENY;

  if (ENTRY_PAGES.has(pathname)) return { kind: 'redirect', to: MFA_LOGIN_PATH };

  // next je samo putanja ove aplikacije; /login/mfa ga ionako proverava sa safeRedirectPath pre upotrebe
  const next = new URLSearchParams({ next: pathname + (input.search ?? '') });
  return { kind: 'redirect', to: `${MFA_LOGIN_PATH}?${next.toString()}` };
}
