'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { uuidSchema } from '@/lib/validation';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';

export async function getUserDocuments() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('documents')
    .select('id, title, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Greška pri učitavanju dokumenata:', error);
    return [];
  }

  return data;
}

export async function deleteDocument(documentId: string) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Neautorizovan pristup.' };

  // Server akcija je javni endpoint: argument stiže od klijenta i ne sme do baze bez provere
  if (!uuidSchema.safeParse(documentId).success) {
    return { error: 'Dokument nije pronađen.' };
  }

  // Zahvaljujući RLS-u i CASCADE-u, brisanjem reda iz `documents`
  // baza sama briše i sve povezane `document_chunks`.
  // select('id') vraća obrisane redove: prazan rezultat = dokument ne postoji ILI nije njegov.
  const { data: deleted, error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('user_id', user.id)
    .select('id');

  if (error) {
    console.error('Greška pri brisanju dokumenta:', error);
    return { error: 'Neuspešno brisanje dokumenta.' };
  }

  if (!deleted || deleted.length === 0) {
    return { error: 'Dokument nije pronađen.' };
  }

  // Audit tek posle stvarnog brisanja: ko je obrisao koji dokument (ID, bez naziva i sadržaja)
  await logAudit({ id: user.id, email: user.email }, 'document_deleted', {
    resourceType: 'document',
    resourceId: documentId,
    ip: getClientIp(await headers()),
  });

  revalidatePath('/documents');
  return { success: true };
}
