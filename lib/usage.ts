import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { apiError } from '@/lib/api-error';
import { effectiveLimits, limitMessage, parseOfficeSettings, type LimitReason, type Limits } from '@/lib/limits';
import { decideIpBurst } from '@/lib/ip-burst';
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
  // limits su oni koji su važili pri rezervaciji (isti se koriste za upozorenje na 80% u odgovoru)
  | { ok: true; reservationId: string; limits: Limits; errorResponse: null }
  | { ok: false; reservationId: null; limits: null; errorResponse: NextResponse };

// Podešavanja kancelarije (office_settings, 2.5) čitaju se pri svakoj rezervaciji (jedan mali upit), pa
// promena u admin panelu važi odmah. Env varijable su gornja granica. Ako se podešavanja ne pročitaju,
// važe env i podrazumevane vrednosti kao do sada: limit se nikad ne gasi.
async function loadLimits(): Promise<Limits> {
  const { data, error } = await supabaseAdmin
    .from('office_settings')
    .select('daily_message_limit, daily_document_limit, daily_token_budget, monthly_token_budget')
    .maybeSingle();
  if (error) console.error('Office Settings Error:', error);
  return effectiveLimits(parseOfficeSettings(data));
}

// IP burst (2.8): poziva se na samom početku rute, PRE autentifikacije i čitanja tela, pa poplava zahteva
// ne stiže ni do Supabase Auth-a, a neispravna otpremanja ne pune audit log. Vraća odgovor kad zahtev
// treba odbiti (429 ili 503, fail-closed), a null kad sme dalje. Blokada se namerno ne upisuje u audit log:
// poplava bi ga punila, a Vercel logovi već pokazuju 429.
export async function enforceIpBurst(ip: string | null): Promise<NextResponse | null> {
  const decision = await decideIpBurst(ip, async (key, limit, windowSeconds) => {
    const { data, error } = await supabaseAdmin.rpc('hit_ip_rate_limit', {
      p_ip: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) console.error('IP Burst Error:', error);
    return { data, error };
  });

  switch (decision.kind) {
    case 'allow':
      return null;
    case 'blocked':
      return apiError(
        'Previše zahteva u kratkom roku sa vaše mreže. Sačekajte nekoliko sekundi i pokušajte ponovo.',
        429,
        'too_many_requests',
        { 'Retry-After': String(decision.retryAfterSeconds) }
      );
    case 'unavailable':
      return apiError(
        'Sistem trenutno ne može da proveri ograničenje zahteva. Pokušajte ponovo za par trenutaka.',
        503,
        'rate_limit_unavailable'
      );
  }
}

export async function reserveUsage(
  actor: AuditActor,
  kind: UsageKind,
  estimatedTokens: number,
  ip: string | null = null
): Promise<ReserveResult> {
  const limits = await loadLimits();
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
      limits: null,
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
      limits: null,
      errorResponse: NextResponse.json({ error: limitMessage(kind, reason, limits), code: 'limit_reached' }, { status: 429 }),
    };
  }

  return { ok: true, reservationId: row.reservation_id, limits, errorResponse: null };
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
