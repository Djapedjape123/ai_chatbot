import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';
import { toMeBody } from '@/lib/me';

// Uloga prijavljenog korisnika, samo za meni u chatu (2.5.9): da li da prikaže vezu ka admin panelu. Veza olakšava ulaz,
// a zaštita je u samom panelu (404 za advokata, aal2, baza). Odgovor sadrži isključivo ulogu (lib/me.ts) i ne kešira se.
export async function GET() {
  const { user, supabase, errorResponse } = await requireUser();
  if (!user) return errorResponse!;

  // Čitanje preko korisničkog klijenta (RLS: korisnik vidi samo svoj profil)
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) {
    console.error('Me Error:', error);
    return apiError('Greška pri učitavanju naloga.', 500, 'me_failed');
  }

  return NextResponse.json(toMeBody(data), { headers: { 'Cache-Control': 'private, no-store' } });
}
