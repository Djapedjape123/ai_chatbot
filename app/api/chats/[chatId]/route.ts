import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko šalje zahtev?)
    const { user, supabase, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    // 2. BRISANJE JEDNIM POZIVOM preko korisničkog klijenta.
    // RLS briše samo korisnikove razgovore, a poruke brišu se kaskadno (ON DELETE CASCADE).
    // Prazan rezultat = razgovor ne postoji ILI nije njegov: oba slučaja izgledaju isto (404).
    const { data: deleted, error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId)
      .select('id');

    // 22P02 = chatId nije validan UUID, što je za klijenta isto što i nepostojeći razgovor
    if (error && error.code !== '22P02') throw error;

    if (error || !deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete Chat Error:', error);
    return NextResponse.json({ error: 'Greška pri brisanju razgovora.' }, { status: 500 });
  }
}
