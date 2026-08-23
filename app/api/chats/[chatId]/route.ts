import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
// Napomena: Moraš da importuješ svoju funkciju za dobijanje trenutnog korisnika.
// Ako u drugim rutama koristiš nešto poput `requireUser()` ili `createClient`, ubaci to ovde.
// U ovom primeru koristimo standardni Supabase server klijent za proveru sesije.
import { createClient } from '@/lib/supabase/server'; // Prilagodi ovu putanju svom projektu!

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko šalje zahtev?)
    const supabase = await createClient(); 
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Niste prijavljeni.' }, { status: 401 });
    }

    // 2. PROVERA VLASNIŠTVA (Da li je ovo njegov chat?)
    const { data: chat, error: fetchError } = await supabaseAdmin
      .from('chats')
      .select('user_id')
      .eq('id', chatId)
      .single();

    if (fetchError || !chat) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    if (chat.user_id !== user.id) {
      return NextResponse.json({ error: 'Nemate pravo da obrišete tuđi razgovor.' }, { status: 403 });
    }

    // 3. BEZBEDNO BRISANJE
    // Prvo brišemo poruke
    const { error: msgError } = await supabaseAdmin
      .from('messages')
      .delete()
      .eq('chat_id', chatId);

    if (msgError) throw msgError;

    // Zatim brišemo chat
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