import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko traži poruke?)
    const { user, supabase, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    // 2. PROVERA VLASNIŠTVA preko korisničkog klijenta: RLS vraća samo korisnikove razgovore,
    // pa tuđi razgovor izgleda isto kao nepostojeći (404).
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .maybeSingle();

    // 22P02 = chatId nije validan UUID, što je za klijenta isto što i nepostojeći razgovor
    if (chatError && chatError.code !== '22P02') throw chatError;

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    // 3. DOHVATANJE PORUKA (Sortirano hronološki)
    const { data: messages, error: messagesError } = await supabase
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
