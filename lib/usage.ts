import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getLimits, limitMessage, type LimitReason } from '@/lib/limits';
import { logAudit, type AuditActor } from '@/lib/audit';

// Usage ledger (migracija 2.1): rezervacija PRE poziva AI servisa, zatvaranje POSLE.
// reserve_usage i close_usage sme da zove samo service_role; user_id dolazi iz verifikovanog korisnika.

export type UsageKind = 'chat' | 'ingest';

export type ActualTokens = { input?: number; output?: number; embed?: number };

type ReserveRow = {
  allowed: boolean;
  reservation_id: string | null;
  reason: LimitReason | null;
};

type ReserveResult =
  | { ok: true; reservationId: string; errorResponse: null }
  | { ok: false; reservationId: null; errorResponse: NextResponse };

export async function reserveUsage(
  actor: AuditActor,
  kind: UsageKind,
  estimatedTokens: number,
  ip: string | null = null
): Promise<ReserveResult> {
  const limits = getLimits();
  const { data, error } = await supabaseAdmin.rpc('reserve_usage', {
    p_user_id: actor.id,
    p_kind: kind,
    p_estimated_tokens: Math.max(0, Math.ceil(estimatedTokens)),
    p_daily_count_limit: kind === 'chat' ? limits.dailyMessages : limits.dailyDocuments,
    p_daily_token_limit: limits.dailyTokens,
    p_monthly_token_limit: limits.monthlyTokens,
  });

  const row = (data as ReserveRow[] | null)?.[0];

  // FAIL-CLOSED: ako baza ne odgovori, ne trošimo API kredite.
  if (error || !row) {
    console.error('Reserve Usage Error:', error);
    return {
      ok: false,
      reservationId: null,
      errorResponse: NextResponse.json(
        { error: 'Sistem trenutno ne može da proveri vaš limit. Pokušajte ponovo za par trenutaka.', code: 'usage_unavailable' },
        { status: 503 }
      ),
    };
  }

  if (!row.allowed || !row.reservation_id) {
    const reason = row.reason ?? 'daily_count';
    await logAudit(actor, 'limit_reached', { metadata: { kind, reason }, ip });
    return {
      ok: false,
      reservationId: null,
      errorResponse: NextResponse.json({ error: limitMessage(kind, reason, limits), code: 'limit_reached' }, { status: 429 }),
    };
  }

  return { ok: true, reservationId: row.reservation_id, errorResponse: null };
}

async function closeUsage(reservationId: string, userId: string, tokens: ActualTokens, release: boolean) {
  const { error } = await supabaseAdmin.rpc('close_usage', {
    p_reservation_id: reservationId,
    p_user_id: userId,
    p_input_tokens: tokens.input ?? 0,
    p_output_tokens: tokens.output ?? 0,
    p_embed_tokens: tokens.embed ?? 0,
    p_release: release,
  });
  // Ne rušimo odgovor korisniku: rezervacija ostaje 'reserved' i računa se po proceni.
  if (error) console.error('Close Usage Error:', error);
}

// Poziv je uspeo: upisuje stvarnu potrošnju.
export function settleUsage(reservationId: string, userId: string, tokens: ActualTokens) {
  return closeUsage(reservationId, userId, tokens, false);
}

// Poziv nije uspeo: ne broji se u dnevni limit, ali tokeni potrošeni pre greške ostaju u budžetu.
export function releaseUsage(reservationId: string, userId: string, tokens: ActualTokens = {}) {
  return closeUsage(reservationId, userId, tokens, true);
}
