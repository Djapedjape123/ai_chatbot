import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { keysetFilter, type AuditFilter } from '@/lib/audit-filter';

// Upiti nad audit_log za admin stranicu Aktivnost i CSV izvoz (2.5.7). Dobijaju KORISNIČKI klijent (JWT admina):
// čitanje ide kroz RLS polisu audit_log_select_own_or_admin, koja adminu daje sve zapise samo sa aal2.
// Zajednički su da stranica i izvoz nikad ne razilaze u tome šta filter znači.

export const AUDIT_COLUMNS = 'id, user_id, actor_email, action, resource_type, resource_id, metadata, ip, created_at';

type Options = {
  // Gornja granica (isključena) umesto kraja perioda; izvoz je zamrzava na početak izvoza
  until?: string;
};

// Jedna strana, od najnovijeg: created_at pa id opadajuće, počevši strogo posle kursora
export function auditPageQuery(supabase: SupabaseClient, filter: AuditFilter, limit: number, options: Options = {}) {
  let query = supabase
    .from('audit_log')
    .select(AUDIT_COLUMNS)
    .gte('created_at', filter.fromUtc)
    .lt('created_at', options.until ?? filter.toUtcExclusive);
  if (filter.userId) query = query.eq('user_id', filter.userId);
  if (filter.action) query = query.eq('action', filter.action);
  if (filter.cursor) query = query.or(keysetFilter(filter.cursor));
  return query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
}

// Broj zapisa za ceo period i filtere (kursor se ne računa), bez prenosa redova
export function auditCountQuery(supabase: SupabaseClient, filter: AuditFilter, options: Options = {}) {
  let query = supabase
    .from('audit_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', filter.fromUtc)
    .lt('created_at', options.until ?? filter.toUtcExclusive);
  if (filter.userId) query = query.eq('user_id', filter.userId);
  if (filter.action) query = query.eq('action', filter.action);
  return query;
}
