'use server';

import { headers } from 'next/headers';
import { requireUser } from '@/lib/require-user';
import { uuidSchema } from '@/lib/validation';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';

// Audit zapis o uključenoj dvostepenoj prijavi. Pregledač samo javlja ID faktora koji je upravo potvrdio kodom,
// a ovde se proverava da taj faktor stvarno postoji i da je potvrđen (getUser() stiže sa Auth servera),
// pa zapis ne može da se lažira. Server akcija je javni endpoint: argument ne sme do baze bez provere.
export async function recordMfaEnrolled(factorId: string): Promise<{ success: true } | { error: string }> {
  // allowMfaPending: akcija ne vraća podatke, a faktor je upravo potvrđen u istom pregledaču
  const { user, supabase } = await requireUser({ allowMfaPending: true });
  if (!user) return { error: 'Neautorizovan pristup.' };

  if (!uuidSchema.safeParse(factorId).success) return { error: 'Neispravan zahtev.' };

  const confirmed = (user.factors ?? []).some(
    (f) => f.id === factorId && f.status === 'verified' && f.factor_type === 'totp'
  );
  if (!confirmed) return { error: 'Faktor nije potvrđen.' };

  // Isti faktor se beleži samo jednom (RLS: korisnik vidi svoje zapise). Greška provere ne sme da spreči zapis.
  const { data: existing } = await supabase
    .from('audit_log')
    .select('id')
    .eq('action', 'mfa_enrolled')
    .contains('metadata', { factor_id: factorId })
    .limit(1);
  if (existing && existing.length > 0) return { success: true };

  await logAudit({ id: user.id, email: user.email }, 'mfa_enrolled', {
    resourceType: 'user',
    resourceId: user.id,
    metadata: { factor_id: factorId, factor_type: 'totp' },
    ip: getClientIp(await headers()),
  });

  return { success: true };
}
