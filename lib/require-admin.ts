import 'server-only';
import { requireUser } from '@/lib/require-user';
import { decideMfaStep, isAdminRole, type MfaStep } from '@/lib/admin-access';

// Provera admina za stranice /admin, server akcije i rutu izvoza (2.5.2). Vraća null kad korisnik nije admin
// (stranice zovu notFound(), pa panel ne otkriva da postoji; server akcije vraćaju { error }).
//
// Slojevi zaštite: proxy.ts radi samo optimističko usmeravanje, ova provera važi za svaki zahtev, a poslednja
// linija je baza (private.is_admin(): uloga admin I aal2 u JWT-u, u svakoj admin funkciji i u polisi audit_log-a).
// Uloga se čita preko korisničkog klijenta (RLS: korisnik vidi samo svoj profil), nikad preko supabaseAdmin.
//
// mfa: 'ok' = sesija je aal2, može u panel; 'challenge' = ima faktor, traži se kod (/login/mfa);
// 'enroll' = nema faktor, prvo ga uključuje (/account/security). Pozivalac je odgovoran da pri
// mfa !== 'ok' ne prikaže niti pokrene ništa admin-specifično.
//
// requireUser({ allowMfaPending }) jer admin sa faktorom, a bez koda, ovde dobija 'challenge', a ne 401/404.
// Nivo i faktori dolaze iz requireUser() (getUser() + token), isto kao za kapiju u proxy.ts.
export async function requireAdmin(): Promise<{
  user: NonNullable<Awaited<ReturnType<typeof requireUser>>['user']>;
  supabase: NonNullable<Awaited<ReturnType<typeof requireUser>>['supabase']>;
  mfa: MfaStep;
} | null> {
  const { user, supabase, assurance } = await requireUser({ allowMfaPending: true });
  if (!user || !supabase) return null;

  const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profileError) console.error('Admin Role Check Error:', profileError);
  if (!isAdminRole(profile?.role)) return null;

  // Potvrđen faktor znači da je sledeći nivo aal2 (decideMfaStep razlikuje 'challenge' od 'enroll')
  const nextLevel = assurance.verifiedFactors > 0 ? 'aal2' : assurance.aal;
  return { user, supabase, mfa: decideMfaStep(assurance.aal, nextLevel) };
}
