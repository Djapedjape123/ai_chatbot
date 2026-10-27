-- FAZA 1: izolacija podataka po advokatu (RLS + kompozitni FK + zaključani RPC).
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
-- Prilagođeno prema dijagnostici od 2026-10-27 (supabase/diagnostics/phase1_audit.sql):
-- pgvector 0.8.2 u šemi public, vector(1024), HNSW indeks postoji, realtime publikacija prazna,
-- 3 korisnika / 3 razgovora / 9 poruka / 0 dokumenata, nema siročića ni redova bez vlasnika.
begin;

-- 1. Siročići: pasusi/poruke čiji roditelj više ne postoji (zaostali poverljivi podaci).
--    Redovi sa NULL roditeljem su takođe siročići (NULL se nikad ne poklapa), pa i oni nestaju.
delete from public.document_chunks c
where not exists (select 1 from public.documents d where d.id = c.document_id);

delete from public.messages m
where not exists (select 1 from public.chats ch where ch.id = m.chat_id);

-- 2. Vlasnik i roditelj su obavezni. Ako postoji red bez njih, migracija namerno puca.
--    chat_id/document_id MORAJU biti NOT NULL: kompozitni FK je MATCH SIMPLE, pa se
--    bez toga red sa NULL roditeljem ne proverava uopšte i zaobilazi zaštitu vlasništva.
alter table public.documents       alter column user_id     set not null;
alter table public.chats           alter column user_id     set not null;
alter table public.document_chunks alter column document_id set not null;
alter table public.messages        alter column chat_id     set not null;

-- Brisanje naloga advokata NE briše njegove spise (RESTRICT): to mora biti svesna odluka.
-- (Do sada je bilo ON DELETE CASCADE.)
alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.documents add constraint documents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;
alter table public.chats drop constraint if exists chats_user_id_fkey;
alter table public.chats add constraint chats_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete restrict;

-- 3. Ciljni ključevi za kompozitne FK.
alter table public.documents add constraint documents_id_user_id_key unique (id, user_id);
alter table public.chats     add constraint chats_id_user_id_key     unique (id, user_id);

-- 4. user_id na decu + popuna iz roditelja.
alter table public.document_chunks add column if not exists user_id uuid;
update public.document_chunks c set user_id = d.user_id
from public.documents d
where d.id = c.document_id and c.user_id is distinct from d.user_id;
alter table public.document_chunks alter column user_id set not null;

alter table public.messages add column if not exists user_id uuid;
update public.messages m set user_id = ch.user_id
from public.chats ch
where ch.id = m.chat_id and m.user_id is distinct from ch.user_id;
alter table public.messages alter column user_id set not null;

-- 5. Kompozitni FK: pasus/poruka MORA imati istog vlasnika kao roditelj.
--    Stari jednostruki FK (document_chunks_document_id_fkey, messages_chat_id_fkey)
--    zamenjujemo novim, sa kaskadnim brisanjem.
do $$
declare r record;
begin
  for r in
    select conrelid::regclass as tbl, conname from pg_constraint
    where contype = 'f'
      and ((conrelid = 'public.document_chunks'::regclass and confrelid = 'public.documents'::regclass)
        or (conrelid = 'public.messages'::regclass and confrelid = 'public.chats'::regclass))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.document_chunks add constraint document_chunks_owner_fkey
  foreign key (document_id, user_id) references public.documents (id, user_id)
  on update cascade on delete cascade;
alter table public.messages add constraint messages_owner_fkey
  foreign key (chat_id, user_id) references public.chats (id, user_id)
  on update cascade on delete cascade;

-- 6. Indeksi za RLS filtere i kaskadno brisanje.
--    messages_chat_id_idx je prefiks novog messages_owner_created_at_idx, pa postaje suvišan.
drop index if exists public.messages_chat_id_idx;
create index if not exists documents_user_id_created_at_idx on public.documents (user_id, created_at desc);
create index if not exists chats_user_id_created_at_idx     on public.chats (user_id, created_at desc);
create index if not exists document_chunks_owner_idx        on public.document_chunks (document_id, user_id);
create index if not exists document_chunks_user_id_idx      on public.document_chunks (user_id);
create index if not exists messages_owner_created_at_idx    on public.messages (chat_id, user_id, created_at);
create index if not exists messages_user_id_created_at_idx  on public.messages (user_id, created_at);

