import { supabaseAdmin } from '@/lib/supabase';
import { NextResponse } from 'next/server';

const DAILY_MESSAGE_LIMIT = 40;

export async function checkRateLimit(userId: string) {
  // Pozivamo RPC funkciju da dobijemo trenutni broj poruka za korisnika
  const { data: count, error } = await supabaseAdmin.rpc('get_daily_message_count', {
    input_user_id: userId,
  });

  if (error) {
    console.error('Rate Limit Check Error:', error);
    // FAIL-CLOSED: Ako baza ne odgovara, privremeno blokiramo zahtev da bismo zaštitili API kredite.
    return { 
      allowed: false, 
      errorResponse: NextResponse.json(
        { error: 'Sistem trenutno ne može da proveri vaš limit poruka. Molimo pokušajte ponovo za par trenutaka.' },
        { status: 500 }
      ) 
    };
  }

  // Obavezno proveravamo i da li je count validan broj (fallback ako rpc vrati null)
  const currentCount = count || 0;

  if (currentCount >= DAILY_MESSAGE_LIMIT) {
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