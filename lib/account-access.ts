// Blokiran nalog (2.5.6): čista odluka da li nalog sme da koristi aplikaciju. Bez server-only i Next uvoza, da bi se
// mogla testirati (npm test). Koristi je requireUser().
//
// Zašto dva izvora: ban u Supabase Auth-u (banned_until) sprečava prijavu i osvežavanje sesije, ali pristupni token
// (JWT) izdat pre blokade važi do isteka, a nije potvrđeno da ga getUser() odbija. Zato blokada ima i oznaku u
// profilu (profiles.disabled_at) koju aplikacija čita pri svakom zahtevu, pa počinje da važi odmah.
// Pravilo je zatvoreno: sve što se ne može protumačiti kao "nije blokiran" tretira se kao blokada, a greška pri
// čitanju profila ne propušta zahtev.

export const ACCOUNT_BLOCKED_MESSAGE = 'Vaš nalog je blokiran. Obratite se administratoru kancelarije.';
export const ACCOUNT_CHECK_FAILED_MESSAGE = 'Provera naloga nije uspela. Pokušajte ponovo.';

export type AccountAccess = 'ok' | 'blocked' | 'check_failed';

export function decideAccountAccess(input: {
  // user.banned_until iz getUser() (Auth server vraća svež podatak)
  bannedUntil: unknown;
  // Red iz profiles (kolona disabled_at); null = nalog nema profil (stariji nalozi), što nije blokada
  profile: { disabled_at?: unknown } | null | undefined;
  profileFailed: boolean;
  now: Date;
}): AccountAccess {
  const { bannedUntil } = input;
  if (bannedUntil !== null && bannedUntil !== undefined) {
    const until = typeof bannedUntil === 'string' ? Date.parse(bannedUntil) : NaN;
    if (Number.isNaN(until) || until > input.now.getTime()) return 'blocked';
  }

  if (input.profileFailed) return 'check_failed';

  const disabledAt = input.profile?.disabled_at;
  if (disabledAt !== null && disabledAt !== undefined) return 'blocked';

  return 'ok';
}