-- 7. RLS uključen; brišemo SVE stare polise da ne ostane neka "permissive" rupa.
--    Stare "ALL" polise (roles = public) davale su authenticated i INSERT/UPDATE nad svim
--    tabelama, uključujući ubacivanje lažnih "assistant" poruka i pasusa mimo MAX_CHUNKS.
alter table public.documents       enable row level security;
alter table public.document_chunks enable row level security;
alter table public.chats           enable row level security;
alter table public.messages        enable row level security;

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('documents', 'document_chunks', 'chats', 'messages')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 8. Polise: advokat čita i briše ISKLJUČIVO svoje redove.
--    INSERT/UPDATE polisa namerno nema: upisuje samo server, a vlasništvo čuva kompozitni FK.
create policy documents_select_own on public.documents
  for select to authenticated using (user_id = (select auth.uid()));
create policy documents_delete_own on public.documents
  for delete to authenticated using (user_id = (select auth.uid()));

create policy document_chunks_select_own on public.document_chunks
  for select to authenticated using (user_id = (select auth.uid()));

create policy chats_select_own on public.chats
  for select to authenticated using (user_id = (select auth.uid()));
create policy chats_delete_own on public.chats
  for delete to authenticated using (user_id = (select auth.uid()));

create policy messages_select_own on public.messages
  for select to authenticated using (user_id = (select auth.uid()));

-- 9. Privilegije: anon NEMA NIŠTA; authenticated samo ono što polise pokrivaju.
--    Do sada su anon i authenticated imali pun CRUD grant (default Supabase ACL), a štitio je samo RLS.
revoke all on public.documents, public.document_chunks, public.chats, public.messages
  from public, anon, authenticated;
grant select, delete on public.documents, public.chats to authenticated;
grant select on public.document_chunks, public.messages to authenticated;

-- 9b. profiles: aplikacija je ne koristi (puni je samo trigger on_auth_user_created), a anon je
--     imao pun CRUD grant. Ostaje samo čitanje sopstvenog profila.
drop policy if exists "own profile select" on public.profiles;
drop policy if exists "own profile update" on public.profiles;
revoke all on public.profiles from public, anon, authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
grant select on public.profiles to authenticated;

-- 10. Vektorska pretraga: korisnik se određuje iz JWT-a, NE iz parametra.
--     Povratne kolone su dovoljne za app/api/chat/route.ts (koristi samo document_title i content).
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'match_document_chunks' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.match_document_chunks(
  query_embedding vector(1024),
  match_count integer default 8
)
returns table (document_title text, content text, similarity double precision)
language sql
stable
security invoker
set search_path = public, extensions
-- pgvector 0.8.x: bez ovoga HNSW + filter po user_id može da vrati manje od match_count redova.
set hnsw.iterative_scan = 'strict_order'
as $$
  select d.title::text,
         c.content::text,
         1 - (c.embedding <=> query_embedding)
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.user_id = (select auth.uid())
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_document_chunks(vector, integer) from public, anon, authenticated;
grant execute on function public.match_document_chunks(vector, integer) to authenticated;

-- 11. Brojač poruka za rate limit: dozvoljen samo serveru (service_role).
--     (Faza 2 ga zamenjuje usage ledger-om.)
alter function public.get_daily_message_count(uuid) set search_path = public;
revoke execute on function public.get_daily_message_count(uuid) from public, anon, authenticated;
grant execute on function public.get_daily_message_count(uuid) to service_role;

-- 11b. Trigger funkcija za nove naloge: SECURITY DEFINER ne sme biti dostupna preko /rest/v1/rpc.
--      EXECUTE se za trigger proverava samo pri CREATE TRIGGER, pa on_auth_user_created radi dalje.
--      Telo već koristi public.profiles, pa prazan search_path ne menja ponašanje.
alter function public.handle_new_user() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 12. Zero-trust podrazumevano: nove tabele/funkcije koje kreira ova uloga u public NISU
--     automatski izložene API-ju. (Realtime publikacija je prazna, nema šta da se uklanja.)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

commit;
