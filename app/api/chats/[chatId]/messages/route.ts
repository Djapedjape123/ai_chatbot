import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { uuidSchema } from '@/lib/validation';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko traži poruke?)
    const { user, supabase, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    // Neispravan ID ne stiže do baze: za klijenta je to isto što i nepostojeći razgovor
    if (!uuidSchema.safeParse(chatId).success) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    // 2. PROVERA VLASNIŠTVA preko korisničkog klijenta: RLS vraća samo korisnikove razgovore,
    // pa tuđi razgovor izgleda isto kao nepostojeći (404).
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .maybeSingle();

    if (chatError) throw chatError;

    if (!chat) {
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
