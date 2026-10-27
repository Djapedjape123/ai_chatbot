@AGENTS.md

# Pravni AI asistent (RAG): Enterprise Security Roadmap

Next.js 16 + Supabase (Postgres + pgvector) + Voyage AI (`voyage-law-2`, 1024 dimenzije) + Claude.
Cilj je da se proizvod prodaje advokatskim kancelarijama kao B2B rešenje. Zahtevi su zero-trust arhitektura, zaštita poverljivosti klijenata (DLP) i usklađenost sa NDA ugovorima.

## Status faza

- [ ] **FAZA 1: Supabase i baza (izolacija podataka).** Korak 1 (dijagnostika) urađen 2026-10-27 preko Supabase MCP-a (`.mcp.json`, `read_only=true`). Migracija `supabase/migrations/20261027120000_phase1_data_isolation.sql` je napisana i prilagođena, **nije primenjena**. Korak 3 (kod) je urađen na grani `phase1-data-isolation` (**nije commit-ovan ni deploy-ovan**): `tsc` čist, `npm run lint` 0 grešaka, `npm run build` prolazi, a `server-only` je proveren negativnim testom (build pada kad klijentska komponenta uveze `lib/supabase.ts`). Test `supabase/tests/phase1_rls_test.sql` je napisan, ali **još nije pokrenut** (traži primenjenu migraciju; statički deo je proveren nad nemigriranom bazom i pravilno puca sa `CURENJE: 8 polisa važi za anon/public`). Sledeće: Korak 0 (backup, radi vlasnik), pa Korak 4 (migracija i odmah deploy), pa test, curl napad, Advisors i E2E. Rute sada vraćaju 404 umesto 403 za tuđe razgovore (tuđi izgleda isto kao nepostojeći), a frontend ne zavisi od tih kodova. Kod radi tek uz primenjenu migraciju: na staroj bazi pada RPC (nema potpisa bez `filter_user_id`) i upis poruka (nema kolone `user_id`), zato migracija i deploy idu zajedno.
- [ ] **FAZA 2: Zaštita API ruta.** Rate limiting, prompt injection, zod validacija, audit log.
- [ ] **FAZA 3: Bezbednost fajlova.** PDF/Word, malware, makroi.
- [ ] **FAZA 4: Enterprise arhitektura.** On-prem instalacija preko Docker-a.

Pravilo: faze idu redom. Sledeća faza počinje tek kada je prethodna završena i verifikovana.

## Arhitektonske odluke

- **Izolacija po advokatu.** Svaki advokat (korisnik) vidi isključivo svoje dokumente, pasuse, razgovore i poruke.
- **Jedan Supabase projekat (ili on-prem instanca) po kancelariji (silo).** Granicu između firmi čuva infrastruktura, a granicu između advokata čuva RLS.
- **Postojeći podaci se čuvaju.** Migracije ne brišu podatke, osim siročića (pasusa i poruka bez roditelja).
- **Hibridni pristup bazi.** Čitanja idu preko korisnikovog JWT-a (RLS ih ograničava). Upisi idu preko `service_role`, a kompozitni FK u bazi čuva vlasništvo.
- **Javna registracija je isključena.** Advokate poziva admin kancelarije (Supabase Auth → „Allow new users to sign up” = OFF).

## Trajna bezbednosna pravila (obavezna za svaki novi kod)

Pravila 1-4 važe od kada je Faza 1 primenjena.

1. Korisnički podaci se **čitaju isključivo** preko korisničkog klijenta (`createClient` iz `lib/supabase/server.ts`, odnosno `requireUser().supabase`), nikad preko `supabaseAdmin`.
2. `supabaseAdmin` služi samo za upise. Uvek se postavlja `user_id: user.id` iz verifikovanog korisnika, nikad iz zahteva.
3. Svaka nova tabela dobija `enable row level security`, polise sa `(select auth.uid())` i eksplicitne grantove. Uloga `anon` ne dobija ništa.
4. RPC funkcije nikad ne primaju `user_id` kao parametar, već koriste `auth.uid()`. Uz to: `security invoker`, `set search_path` i `revoke execute ... from public, anon`.
5. Šema se menja **samo** kroz `supabase/migrations/<timestamp>_<ime>.sql`, a ne ručno u dashboard-u.
6. Posle svake promene baze pokrenuti RLS test (`supabase/tests/`) i Supabase Dashboard → Advisors → Security.
7. `lib/supabase.ts` (service_role) mora imati `import 'server-only';`.

---

# FAZA 1: Izolacija podataka (Supabase RLS)

## Nalazi revizije

