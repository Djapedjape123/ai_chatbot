-- FAZA 2.5: admin panel kancelarije (uloga + MFA, uske RPC funkcije, podešavanja, poslednji admin).
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
--
-- Migracija SAMO DODAJE (novu šemu, tabelu i funkcije) i proširuje dve stvari iz Faze 2: CHECK liste
-- audit_log i njegovu SELECT polisu. Kod koji postoji do sada ne koristi ništa od toga, pa se migracija
-- primenjuje PRE deploy-a koda Faze 2.5.
--
-- Model pristupa (docs/admin-panel-plan.md): admin NIJE superkorisnik nad podacima.
--   * Na documents, document_chunks, chats, messages, usage_ledger i profiles NEMA nijedne admin polise.
--     Pasusi i poruke ostaju vidljivi samo vlasniku.
--   * Admin čita tuđe podatke samo preko četiri uske security definer funkcije (dokumentovan izuzetak od
--     pravila 4 iz CLAUDE.md): vraćaju nazive, datume i brojeve, nikad sadržaj. Svaka počinje proverom
--     private.is_admin() (uloga admin I aal2 u JWT-u) i baca 42501 ako ne prođe.
--   * Audit log čita preko postojeće RLS polise, sa istim uslovom (invoker, bez security definer-a).
begin;

-- 1. Pomoćna šema van API-ja. PostgREST izlaže samo public, pa private nije dostupna preko /rest/v1.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Admin = uloga admin I MFA u ovoj sesiji (aal2). Invoker: korisnik ionako vidi svoj profil (RLS).
-- Ne postoji put da uloga sama otvori admin pristup, a ni da MFA bez uloge to uradi.
create function private.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin');
$$;

revoke execute on function private.is_admin() from public, anon;
grant  execute on function private.is_admin() to authenticated;

-- 2. Audit log: nove akcije i tipovi resursa (admin radnje). Postojeći zapisi i dalje prolaze.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check check (action in (
  'document_uploaded', 'document_upload_blocked', 'document_deleted',
  'chat_created', 'chat_deleted', 'question_asked',
  'limit_reached', 'suspicious_content_flagged',
  'user_invited', 'user_disabled', 'user_enabled', 'role_changed',
  'settings_changed', 'admin_viewed_user', 'audit_exported', 'mfa_enrolled'));

alter table public.audit_log drop constraint if exists audit_log_resource_type_check;
alter table public.audit_log add constraint audit_log_resource_type_check
  check (resource_type in ('document', 'chat', 'user', 'settings'));

-- Admin vidi tuđe zapise samo sa MFA (aal2). Advokat i dalje vidi samo svoje.
drop policy if exists audit_log_select_own_or_admin on public.audit_log;
create policy audit_log_select_own_or_admin on public.audit_log
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- 3. Podešavanja kancelarije: jedan red. Čitaju svi prijavljeni (upozorenje na 80%) i server (limiti),
--    a menja samo admin_update_settings. Env varijable ostaju gornja granica (važi min, u kodu).
create table public.office_settings (
  id                    boolean primary key default true check (id),
  daily_message_limit   integer not null default 100      check (daily_message_limit between 1 and 10000),
  daily_document_limit  integer not null default 20       check (daily_document_limit between 1 and 1000),
  daily_token_budget    bigint  not null default 1000000  check (daily_token_budget > 0),
  monthly_token_budget  bigint  not null default 20000000 check (monthly_token_budget > 0),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id) on delete set null
);

insert into public.office_settings default values;

alter table public.office_settings enable row level security;
create policy office_settings_select on public.office_settings
  for select to authenticated using (true);

revoke all on public.office_settings from public, anon, authenticated, service_role;
grant select on public.office_settings to authenticated, service_role;

-- 4. Uvek bar jedan admin (štiti i od greške u SQL Editoru ili u serverskom kodu).
--    Okida se samo kada je OLD bio admin, pa prvo postavljanje admina (lawyer -> admin) prolazi.
--    Advisory lock serijalizuje paralelno skidanje dva admina: drugi vidi rezultat prvog i puca.
create function private.ensure_admin_remains()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('office:admins', 0));
  if not exists (select 1 from public.profiles p where p.role = 'admin') then
    raise exception 'Kancelarija mora imati bar jednog admina.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke execute on function private.ensure_admin_remains() from public, anon, authenticated;

