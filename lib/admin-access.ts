// Odluke o pristupu admin panelu. Čist kod bez server-only importa, da bi se mogao testirati (npm test).
// Stvarna zaštita je u bazi (private.is_admin(): uloga admin I aal2 u JWT-u); ovo je sloj u kodu iznad nje.

import { MFA_LOGIN_PATH } from './mfa-gate.ts';

export type MfaStep = 'ok' | 'challenge' | 'enroll';

export const SECURITY_PATH = '/account/security';

// Kuda vodi admin koji još nema aal2: na unos koda ili na uključivanje dvostepene prijave, uz povratak na `next`.
// null kad nema šta da se preusmerava (aal2). `next` se kodira, pa upit ne može da doda tuđe parametre.
export function adminMfaRedirect(step: MfaStep, next: string): string | null {
  if (step === 'ok') return null;
  const target = step === 'challenge' ? MFA_LOGIN_PATH : SECURITY_PATH;
  return `${target}?${new URLSearchParams({ next }).toString()}`;
}

// Šta admin treba da uradi pre nego što uđe u panel. Samo aal2 otvara panel; sve nepoznato ili nedostajuće
// ne sme da otvori ništa, pa završava u 'enroll' (stranica sa podešavanjem dvostepene prijave).
//  - aal2                    -> 'ok'
//  - aal1, a faktor postoji  -> 'challenge' (unos koda iz aplikacije)
//  - ostalo                  -> 'enroll' (prvo se uključuje dvostepena prijava)
export function decideMfaStep(currentLevel: unknown, nextLevel: unknown): MfaStep {
  if (currentLevel === 'aal2') return 'ok';
  return currentLevel === 'aal1' && nextLevel === 'aal2' ? 'challenge' : 'enroll';
}

export function isAdminRole(role: unknown): boolean {
  return role === 'admin';
}