| # | Ozbiljnost | Nalaz | Gde |
|---|---|---|---|
| F1 | **KRITIČNO (uslovno)** | `match_document_chunks` prima `filter_user_id` kao parametar. Anon ključ je javan (`NEXT_PUBLIC_…`, nalazi se u JS bundle-u). Postgres podrazumevano daje EXECUTE pravo ulozi PUBLIC. Ako funkcija nije zaključana, bilo ko može da pozove `POST /rest/v1/rpc/match_document_chunks` sa tuđim UUID-om i bilo kojim vektorom od 1024 dimenzije i dobije tuđe pasuse. | `app/api/chat/route.ts:142-149` |
| F2 | **VISOKO** | Skoro sve rute koriste `service_role` ključ, koji zaobilazi RLS. Izolacija zavisi isključivo od ručno napisanih provera `.eq('user_id')` i `chat.user_id !== user.id`. Dovoljna je jedna zaboravljena provera pa da podaci procure. To nije zero-trust. | `lib/supabase.ts:11`, `chat`, `chats/*`, `ingest` |
| F3 | **VISOKO** | Šema, RLS polise i funkcije ne postoje u repou. Ne može se dokazati klijentu (due diligence) šta štiti podatke, a ne može se ni reprodukovati za on-prem (Faza 4). | nema `supabase/` foldera |
| F4 | SREDNJE | `document_chunks` i `messages` nemaju `user_id`. Vlasništvo se izvodi samo preko roditelja u kodu, a baza ne sprečava upis pasusa u tuđi dokument. | `app/api/ingest/route.ts:110-114`, `app/api/chat/route.ts:107-109` |
| F5 | SREDNJE | `get_daily_message_count(input_user_id)` ima isti obrazac kao F1. Curi metapodatak (koliko neko koristi sistem). | `lib/check-rate-limit.ts:8` |
| F6 | NISKO | Brisanje razgovora ide u dva odvojena poziva (prvo poruke, pa razgovor), što znači da nema `ON DELETE CASCADE`. Ako drugi korak padne, ostaju siročići. | `app/api/chats/[chatId]/route.ts:40-51` |
| F7 | NISKO | Supabase podrazumevano automatski izlaže svaku novu tabelu i funkciju u `public` ulogama `anon` i `authenticated`. Nova tabela bez RLS-a odmah je javna. | podešavanje baze |

## Arhitektura zaštite (defense in depth)

1. **anon** nema nikakva prava na tabele i RPC funkcije. Direktan napad preko REST API-ja vraća `42501 permission denied`.
2. **authenticated** sme samo `SELECT` i `DELETE` sopstvenih redova (RLS sa `(select auth.uid())`). Nema `INSERT`/`UPDATE`, pa korisnik svojim tokenom ne može da podmetne lažne „assistant” poruke ni da zaobiđe MAX_CHUNKS.
3. **Upisi (service_role)** prolaze kroz kompozitni FK `(document_id, user_id) → documents(id, user_id)` i `(chat_id, user_id) → chats(id, user_id)`. Čak ni bug u serverskom kodu ne može da upiše pasus ili poruku pod tuđeg vlasnika.
4. **Vektorska pretraga** određuje korisnika iz JWT-a (`auth.uid()`), a ne iz parametra. Funkcija je `SECURITY INVOKER`, pa se na nju primenjuje RLS.
5. **Zero-trust podrazumevano:** buduće tabele i funkcije nisu automatski izložene.

## Korak 0: Backup

- Pro plan: Dashboard → Database → Backups (proveri da postoji današnji).
- Free plan: `npx supabase db dump --db-url "<connection string>" -f backup_schema.sql`, pa isto još jednom sa `--data-only -f backup_data.sql`.

## Korak 1: Dijagnostika (samo čita, ništa ne menja)

Fajl: `supabase/diagnostics/phase1_audit.sql`. Pokreće se u Supabase SQL Editoru, a ceo JSON rezultat se šalje Claude-u. Na osnovu njega se prilagođava migracija: šema pgvector-a (`public` ili `extensions`), tipovi ID kolona, nazivi postojećih FK, HNSW indeks, realtime i eventualne druge funkcije izložene ulozi anon.