create trigger profiles_keep_one_admin
  after update of role or delete on public.profiles
  for each row when (old.role = 'admin')
  execute function private.ensure_admin_remains();

-- 5. Admin RPC funkcije. Sve: security definer (čitaju auth.users i tuđe redove), prazan search_path,
--    provera private.is_admin() kao prvi korak, EXECUTE samo za authenticated.
--    Dan i mesec se računaju po beogradskom vremenu, kao u get_usage_summary().

-- Pregled advokata: podaci o nalogu i brojevi. Bez naziva dokumenata i bez ikakvog sadržaja.
create function public.admin_list_users()
returns table (
  id                 uuid,
  email              text,
  full_name          text,
  role               text,
  created_at         timestamptz,
  invited_at         timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  has_mfa            boolean,
  documents_count    integer,
  chats_count        integer,
  daily_messages     integer,
  daily_documents    integer,
  daily_tokens       bigint,
  monthly_tokens     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start   timestamptz := date_trunc('day',   now() at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Belgrade') at time zone 'Europe/Belgrade';
begin
  if not private.is_admin() then
    raise exception 'Zabranjeno.' using errcode = '42501';
  end if;

  return query
  select u.id,
         u.email::text,
         p.full_name::text,
         p.role,
         u.created_at,
         u.invited_at,
         u.email_confirmed_at,
         u.last_sign_in_at,
         u.banned_until,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'),
         (select count(*)::integer from public.documents d where d.user_id = u.id),
         (select count(*)::integer from public.chats c where c.user_id = u.id),
         coalesce(us.daily_messages, 0),
         coalesce(us.daily_documents, 0),
         coalesce(us.daily_tokens, 0)::bigint,
         coalesce(us.monthly_tokens, 0)::bigint
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join lateral (
    select (count(*) filter (where l.kind = 'chat'   and l.status <> 'released' and l.created_at >= v_day_start))::integer as daily_messages,
           (count(*) filter (where l.kind = 'ingest' and l.status <> 'released' and l.created_at >= v_day_start))::integer as daily_documents,
           sum(case when l.status = 'reserved' then l.reserved_tokens
                    else l.input_tokens + l.output_tokens + l.embed_tokens end)
               filter (where l.created_at >= v_day_start) as daily_tokens,
           sum(case when l.status = 'reserved' then l.reserved_tokens
                    else l.input_tokens + l.output_tokens + l.embed_tokens end) as monthly_tokens
    from public.usage_ledger l
    where l.user_id = u.id and l.created_at >= v_month_start
  ) us on true
  order by u.created_at, u.id;
end;
$$;

-- Jedan advokat: isto što i lista, plus nazivi i datumi dokumenata i razgovora (ID, naslov, datum, broj
-- pasusa/poruka). BEZ content kolona. Svaki pregled postojećeg korisnika se upisuje u audit log u istoj
-- transakciji: funkciju je moguće pozvati i direktno preko REST API-ja, pa beleženje u kodu ne bi bilo dovoljno.
create function public.admin_get_user(p_user_id uuid)
returns table (
  id                 uuid,
  email              text,
  full_name          text,
  role               text,
  created_at         timestamptz,
  invited_at         timestamptz,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  has_mfa            boolean,
  documents_count    integer,
  chats_count        integer,
  daily_messages     integer,
  daily_documents    integer,
  daily_tokens       bigint,
  monthly_tokens     bigint,
  documents          jsonb,
  chats              jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Zabranjeno.' using errcode = '42501';
  end if;

  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    return;
  end if;

  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id)
  values ((select auth.uid()),
          (select u.email::text from auth.users u where u.id = (select auth.uid())),
          'admin_viewed_user', 'user', p_user_id);

  return query
  select l.*,
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', d.id,
                    'title', d.title,
                    'created_at', d.created_at,
                    'chunk_count', (select count(*) from public.document_chunks ch where ch.document_id = d.id))
                  order by d.created_at desc, d.id), '[]'::jsonb)
          from public.documents d where d.user_id = l.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id,
                    'title', c.title,
                    'created_at', c.created_at,
                    'message_count', (select count(*) from public.messages m where m.chat_id = c.id))
                  order by c.created_at desc, c.id), '[]'::jsonb)
          from public.chats c where c.user_id = l.id)
  from public.admin_list_users() l
  where l.id = p_user_id;
