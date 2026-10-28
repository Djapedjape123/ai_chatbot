import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server'; // OVO JE KLJUČNO: Server klijent
import { safeRedirectPath } from '@/lib/safe-redirect';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Ako je zatražen reset lozinke, next parametar će ga odvesti tamo nakon potvrde koda.
  // Prihvata se samo putanja na ovom sajtu (open redirect: next=@evil.com bi otvorio evil.com).
  const next = safeRedirectPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Ako kod nije validan ili je istekao, vrati ga na login sa greškom
  return NextResponse.redirect(`${origin}/?error=Neuspešna_potvrda_linka`);
}