```sql
-- SAMO ČITANJE. Pokreni u Supabase SQL Editoru i pošalji ceo JSON rezultat.
select jsonb_pretty(jsonb_build_object(
  'columns', (
    select jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name, 'type', udt_name,
                                        'nullable', is_nullable, 'default', column_default)
                     order by table_name, ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('documents', 'document_chunks', 'chats', 'messages')),
  'rls', (
    select jsonb_agg(jsonb_build_object('table', relname, 'enabled', relrowsecurity, 'forced', relforcerowsecurity))
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'policies', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'cmd', cmd,
                                        'roles', roles, 'using', qual, 'check', with_check))
    from pg_policies where schemaname = 'public'),
  'constraints', (
    select jsonb_agg(jsonb_build_object('table', conrelid::regclass::text, 'name', conname,
                                        'def', pg_get_constraintdef(oid)))
    from pg_constraint where connamespace = 'public'::regnamespace),
  'functions', (
    select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text,
                                        'security_definer', p.prosecdef,
                                        'config', p.proconfig,
                                        'anon_can_execute', has_function_privilege('anon', p.oid, 'execute'),
                                        'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'execute'),
                                        'definition', pg_get_functiondef(p.oid)))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')),
  'table_grants', (
    select jsonb_agg(jsonb_build_object('role', grantee, 'table', table_name, 'privilege', privilege_type))
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')),
  'indexes', (
    select jsonb_agg(jsonb_build_object('table', tablename, 'def', indexdef))
    from pg_indexes where schemaname = 'public'),
  'pgvector', (
    select jsonb_build_object('version', extversion, 'schema', extnamespace::regnamespace::text)
    from pg_extension where extname = 'vector'),
  'realtime_tables', (
    select jsonb_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'counts', jsonb_build_object(
    'documents', (select count(*) from public.documents),
    'document_chunks', (select count(*) from public.document_chunks),
    'chats', (select count(*) from public.chats),
    'messages', (select count(*) from public.messages),
    'documents_without_owner', (select count(*) from public.documents where user_id is null),
    'chats_without_owner', (select count(*) from public.chats where user_id is null),
    'documents_with_deleted_owner', (select count(*) from public.documents d
                                     where not exists (select 1 from auth.users u where u.id = d.user_id)),
    'chats_with_deleted_owner', (select count(*) from public.chats ch
                                 where not exists (select 1 from auth.users u where u.id = ch.user_id)),
    'orphan_chunks', (select count(*) from public.document_chunks c
                      where not exists (select 1 from public.documents d where d.id = c.document_id)),
    'orphan_messages', (select count(*) from public.messages m
                        where not exists (select 1 from public.chats ch where ch.id = m.chat_id)))
)) as phase1_audit;
```

## Korak 2: Migracija

Fajl: `supabase/migrations/20261027120000_phase1_data_isolation.sql`. Izvršava se kao jedna transakcija: ili prođe cela, ili se ništa ne menja. **Ovo je nacrt.** Tipovi i linije označene sa USLOVNO potvrđuju se posle dijagnostike (Korak 1).

```sql
-- FAZA 1: izolacija podataka po advokatu (RLS + kompozitni FK + zaključani RPC).
-- Sve ili ništa: ako bilo koji korak padne, baza ostaje netaknuta.
begin;

-- 1. Siročići: pasusi/poruke čiji roditelj više ne postoji (zaostali poverljivi podaci).
delete from public.document_chunks c
where not exists (select 1 from public.documents d where d.id = c.document_id);

delete from public.messages m
where not exists (select 1 from public.chats ch where ch.id = m.chat_id);

-- 2. Vlasnik je obavezan. Ako postoji red bez vlasnika, migracija namerno puca.
alter table public.documents alter column user_id set not null;
alter table public.chats     alter column user_id set not null;

-- Brisanje naloga advokata NE briše njegove spise (RESTRICT): to mora biti svesna odluka.
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
--    Stari jednostruki FK (bez obzira na ime) zamenjujemo novim, sa kaskadnim brisanjem.
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
create index if not exists documents_user_id_created_at_idx on public.documents (user_id, created_at desc);
create index if not exists chats_user_id_created_at_idx     on public.chats (user_id, created_at desc);
create index if not exists document_chunks_owner_idx        on public.document_chunks (document_id, user_id);
create index if not exists document_chunks_user_id_idx      on public.document_chunks (user_id);
create index if not exists messages_owner_created_at_idx    on public.messages (chat_id, user_id, created_at);
create index if not exists messages_user_id_created_at_idx  on public.messages (user_id, created_at);

-- 7. RLS uključen; brišemo SVE stare polise da ne ostane neka "permissive" rupa.
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
revoke all on public.documents, public.document_chunks, public.chats, public.messages
  from public, anon, authenticated;
grant select, delete on public.documents, public.chats to authenticated;
grant select on public.document_chunks, public.messages to authenticated;

-- 10. Vektorska pretraga: korisnik se određuje iz JWT-a, NE iz parametra.
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
-- USLOVNO (ako je pgvector >= 0.8 i postoji HNSW indeks): set hnsw.iterative_scan = 'strict_order'
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

revoke execute on function public.match_document_chunks(vector, integer) from public, anon;
grant execute on function public.match_document_chunks(vector, integer) to authenticated;

-- 11. Brojač poruka za rate limit: dozvoljen samo serveru (service_role).
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname = 'get_daily_message_count' and pronamespace = 'public'::regnamespace
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- 12. Zero-trust podrazumevano: nove tabele/funkcije u public NISU automatski izložene API-ju.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

-- USLOVNO (ako dijagnostika pokaže da su u realtime publikaciji):
-- alter publication supabase_realtime drop table public.documents, public.document_chunks, public.chats, public.messages;

commit;
```