end;
$$;

-- Promena uloge. Provere i audit su atomski u bazi; poslednjeg admina čuva trigger iz koraka 4.
create function public.admin_set_role(p_user_id uuid, p_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if not private.is_admin() then
    raise exception 'Zabranjeno.' using errcode = '42501';
  end if;
  if p_user_id is null or p_role is null or p_role not in ('admin', 'lawyer') then
    raise exception 'Nepoznata uloga.' using errcode = '22023';
  end if;

  select p.role into v_old from public.profiles p where p.id = p_user_id for update;
  if not found then
    raise exception 'Korisnik nije pronađen.' using errcode = 'P0002';
  end if;
  if v_old = p_role then
    return;
  end if;

  update public.profiles set role = p_role where id = p_user_id;

  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id, metadata)
  values ((select auth.uid()),
          (select u.email::text from auth.users u where u.id = (select auth.uid())),
          'role_changed', 'user', p_user_id, jsonb_build_object('from', v_old, 'to', p_role));
end;
$$;

-- Promena podešavanja kancelarije. Opseg čuvaju CHECK ograničenja tabele (23514); NULL je 22023.
create function public.admin_update_settings(
  p_daily_message_limit  integer,
  p_daily_document_limit integer,
  p_daily_token_budget   bigint,
  p_monthly_token_budget bigint
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
begin
  if not private.is_admin() then
    raise exception 'Zabranjeno.' using errcode = '42501';
  end if;
  if p_daily_message_limit is null or p_daily_document_limit is null
     or p_daily_token_budget is null or p_monthly_token_budget is null then
    raise exception 'Sva podešavanja moraju imati vrednost.' using errcode = '22023';
  end if;

  select jsonb_build_object(
           'daily_message_limit',  s.daily_message_limit,
           'daily_document_limit', s.daily_document_limit,
           'daily_token_budget',   s.daily_token_budget,
           'monthly_token_budget', s.monthly_token_budget)
  into v_old
  from public.office_settings s
  where s.id
  for update;

  update public.office_settings
  set daily_message_limit  = p_daily_message_limit,
      daily_document_limit = p_daily_document_limit,
      daily_token_budget   = p_daily_token_budget,
      monthly_token_budget = p_monthly_token_budget,
      updated_at           = now(),
      updated_by           = (select auth.uid())
  where id;

  insert into public.audit_log (user_id, actor_email, action, resource_type, metadata)
  values ((select auth.uid()),
          (select u.email::text from auth.users u where u.id = (select auth.uid())),
          'settings_changed', 'settings',
          jsonb_build_object('old', v_old,
                             'new', jsonb_build_object(
                               'daily_message_limit',  p_daily_message_limit,
                               'daily_document_limit', p_daily_document_limit,
                               'daily_token_budget',   p_daily_token_budget,
                               'monthly_token_budget', p_monthly_token_budget)));
end;
$$;

revoke execute on function public.admin_list_users()                                       from public, anon;
revoke execute on function public.admin_get_user(uuid)                                     from public, anon;
revoke execute on function public.admin_set_role(uuid, text)                               from public, anon;
revoke execute on function public.admin_update_settings(integer, integer, bigint, bigint)  from public, anon;
grant  execute on function public.admin_list_users()                                       to authenticated;
grant  execute on function public.admin_get_user(uuid)                                     to authenticated;
grant  execute on function public.admin_set_role(uuid, text)                               to authenticated;
grant  execute on function public.admin_update_settings(integer, integer, bigint, bigint)  to authenticated;

commit;
