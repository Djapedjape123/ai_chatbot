import 'server-only';
import { requireAdmin } from '@/lib/require-admin';

export type AdminContext = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>;

// Provera za SVAKU admin server akciju (server akcija je javni endpoint, pa layout i stranica ne štite akciju):
// prijavljen, uloga admin, nalog nije blokiran (requireUser) i sesija aal2. Greška ne otkriva zašto je odbijen
// poziv. Poslednja linija zaštite je baza: svaka admin_* funkcija traži private.is_admin().
export async function requireAdminAction(): Promise<{ admin: AdminContext } | { error: string }> {
  const admin = await requireAdmin();
  if (!admin || admin.mfa !== 'ok') return { error: 'Neautorizovan pristup.' };
  return { admin };
}
