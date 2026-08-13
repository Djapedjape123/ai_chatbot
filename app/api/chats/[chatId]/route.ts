import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. Prvo brišemo sve poruke vezane za ovaj chat
    const { error: msgError } = await supabaseAdmin
      .from('messages')
      .delete()
      .eq('chat_id', chatId);

    if (msgError) throw msgError;

    // 2. Zatim brišemo sam chat
    const { error: chatError } = await supabaseAdmin
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (chatError) throw chatError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete Chat Error:', error);
    return NextResponse.json({ error: 'Greška pri brisanju razgovora.' }, { status: 500 });
  }
}