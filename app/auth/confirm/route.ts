import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveConfirm } from '@/lib/auth-confirm';

// Link iz emaila (pozivnica ili reset lozinke): verifyOtp uspostavlja sesiju, pa preusmerava na /set-password ili /reset-password.
// Odluka o vrstama, odredištu i neuspehu je u lib/auth-confirm.ts (testirano); ovde je samo spoj sa Supabase-om.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const supabase = await createClient();
  const path = await resolveConfirm(searchParams, (args) => supabase.auth.verifyOtp(args));
  return NextResponse.redirect(new URL(path, origin));
}
