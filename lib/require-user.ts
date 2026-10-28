import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/api-error';
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
