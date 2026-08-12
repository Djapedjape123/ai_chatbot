import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('chats')
    .select('id, title, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Chats List Error:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju razgovora.' }, { status: 500 });
  }

  return NextResponse.json({ chats: data });
}