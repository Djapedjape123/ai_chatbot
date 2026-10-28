import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/api-error';

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase: null,
      errorResponse: apiError('Niste prijavljeni.', 401, 'unauthorized'),
    };
  }

  // Korisnički klijent (JWT + RLS) za čitanja; supabaseAdmin je samo za upise.
  return { user, supabase, errorResponse: null };
}