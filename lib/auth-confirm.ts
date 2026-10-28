// Potvrda linka iz emaila (/auth/confirm): poziv advokata (invite) i reset lozinke (recovery).
// Čista logika, bez Next uvoza, da bi se mogla testirati (npm test). Ruta samo prosleđuje verifyOtp.
//
// token_hash tok (a ne PKCE code) je izabran jer pozivnica mora da radi u bilo kom pregledaču i na bilo kom uređaju:
// advokat otvara mejl tamo gde ga je dobio, a code verifier postoji samo u pregledaču koji je tražio link.

import { safeRedirectPath } from './safe-redirect.ts';

export type ConfirmType = 'invite' | 'recovery';

// Korisnik ovde dolazi kad link ne važi (istekao, već iskorišćen, neispravan). Javna stranica, bez prijave.
export const LINK_EXPIRED_PATH = '/link-expired';

// Poziv ne sme da završi u aplikaciji bez lozinke, pa odredište bez (ili sa nevažećim) next zavisi od vrste.
const DEFAULT_NEXT: Record<ConfirmType, string> = {
  invite: '/set-password',
  recovery: '/reset-password',
};

// Supabase token_hash je kratak niz znakova; gornja granica samo štiti od besmisleno dugačkog ulaza.
const MAX_TOKEN_HASH_LENGTH = 512;

export type ConfirmParams = { type: ConfirmType; tokenHash: string; next: string };

// Samo vrste koje ova aplikacija šalje. magiclink, signup, email_change i ostalo se ne potvrđuju kroz ovu rutu.
export function parseConfirmParams(searchParams: URLSearchParams): ConfirmParams | null {
  const type = searchParams.get('type');
  if (type !== 'invite' && type !== 'recovery') return null;

  const tokenHash = searchParams.get('token_hash');
  if (!tokenHash || tokenHash.trim() === '' || tokenHash.length > MAX_TOKEN_HASH_LENGTH) return null;

  // next sme samo na putanju ovog sajta (open redirect), vidi lib/safe-redirect.ts
  return { type, tokenHash, next: safeRedirectPath(searchParams.get('next'), DEFAULT_NEXT[type]) };
}

export type VerifyOtp = (args: { type: ConfirmType; token_hash: string }) => Promise<{ error: unknown }>;

// Vraća putanju na koju treba preusmeriti: odredište posle uspešne potvrde, inače LINK_EXPIRED_PATH.
// Ne razlikuje uzroke neuspeha (istekao, iskorišćen, neispravan, nema mreže): korisniku je potreban novi link u svakom slučaju.
export async function resolveConfirm(searchParams: URLSearchParams, verify: VerifyOtp): Promise<string> {
  const parsed = parseConfirmParams(searchParams);
  if (!parsed) return LINK_EXPIRED_PATH;

  try {
    const { error } = await verify({ type: parsed.type, token_hash: parsed.tokenHash });
    return error ? LINK_EXPIRED_PATH : parsed.next;
  } catch {
    return LINK_EXPIRED_PATH;
  }
}
