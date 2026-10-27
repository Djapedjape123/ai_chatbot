import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { uuidSchema } from '@/lib/validation';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;

    // 1. PROVERA AUTENTIKACIJE (Ko šalje zahtev?)
    const { user, supabase, errorResponse } = await requireUser();
    if (!user) return errorResponse!;

    // Neispravan ID ne stiže do baze: za klijenta je to isto što i nepostojeći razgovor
    if (!uuidSchema.safeParse(chatId).success) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    // 2. BRISANJE JEDNIM POZIVOM preko korisničkog klijenta.
    // RLS briše samo korisnikove razgovore, a poruke brišu se kaskadno (ON DELETE CASCADE).
    // Prazan rezultat = razgovor ne postoji ILI nije njegov: oba slučaja izgledaju isto (404).
    const { data: deleted, error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId)
      .select('id');

    if (error) throw error;

    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'Razgovor nije pronađen.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete Chat Error:', error);
    return NextResponse.json({ error: 'Greška pri brisanju razgovora.' }, { status: 500 });
  }
}