## Korak 3: Izmene koda (hibrid)

- **`lib/supabase.ts`:** dodati `import 'server-only';` na vrh. Next 16 to podržava bez instalacije paketa (`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`). Build pada ako `service_role` ikada završi u klijentskom kodu.
- **`lib/require-user.ts`:** pored `user` vraća i `supabase` (korisnički klijent iz `lib/supabase/server.ts`), da bi ga rute koristile za RLS čitanja.
- **`app/api/chat/route.ts`:**
  - Provera vlasništva razgovora (65-73) ide preko `supabaseServer`: `.select('id').eq('id', activeChatId).maybeSingle()`. Ako nema reda, vraća se 404 „Razgovor nije pronađen.” Tuđi razgovor tako izgleda isto kao nepostojeći.
  - Istorija poruka (90-95) se čita preko `supabaseServer`.
  - Upisi poruka (107-109, 197-199) ostaju na `supabaseAdmin`, ali se dodaje `user_id: user.id`.
  - RPC (142-149) ide preko `supabaseServer.rpc('match_document_chunks', { query_embedding, match_count: 8 })`, bez `filter_user_id`.
- **`app/api/ingest/route.ts`:** u `insertData` (110-114) dodati `user_id: user.id`. Rollback (135) dobija `.eq('user_id', user.id)`.
- **`app/api/chats/route.ts`:** čitanje ide preko `supabase` iz `requireUser()`. `.eq('user_id')` ostaje kao drugi pojas zaštite.
- **`app/api/chats/[chatId]/route.ts`:** sve se zamenjuje jednim pozivom `supabase.from('chats').delete().eq('id', chatId).select('id')`. Prazan rezultat vraća 404, a poruke briše `ON DELETE CASCADE`. `supabaseAdmin` se uklanja.
- **`app/api/chats/[chatId]/messages/route.ts`:** oba upita idu preko korisničkog klijenta. `supabaseAdmin` se uklanja.
- **Bez izmena:** `app/actions/documents.ts` (već koristi RLS klijent) i `lib/check-rate-limit.ts` (ostaje na service_role, prepravlja se u Fazi 2).

## Korak 4: Puštanje u rad (redosled je bitan)

Stari kod šalje `filter_user_id` i ne upisuje `user_id`, pa između migracije i deploy-a chat ne radi oko 1-2 minuta. Redosled:
1. Kod pripremiti na grani i proveriti da build prolazi.
2. U mirnom periodu pokrenuti migraciju.
3. Odmah deploy-ovati kod.
4. Pokrenuti testove (ispod).

Podešavanje Auth-a (dashboard, bez koda): isključiti javnu registraciju (Authentication → Sign In / Providers → „Allow new users to sign up” = OFF).

## Verifikacija Faze 1

1. **SQL test izolacije** (`supabase/tests/phase1_rls_test.sql`, sve se poništava sa `rollback`). Test sam pravi dva privremena korisnika (A i B) sa dokumentima, pasusima, razgovorima i porukama unutar transakcije, pa ne zavisi od stvarnih naloga (u bazi je trenutno 0 dokumenata, pa "dva stvarna korisnika" ne bi imala šta da testiraju). Test se predstavlja kao A (`set local role authenticated` + `request.jwt.claims`) i proverava:
   - broj vidljivih redova u sve 4 tabele jednak je broju A-ovih redova (nema curenja, a RLS nije ni prestrog);
   - `match_document_chunks(array_fill(0.01::real, array[1024])::vector, 20)` vraća samo A-ove naslove;
   - `insert into public.messages (content) …` pada sa `insufficient_privilege`;
   - `get_daily_message_count` pada za `authenticated`;
   - kao `anon`: `select` iz `documents` i poziv `match_document_chunks` padaju sa `insufficient_privilege`.

   Na kraju se ispisuje „FAZA 1: svi RLS testovi prošli”. Ako bilo šta procuri, skripta puca sa `CURENJE: …`.
