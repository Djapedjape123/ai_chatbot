import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/client';

export async function GET(request: Request) {
  // 1. Parsiramo URL da bismo dobili kod i opcioni parametar "next"
  const { searchParams, origin } = new URL(request.url);
  // 2. Dobijamo kod i opcioni parametar "next" iz URL-a
  const code = searchParams.get('code');

  // 3. Ako je kod prisutan, pokušavamo da ga zamenimo za sesiju
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Link je nevažeći ili istekao
  return NextResponse.redirect(`${origin}/login?error=reset_link_invalid`);
}