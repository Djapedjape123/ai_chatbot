import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/api-error';
import { ACCOUNT_BLOCKED_MESSAGE, ACCOUNT_CHECK_FAILED_MESSAGE, decideAccountAccess } from '@/lib/account-access';
import { MFA_REQUIRED_MESSAGE, countVerifiedFactors, isMfaPending, readAal, type Aal } from '@/lib/mfa-gate';

export type Assurance = { aal: Aal | null; verifiedFactors: number; pending: boolean };

// Jedino mesto za proveru prijave u API rutama, server akcijama i stranicama.
// allowMfaPending: samo za stranice dvostepene prijave (/login/mfa, /account/security) i requireAdmin(), koji sami
// odlučuju šta radi nalog koji još nije uneo kod. Svi ostali pozivaoci za takav nalog dobijaju 401 mfa_required.
export async function requireUser(options: { allowMfaPending?: boolean } = {}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase: null,
      assurance: null,
      errorResponse: apiError('Niste prijavljeni ili je sesija istekla.', 401, 'unauthorized'),
    };
  }

  // Blokiran nalog (2.5.6): ban u Auth-u i/ili oznaka u profilu. Pristupni token izdat pre blokade važi do isteka,
  // pa se blokada proverava pri svakom zahtevu. Greška čitanja profila ne propušta zahtev (zatvoreno pravilo).
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('disabled_at')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) console.error('Account Check Error:', profileError);

  const access = decideAccountAccess({
    bannedUntil: user.banned_until,
    profile,
    profileFailed: Boolean(profileError),
    now: new Date(),
  });
  if (access === 'blocked') {
    return { user: null, supabase: null, assurance: null, errorResponse: apiError(ACCOUNT_BLOCKED_MESSAGE, 403, 'account_blocked') };
  }
  if (access === 'check_failed') {
    return { user: null, supabase: null, assurance: null, errorResponse: apiError(ACCOUNT_CHECK_FAILED_MESSAGE, 503, 'account_check_failed') };
  }

  // Dvostepena prijava (2.5.3): nalog sa potvrđenim faktorom ne koristi aplikaciju sa sesijom dobijenom samo lozinkom.
  // Faktori stižu iz getUser(), a nivo (aal) postoji samo u tokenu, koji je getUser() upravo potvrdio.
  // Nalozi bez potvrđenog faktora ne čitaju token, pa za njih kapija ne dodaje ni posao ni rizik.
  const verifiedFactors = countVerifiedFactors(user.factors);
  let aal: Aal | null = null;
  if (verifiedFactors > 0) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    aal = readAal(session?.access_token);
  }
  const assurance: Assurance = { aal, verifiedFactors, pending: isMfaPending({ verifiedFactors, aal }) };

  if (assurance.pending && !options.allowMfaPending) {
    return { user: null, supabase: null, assurance, errorResponse: apiError(MFA_REQUIRED_MESSAGE, 401, 'mfa_required') };
  }

  // Korisnički klijent (JWT + RLS) za čitanja; supabaseAdmin je samo za upise.
  return { user, supabase, assurance, errorResponse: null };
}
