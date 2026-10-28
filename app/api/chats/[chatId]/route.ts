import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-user';
import { uuidSchema } from '@/lib/validation';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';

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
      return apiError('Razgovor nije pronađen.', 404, 'not_found');
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
      return apiError('Razgovor nije pronađen.', 404, 'not_found');
    }

    // 3. AUDIT tek posle stvarnog brisanja (upis ide kroz supabaseAdmin, nikad ne ruši zahtev)
    await logAudit({ id: user.id, email: user.email }, 'chat_deleted', {
      resourceType: 'chat',
      resourceId: chatId,
      ip: getClientIp(req.headers),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete Chat Error:', error);
    return apiError('Greška pri brisanju razgovora.', 500, 'chat_delete_failed');
  }
}
