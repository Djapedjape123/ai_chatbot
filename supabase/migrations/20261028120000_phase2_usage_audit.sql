-- FAZA 2: potrošnja (usage ledger), audit log, uloge i IP burst brojač.
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
--
-- Migracija SAMO DODAJE. Postojeće tabele i funkcije (uklj. get_daily_message_count koji koristi
-- trenutni kod) ostaju, pa se može primeniti PRE deploy-a novog koda, bez prekida rada.
-- Stari brojač se uklanja u posebnoj migraciji kada novi kod bude u produkciji.
--
-- Od 2026-10-30 Supabase više ne izlaže nove tabele automatski (ni za service_role),
-- pa svaka nova tabela dobija eksplicitne grantove za svaku ulogu koja je koristi.
begin;

-- 1. Uloge. Postavlja ih samo admin baze (SQL Editor); korisnik nema UPDATE na profiles.
alter table public.profiles add column if not exists role text not null default 'lawyer';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'lawyer'));

-- Nalog bez profila (dijagnostika 2.0: 3 korisnika, 2 profila) dobija profil, a time i ulogu.
insert into public.profiles (id, full_name, email)
select u.id, u.raw_user_meta_data ->> 'full_name', u.email
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Grantovi kao u Fazi 1 (idempotentno), plus eksplicitno za service_role (od 2026-10-30).
-- Korisnik nema UPDATE, pa ne može sam sebi da promeni ulogu.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- 2. Usage ledger: jedini izvor istine za limite. Korisnik ga samo čita (svoje redove).
--    Brisanje razgovora/dokumenata ga NE dira, pa se brojač ne može resetovati.
create table public.usage_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('chat', 'ingest')),
  status          text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  -- Procena koja se računa u budžet dok poziv traje (status reserved)
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  -- Stvarna potrošnja (settled, a kod released ono što je potrošeno pre greške)
  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  embed_tokens    integer not null default 0 check (embed_tokens >= 0),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create index usage_ledger_user_kind_created_at_idx on public.usage_ledger (user_id, kind, created_at);
create index usage_ledger_user_created_at_idx      on public.usage_ledger (user_id, created_at);

alter table public.usage_ledger enable row level security;

create policy usage_ledger_select_own on public.usage_ledger
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.usage_ledger from public, anon, authenticated, service_role;
grant select on public.usage_ledger to authenticated;
-- Server sme da upiše i zatvori rezervaciju, ali NE i da briše istoriju potrošnje.
grant select, insert, update on public.usage_ledger to service_role;

-- 3. Audit log: append-only, bez sadržaja (nikad tekst pitanja, odgovora ni dokumenata).
--    actor_email se čuva u trenutku događaja: zapis ostaje čitljiv i kada se nalog obriše.
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users (id) on delete set null,
  actor_email   text,
  action        text not null check (action in (
                  'document_uploaded', 'document_upload_blocked', 'document_deleted',
                  'chat_created', 'chat_deleted', 'question_asked',
                  'limit_reached', 'suspicious_content_flagged')),
  resource_type text check (resource_type in ('document', 'chat')),
  resource_id   uuid,
  metadata      jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  ip            inet,
  created_at    timestamptz not null default now()
);

create index audit_log_user_created_at_idx on public.audit_log (user_id, created_at desc);
create index audit_log_created_at_idx      on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Advokat vidi svoje zapise, admin kancelarije vidi sve (jedan projekat = jedna kancelarija).
-- Uloga se čita iz profiles preko RLS-a (korisnik vidi samo svoj profil), bez security definer-a.
create policy audit_log_select_own_or_admin on public.audit_log
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.profiles p
               where p.id = (select auth.uid()) and p.role = 'admin')
  );

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;
-- Append-only i za server: bez UPDATE/DELETE/TRUNCATE. Briše samo retencija (pg_cron, vlasnik baze).
grant select, insert on public.audit_log to service_role;

-- 4. IP burst brojač (fiksni prozor). Samo za server; korisnici ga ne vide.
create table public.ip_rate_limit (
  ip           inet not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (ip, window_start)
);

create index ip_rate_limit_window_start_idx on public.ip_rate_limit (window_start);

alter table public.ip_rate_limit enable row level security;
-- Namerno bez polisa: authenticated/anon nemaju ni grant ni polisu.
revoke all on public.ip_rate_limit from public, anon, authenticated, service_role;
grant select, insert, update on public.ip_rate_limit to service_role;

