import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/require-admin';
import { adminMfaRedirect } from '@/lib/admin-access';

// requireAdmin() zove Supabase Auth (getUser), pa se rezultat pamti u okviru jednog zahteva: layout i stranica
// koji se prikazuju zajedno ne plaćaju proveru dvaput. Pamti se samo podatak; notFound() i redirect() ostaju izvan keša.
const getAdmin = cache(requireAdmin);

// Provera pristupa za /admin layout I za SVAKU admin stranicu. Ne sme samo layout: layouti se ne izvršavaju ponovo
// pri navigaciji unutar panela (Partial Rendering), pa bi sesija bila proverena samo pri ulasku u panel.
//  - nije admin (ili nije prijavljen): notFound(), panel ne otkriva da postoji
//  - admin bez aal2: unos koda ili uključivanje dvostepene prijave, uz povratak na `next`
// Poslednja linija zaštite je baza: svaka admin_* funkcija traži private.is_admin() (uloga admin I aal2).
export async function requireAdminPage(next: string) {
  const admin = await getAdmin();
  if (!admin) notFound();

  const to = adminMfaRedirect(admin.mfa, next);
  if (to) redirect(to);

  return admin;
}
