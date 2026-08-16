'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

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

  // Zahvaljujući RLS-u i CASCADE-u, brisanjem reda iz `documents` 
  // baza sama briše i sve povezane `document_chunks`
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId)
    .eq('user_id', user.id);

  if (error) {
    return { error: 'Neuspešno brisanje dokumenta.' };
  }

  revalidatePath('/documents');
  return { success: true };
}