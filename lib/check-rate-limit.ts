import { supabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const DAILY_MESSAGE_LIMIT = 40;

export async function checkRateLimit(userId: string) {
  const { data: count, error } = await supabaseAdmin.rpc('get_daily_message_count', {
    input_user_id: userId,
  });

  if (error) {
    console.error('Rate Limit Check Error:', error);
    // Ako provera pukne iz tehničkih razloga, propuštamo zahtev umesto da blokiramo korisnika
    return { allowed: true, errorResponse: null };
  }

  if (count >= DAILY_MESSAGE_LIMIT) {
    return {
      allowed: false,
      errorResponse: NextResponse.json(
        { error: `Dostigli ste dnevni limit od ${DAILY_MESSAGE_LIMIT} poruka. Pokušajte ponovo sutra.` },
        { status: 429 }
      ),
    };
  }

  return { allowed: true, errorResponse: null };
}