-- 5. Atomska rezervacija. Izuzetak od pravila 4 (prima user_id): poziva je SAMO service_role,
--    a ID dolazi iz verifikovanog korisnika na serveru. Advisory lock po korisniku serijalizuje
--    paralelne zahteve, pa ne mogu zajedno da prođu preko limita.
--    Dan i mesec se računaju po beogradskom vremenu (limit se resetuje u ponoć kod korisnika).
create function public.reserve_usage(
  p_user_id             uuid,
  p_kind                text,
  p_estimated_tokens    integer,
  p_daily_count_limit   integer,
  p_daily_token_limit   bigint,
  p_monthly_token_limit bigint
)
returns table (
  allowed        boolean,
  reservation_id uuid,
  reason         text,
  daily_count    integer,
  daily_tokens   bigint,
  monthly_tokens bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_local_now   timestamp := now() at time zone 'Europe/Belgrade';
  v_day_start   timestamptz := date_trunc('day', v_local_now) at time zone 'Europe/Belgrade';
  v_month_start timestamptz := date_trunc('month', v_local_now) at time zone 'Europe/Belgrade';
  v_estimate    integer := greatest(coalesce(p_estimated_tokens, 0), 0);
  v_count       integer;
  v_day_tokens  bigint;
  v_mon_tokens  bigint;
  v_id          uuid;
begin
  if p_user_id is null or p_kind is null or p_kind not in ('chat', 'ingest') then
    raise exception 'reserve_usage: neispravni argumenti' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('usage:' || p_user_id::text, 0));

  -- Broj zahteva: oslobođene rezervacije (greška servisa) se ne broje.
  select count(*) into v_count
  from public.usage_ledger l
  where l.user_id = p_user_id and l.kind = p_kind
    and l.status <> 'released' and l.created_at >= v_day_start;

  -- Tokeni (chat + ingest zajedno): rezervacija se računa po proceni, ostalo po stvarnoj potrošnji.
  select
    coalesce(sum(case when l.status = 'reserved' then l.reserved_tokens
                      else l.input_tokens + l.output_tokens + l.embed_tokens end)
             filter (where l.created_at >= v_day_start), 0),
    coalesce(sum(case when l.status = 'reserved' then l.reserved_tokens
                      else l.input_tokens + l.output_tokens + l.embed_tokens end), 0)
  into v_day_tokens, v_mon_tokens
  from public.usage_ledger l
  where l.user_id = p_user_id and l.created_at >= v_month_start;

  if v_count >= p_daily_count_limit then
    return query select false, null::uuid, 'daily_count'::text, v_count, v_day_tokens, v_mon_tokens;
    return;
  end if;
  if v_day_tokens + v_estimate > p_daily_token_limit then
    return query select false, null::uuid, 'daily_tokens'::text, v_count, v_day_tokens, v_mon_tokens;
    return;
  end if;
  if v_mon_tokens + v_estimate > p_monthly_token_limit then
    return query select false, null::uuid, 'monthly_tokens'::text, v_count, v_day_tokens, v_mon_tokens;
    return;
  end if;

  insert into public.usage_ledger (user_id, kind, reserved_tokens)
  values (p_user_id, p_kind, v_estimate)
  returning id into v_id;

  return query select true, v_id, null::text, v_count + 1, v_day_tokens + v_estimate, v_mon_tokens + v_estimate;
end;
$$;

-- Zatvaranje rezervacije stvarnom potrošnjom. p_release = true: poziv nije uspeo, zahtev se ne
-- broji u dnevni limit, ali tokeni potrošeni pre greške (npr. Voyage) i dalje ulaze u budžet.
create function public.close_usage(
  p_reservation_id uuid,
  p_user_id        uuid,
  p_input_tokens   integer,
  p_output_tokens  integer,
  p_embed_tokens   integer,
  p_release        boolean default false
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  with closed as (
    update public.usage_ledger
    set status        = case when p_release then 'released' else 'settled' end,
        input_tokens  = greatest(coalesce(p_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(p_output_tokens, 0), 0),
        embed_tokens  = greatest(coalesce(p_embed_tokens, 0), 0),
        closed_at     = now()
    where id = p_reservation_id and user_id = p_user_id and status = 'reserved'
    returning 1
  )
  select exists (select 1 from closed);
$$;

-- IP burst: vraća true ako je zahtev dozvoljen. Fiksni prozor od p_window_seconds sekundi.
create function public.hit_ip_rate_limit(
  p_ip             inet,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  insert into public.ip_rate_limit as r (ip, window_start, hits)
  values (p_ip,
          to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
          1)
  on conflict (ip, window_start) do update set hits = r.hits + 1
  returning hits <= p_limit;
$$;

revoke execute on function public.reserve_usage(uuid, text, integer, integer, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.close_usage(uuid, uuid, integer, integer, integer, boolean)  from public, anon, authenticated;
revoke execute on function public.hit_ip_rate_limit(inet, integer, integer)                    from public, anon, authenticated;
grant  execute on function public.reserve_usage(uuid, text, integer, integer, bigint, bigint) to service_role;
grant  execute on function public.close_usage(uuid, uuid, integer, integer, integer, boolean)  to service_role;
grant  execute on function public.hit_ip_rate_limit(inet, integer, integer)                    to service_role;

-- 6. Pregled potrošnje za prikaz u aplikaciji (pravilo 4: korisnik iz JWT-a, RLS važi).
create function public.get_usage_summary()
returns table (
  daily_messages  integer,
  daily_documents integer,
  daily_tokens    bigint,
  monthly_tokens  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select date_trunc('day',   now() at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade' as day_start,
           date_trunc('month', now() at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade' as month_start
  ),
  ledger as (
    select l.*,
           case when l.status = 'reserved' then l.reserved_tokens
                else l.input_tokens + l.output_tokens + l.embed_tokens end as tokens
    from public.usage_ledger l, bounds b
    where l.user_id = (select auth.uid()) and l.created_at >= b.month_start
  )
  select
    (count(*) filter (where r.kind = 'chat'   and r.status <> 'released' and r.created_at >= b.day_start))::integer,
    (count(*) filter (where r.kind = 'ingest' and r.status <> 'released' and r.created_at >= b.day_start))::integer,
    coalesce(sum(r.tokens) filter (where r.created_at >= b.day_start), 0)::bigint,
    coalesce(sum(r.tokens), 0)::bigint
  from bounds b left join ledger r on true
  group by b.day_start;
$$;

revoke execute on function public.get_usage_summary() from public, anon;
grant  execute on function public.get_usage_summary() to authenticated;

-- 7. Retencija (pg_cron, radi kao vlasnik baze): audit log 90 dana, IP brojač 1 dan.
--    Ledger se ne briše (mali je, a služi kao dokaz potrošnje za obračun).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.schedule('audit-log-retention-90d', '15 3 * * *',
  $$delete from public.audit_log where created_at < now() - interval '90 days'$$);
select cron.schedule('ip-rate-limit-cleanup', '30 * * * *',
  $$delete from public.ip_rate_limit where window_start < now() - interval '1 day'$$);

commit;
