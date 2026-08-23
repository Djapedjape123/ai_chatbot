import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
// Prilagodi putanju za autentikaciju svom projektu!
import { createClient } from '@/lib/supabase/server'; 

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko traži poruke?)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Niste prijavljeni.' }, { status: 401 });
    }

    // 2. PROVERA VLASNIŠTVA (Da li korisnik sme da čita ovaj chat?)
    const { data: chat, error: chatError } = await supabaseAdmin
      .from('chats')
      .select('user_id')
      .eq('id', chatId)
      .single();

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    if (chat.user_id !== user.id) {
      return NextResponse.json({ error: 'Nemate pravo pristupa ovom razgovoru.' }, { status: 403 });
    }

    // 3. DOHVATANJE PORUKA (Sortirano hronološki)
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true }); // Najstarije prve

    if (messagesError) throw messagesError;

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Fetch Messages Error:', error);
    return NextResponse.json({ error: 'Greška pri učitavanju poruka.' }, { status: 500 });
  }
}