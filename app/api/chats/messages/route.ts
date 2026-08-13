import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;
  

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('id, role, content, created_at')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Messages Load Error:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju poruka.' }, { status: 500 });
  }

  return NextResponse.json({ messages: data });
}