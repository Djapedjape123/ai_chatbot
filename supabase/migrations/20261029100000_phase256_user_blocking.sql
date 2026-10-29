-- FAZA 2.5.6: blokada naloga u bazi (profiles.disabled_at) i "bar jedan AKTIVAN admin".
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
--
-- Zašto: blokada preko Supabase Auth-a (banned_until) sprečava prijavu i osvežavanje sesije, ali pristupni token
-- (JWT) koji je već izdat važi do isteka, a ni za Auth server nije potvrđeno da ga getUser() odbija. Zato
-- blokada dobija i svoju oznaku u profilu: aplikacija je proverava pri svakom zahtevu (requireUser), a
-- private.is_admin() je proverava u bazi, pa blokiran admin sa još važećim tokenom gubi admin prava odmah.
--
-- Migracija menja dve stvari iz 2.5.1 (private.is_admin() i okidač poslednjeg admina) i zamenjuje dve admin
-- funkcije novom kolonom u rezultatu (create or replace ne može da promeni povratne kolone). Kod koji postoji
-- do sada ne koristi ništa od toga, pa se primenjuje PRE deploy-a koda 2.5.6.
--
-- NAPOMENA (poznata rupa, nije u ovoj migraciji): blokirani advokat sa još važećim tokenom i dalje može preko
-- REST API-ja da čita SVOJE redove (RLS ga ne proverava). Rešenje je ista restriktivna polisa kao za MFA
-- (docs/next-steps.md, C6), pa traži posebnu odluku.
begin;

-- 1. Oznaka blokade. Postavlja je samo admin_set_disabled (ili server/vlasnik baze); authenticated nema UPDATE
--    na profiles (Faza 1), a SELECT sopstvenog profila mu je već dozvoljen.
alter table public.profiles add column if not exists disabled_at timestamptz;

-- 2. Admin = uloga admin I aal2 I nalog nije blokiran.
create or replace function private.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.role = 'admin' and p.disabled_at is null);
$$;

-- 3. Uvek bar jedan AKTIVAN admin: ne samo da uloga admin postoji, nego i da taj admin nije blokiran.
--    Okida se i na promenu disabled_at. Isti advisory lock serijalizuje paralelne blokade/skidanja uloge.
create or replace function private.ensure_admin_remains()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('office:admins', 0));
  if not exists (select 1 from public.profiles p where p.role = 'admin' and p.disabled_at is null) then
    raise exception 'Kancelarija mora imati bar jednog aktivnog admina.' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin
  after update of role, disabled_at or delete on public.profiles
  for each row when (old.role = 'admin')
  execute function private.ensure_admin_remains();

-- 4. Admin funkcije vraćaju i disabled_at (posle banned_until). Nova verzija zamenjuje staru; admin_get_user
--    zavisi od admin_list_users, pa se prva briše prva, a pravi poslednja.
drop function public.admin_get_user(uuid);
drop function public.admin_list_users();

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
  disabled_at        timestamptz,
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
         p.disabled_at,
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
  disabled_at        timestamptz,
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

-- 5. Blokada i odblokada. Provere i audit su atomski u bazi (funkciju je moguće pozvati i direktno preko REST-a);
--    poslednjeg aktivnog admina čuva okidač iz koraka 3. Poziv koji ne menja stanje ne radi ništa i ne piše audit.
--    Greške: 42501 (nije admin ili nema aal2), 22023 (neispravan zahtev, blokada sopstvenog naloga),
--    P0002 (nalog ne postoji), 23514 (poslednji aktivni admin).
create function public.admin_set_disabled(p_user_id uuid, p_disabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_old timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Zabranjeno.' using errcode = '42501';
  end if;
  if p_user_id is null or p_disabled is null then
    raise exception 'Neispravan zahtev.' using errcode = '22023';
  end if;
  if p_disabled and p_user_id = (select auth.uid()) then
    raise exception 'Ne možete blokirati sopstveni nalog.' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'Korisnik nije pronađen.' using errcode = 'P0002';
  end if;

  -- Nalog bez profila (stariji nalozi, dijagnostika Faze 2) dobija profil kao u migraciji 2.1,
  -- inače blokada ne bi imala gde da se upiše.
  insert into public.profiles (id, full_name, email)
  select u.id, u.raw_user_meta_data ->> 'full_name', u.email
  from auth.users u
  where u.id = p_user_id
  on conflict (id) do nothing;

  select p.disabled_at into v_old from public.profiles p where p.id = p_user_id for update;
  if (v_old is not null) = p_disabled then
    return;
  end if;

  update public.profiles
  set disabled_at = case when p_disabled then now() else null end
  where id = p_user_id;

  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id)
  values ((select auth.uid()),
          (select u.email::text from auth.users u where u.id = (select auth.uid())),
          case when p_disabled then 'user_disabled' else 'user_enabled' end,
          'user', p_user_id);
end;
$$;

revoke execute on function public.admin_list_users()                   from public, anon;
revoke execute on function public.admin_get_user(uuid)                 from public, anon;
revoke execute on function public.admin_set_disabled(uuid, boolean)    from public, anon;
grant  execute on function public.admin_list_users()                   to authenticated;
grant  execute on function public.admin_get_user(uuid)                 to authenticated;
grant  execute on function public.admin_set_disabled(uuid, boolean)    to authenticated;

commit;
