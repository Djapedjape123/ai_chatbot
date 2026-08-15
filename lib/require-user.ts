import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      errorResponse: NextResponse.json({ error: 'Niste prijavljeni.' }, { status: 401 }),
    };
  }

  return { user, errorResponse: null };
}