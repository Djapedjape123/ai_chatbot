import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireUser } from '@/lib/require-user';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { user, errorResponse } = await requireUser();
  if (!user) return errorResponse!;

  const { chatId } = await params;

  // Proveravamo da razgovor postoji I da pripada ovom korisniku
  const { data: chat, error: chatError } = await supabaseAdmin
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single();

  if (chatError || !chat) {
    return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
  }

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