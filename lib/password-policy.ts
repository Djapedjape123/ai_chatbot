// Pravila za novu lozinku (pozvani advokat na /set-password, reset na /reset-password). Bez zod-a i Next uvoza:
// koristi je klijentska forma, a lozinka ide direktno Supabase Auth-u (ne stiže do našeg servera).
//
// Ovo je pomoć korisniku, a NE zaštita: ko ima sesiju može da pozove updateUser mimo naše forme. Stvarnu donju granicu
// čuva Supabase (Dashboard → Authentication → Password → Minimum password length = 12), vidi docs/next-steps.md.

export const MIN_PASSWORD_LENGTH = 12;
// bcrypt (Supabase Auth) gleda bajtove, ne znakove: slova sa kvačicama zauzimaju po dva bajta
export const MAX_PASSWORD_BYTES = 72;

export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password || !confirm) return 'Popunite oba polja.';
  if (password !== confirm) return 'Lozinke se ne poklapaju.';
  if (password.trim() === '') return 'Lozinka ne sme da se sastoji samo od razmaka.';
  // Spread broji znakove (code point), pa emotikon nije dva znaka kao u .length
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return `Lozinka mora imati najmanje ${MIN_PASSWORD_LENGTH} znakova.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return `Lozinka je predugačka (najviše ${MAX_PASSWORD_BYTES} bajtova; slova sa kvačicama zauzimaju po dva).`;
  }
  return null;
}

// Greška iz supabase.auth.updateUser. Interni tekst Auth-a se ne prikazuje, samo poruka po kodu greške.
export function describePasswordUpdateError(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  switch (code) {
    case 'weak_password':
      return 'Lozinka je previše slaba ili se nalazi na spisku procurelih lozinki. Izaberite drugu.';
    case 'same_password':
      return 'Nova lozinka mora da se razlikuje od stare.';
    case 'insufficient_aal':
      return 'Potrebna je dvostepena provera. Prijavite se ponovo i unesite kod iz aplikacije za autentifikaciju.';
    case 'reauthentication_needed':
      // Podešavanje "Require reauthentication when changing password" traži svežu prijavu; ovo NIJE kod iz aplikacije
      return 'Za promenu lozinke potrebna je svežija prijava. Prijavite se ponovo ili zatražite novi link za reset lozinke.';
    case 'session_not_found':
    case 'otp_expired':
      return 'Link je istekao ili je već iskorišćen. Zatražite novi.';
    default:
      return 'Promena lozinke nije uspela. Pokušajte ponovo ili zatražite novi link.';
  }
}
