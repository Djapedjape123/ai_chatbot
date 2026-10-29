-- Osnova za lokalnu proveru SQL migracija i testova (PGlite): stanje Supabase baze PRE Faze 1.
-- NIJE migracija i nikad se ne primenjuje na pravu bazu. Služi samo tools/verify/run-sql-tests.mjs.
--
-- Šta je namerno pojednostavljeno u odnosu na pravi Supabase (vidi tools/verify/README.md, "SQL harness"):
--   * PGlite radi kao superkorisnik `postgres`. Pravi SQL Editor takođe radi kao `postgres`, ali u pravom
--     Supabase-u `postgres` NIJE superkorisnik, pa se greške tipa "permission denied" za `postgres` ovde ne vide.
--   * auth.users i auth.mfa_factors imaju samo kolone koje naš SQL čita; nema GoTrue okidača ni drugih tabela.
--   * pg_cron je nadomešten tabelom cron.job i funkcijom cron.schedule (migracija 2 se pre izvršavanja
--     lišava naredbi create extension pg_cron / grant ... cron, vidi lib/pglite-db.mjs).
--   * Kolone pre Faze 1 su rekonstruisane iz koda i migracije Faze 1 (dijagnostika nije sačuvana).

-- 1. Uloge kao u Supabase-u. service_role zaobilazi RLS.
create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin bypassrls;

create schema if not exists extensions;
create extension if not exists vector with schema public;

-- 2. Šema auth: samo ono što naš SQL koristi.
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id        uuid,
  id                 uuid primary key,
  aud                varchar(255),
  role               varchar(255),
  email              varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at         timestamptz,
  last_sign_in_at    timestamptz,
  banned_until       timestamptz,
  raw_app_meta_data  jsonb,
  raw_user_meta_data jsonb,
  created_at         timestamptz,
  updated_at         timestamptz
);

create type auth.factor_type   as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');

create table auth.mfa_factors (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type   auth.factor_type   not null default 'totp',
  status        auth.factor_status not null default 'unverified',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Isti oblik kao u Supabase-u: oba izvora (claims kao JSON i pojedinačni claim) se čitaju iz konfiguracije sesije.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;

-- 3. pg_cron zamena: tabela koju čita phase2 test i funkcija koju zove migracija 2.
create schema cron;
create table cron.job (
  jobid    bigint generated always as identity primary key,
  schedule text not null,
  command  text not null,
  jobname  text unique,
  active   boolean not null default true
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

-- 4. Supabase podrazumevano daje API ulogama sve nad novim objektima u public (zato Faza 1 to ukida).
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- 5. Šema aplikacije pre Faze 1.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  email      text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  user_id    uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.document_chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents (id) on delete cascade,
  content     text not null,
  embedding   public.vector(1024),
  created_at  timestamptz not null default now()
);
create index document_chunks_embedding_idx on public.document_chunks
  using hnsw (embedding public.vector_cosine_ops);

create table public.chats (
  id         uuid primary key default gen_random_uuid(),
  title      text,
  user_id    uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid references public.chats (id) on delete cascade,
  role       text not null,
  content    text not null,
  created_at timestamptz not null default now()
);
create index messages_chat_id_idx on public.messages (chat_id, created_at);

-- Stare "ALL" polise za sve (Faza 1 ih briše).
create policy "documents all"       on public.documents       for all using (true) with check (true);
create policy "document_chunks all" on public.document_chunks for all using (true) with check (true);
create policy "chats all"           on public.chats           for all using (true) with check (true);
create policy "messages all"        on public.messages        for all using (true) with check (true);
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chats           enable row level security;
alter table public.messages        enable row level security;

create function public.get_daily_message_count(input_user_id uuid) returns integer language sql as $$
  select count(*)::integer
  from public.messages m join public.chats c on c.id = m.chat_id
  where c.user_id = input_user_id and m.role = 'user' and m.created_at >= date_trunc('day', now())
$$;

create function public.match_document_chunks(
  query_embedding public.vector(1024),
  match_count     integer,
  filter_user_id  uuid
)
returns table (document_title text, content text, similarity double precision)
language sql stable as $$
  select d.title, c.content, 1 - (c.embedding <=> query_embedding)
  from public.document_chunks c join public.documents d on d.id = c.document_id
  where d.user_id = filter_user_id
  order by c.embedding <=> query_embedding
  limit match_count
$$;