2. **Napad spolja (curl sa anon ključem):**
   - `GET /rest/v1/documents?select=*` → očekuje se `42501 permission denied`;
   - `POST /rest/v1/rpc/match_document_chunks` sa starim `filter_user_id` → očekuje se `PGRST202`/`42501`.
3. **Supabase Dashboard → Advisors → Security:** nema upozorenja „RLS disabled”, „function search_path mutable” ni „security definer” za ove objekte.
4. **`npm run lint` i `npm run build`** prolaze.
5. **E2E sa dva naloga** (običan i incognito prozor):
   - A otpremi PDF i pita nešto;
   - B postavi pitanje o sadržaju A-ovog dokumenta → bez izvora;
   - B pozove `GET /api/chats/<A chatId>/messages` i `DELETE /api/chats/<A chatId>` → oba vraćaju 404;
   - A obriše dokument → SQL pokazuje 0 njegovih pasusa;
   - dnevni limit od 40 poruka i dalje radi.
6. **Commit** svih SQL fajlova u `supabase/`, da šema i polise budu verzionisani.

## Fajlovi Faze 1

- Novi: `supabase/diagnostics/phase1_audit.sql`, `supabase/migrations/20261027120000_phase1_data_isolation.sql`, `supabase/tests/phase1_rls_test.sql`.
- Menjaju se: `lib/supabase.ts`, `lib/require-user.ts`, `app/api/chat/route.ts`, `app/api/ingest/route.ts`, `app/api/chats/route.ts`, `app/api/chats/[chatId]/route.ts`, `app/api/chats/[chatId]/messages/route.ts`.

---

# FAZA 2: Zaštita Next.js API ruta (sledeća)

Opseg: rate limiting, zaštita od prompt injection napada, validacija ulaza (zod), audit log.

Nalazi preneti iz revizije Faze 1:
- **Rate limit se može zaobići.** `get_daily_message_count` broji redove iz `messages`, pa korisnik koji obriše razgovor resetuje svoj brojač. Treba posebna tabela potrošnje (usage ledger) u koju korisnik ne može da piše niti iz nje da briše (`lib/check-rate-limit.ts`).
- **`/api/ingest` nema rate limit.** Neograničeni pozivi Voyage API-ja troše kredite (`app/api/ingest/route.ts`).
- **Nema zod validacije.** `chatId` i telo zahteva se ne validiraju (`app/api/chat/route.ts:48`).
- **Prompt injection.** RAG kontekst iz dokumenata se ubacuje direktno u system prompt (`app/api/chat/route.ts:13-32`), a `document_title` (ime fajla koje bira korisnik) ide u kontekst bez ikakve obrade.
- **Nema audit loga** (ko je kada otpremio, pročitao ili obrisao dokument). Advokatske kancelarije to traže zbog NDA.

# FAZA 3: Bezbednost PDF/Word fajlova

Opseg: sprečavanje malicioznih fajlova (malware, makro virusi) pre parsiranja.

Nalazi preneti iz revizije Faze 1:
- **PDF se prepoznaje samo po MIME tipu ili ekstenziji.** Nema provere magičnih bajtova (`%PDF-`) (`app/api/ingest/route.ts:33`).
- **Word se parsira u browseru** preko mammoth.js (`app/chat/page.tsx:123`). Server nikad ne vidi originalni fajl.
- **Limit veličine se ne slaže sa porukom.** `MAX_FILE_SIZE` je 4MB, a poruka i komentar kažu 10MB (`app/api/ingest/route.ts:8,30`).
- **Parsiranje (unpdf) nema timeout ni izolaciju.** Pokreće se direktno u API ruti.

# FAZA 4: Enterprise arhitektura (on-prem / Docker)

Opseg: instalacija kod klijenta preko Docker-a, za slučaj da kancelarija odbije Cloud (Vercel) zbog internih firewall pravila.

Preduslovi i napomene:
- **Bazna šema u repou.** Treba je napraviti preko `supabase db dump --schema-only`. Faza 1 dodaje samo migraciju preko postojeće šeme.
- **Next.js build za on-prem.** `output: 'standalone'` + Dockerfile, a self-hosted Supabase preko docker compose.
- **Spoljni AI servisi.** Voyage AI i Claude su cloud API-ji. On-prem instalacija traži dozvoljen izlazni saobraćaj (egress allowlist) ka tim servisima ili alternativu (npr. Claude preko cloud provajdera u EU regionu, lokalni embedding model).
