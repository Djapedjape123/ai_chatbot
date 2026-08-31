import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser } from '@/lib/require-user';

export async function GET() {
  const { user, errorResponse } = await requireUser();
  if (!user) return errorResponse!;
 // 1. Dohvatamo listu razgovora za korisnika iz baze podataka
  const { data, error } = await supabaseAdmin
    .from('chats')
    .select('id, title, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
   // 2. Ako dođe do greške prilikom dohvata, logujemo je i vraćamo odgovor sa statusom 500
  if (error) {
    console.error('Chats List Error:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju razgovora.' }, { status: 500 });
  }

  return NextResponse.json({ chats: data });
}