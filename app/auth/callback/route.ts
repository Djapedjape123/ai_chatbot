import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server'; // OVO JE KLJUČNO: Server klijent

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Ako je zatražen reset lozinke, next parametar će ga odvesti tamo nakon potvrde koda
  const next = searchParams.get('next') ?? '/'; 

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Ako kod nije validan ili je istekao, vrati ga na login sa greškom
  return NextResponse.redirect(`${origin}/?error=Neuspešna_potvrda_linka`);
}