import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { apiError } from '@/lib/api-error';

export async function GET() {
  const { user, supabase, errorResponse } = await requireUser();
  if (!user) return errorResponse!;
 // 1. Dohvatamo listu razgovora za korisnika (RLS ograničava na njegove redove, .eq('user_id') je drugi pojas zaštite)
  const { data, error } = await supabase
    .from('chats')
    .select('id, title, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
   // 2. Ako dođe do greške prilikom dohvata, logujemo je i vraćamo odgovor sa statusom 500
  if (error) {
    console.error('Chats List Error:', error);
    return apiError('Greška pri učitavanju razgovora.', 500, 'chats_list_failed');
  }

  return NextResponse.json({ chats: data });
}
