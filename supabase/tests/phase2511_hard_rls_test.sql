-- FAZA 2.5.11: tvrdi RLS u bazi (aal2 za naloge sa MFA, blokiran nalog) i audit uklanjanja MFA faktora.
--
-- Pokreće se u Supabase SQL Editoru POSLE primene migracije 20261029110000_phase2511_hard_rls.sql
-- i posle SVAKE kasnije promene baze (trajno pravilo 6 iz CLAUDE.md), zajedno sa phase1, phase2, phase25 i phase256 testom.
--
-- Test sam pravi privremene korisnike, pa na kraju SVE poništava (rollback): u bazi ne ostaje ništa.
--   A  advokat sa POTVRĐENIM faktorom       E  admin sa potvrđenim faktorom (vidi sve zapise audit loga samo sa aal2)
--   B  advokat bez faktora                  F  advokat sa isteklom blokadom u Auth-u (banned_until u prošlosti)
--   C  advokat blokiran u profilu           G  advokat samo sa NEPOTVRĐENIM faktorom (uključivanje u toku)
--   D  advokat blokiran u Auth-u            H  advokat sa potvrđenim faktorom, bez podataka (brisanje naloga)
-- Predstavlja se kao svaki od njih, anon i service_role (set local role + request.jwt.claims, uključujući `aal`).
--
-- Šta se dokazuje: nalog sa potvrđenim faktorom vidi podatke samo sa aal2; blokiran nalog (disabled_at ili banned_until)
-- ne vidi ništa ni sa važećim aal2 tokenom; nalog bez faktora radi kao pre; profiles ostaje čitljiv (aplikacija
-- po njemu otkriva blokadu); brisanje faktora ostavlja zapis mfa_removed, a brisanje naloga sa faktorom ne puca.
--
-- Uspeh: nema greške i ispisuje se "FAZA 2.5.11: svi testovi tvrdog RLS-a prošli".
-- Curenje: skripta puca sa "CURENJE: ...", a "PRESTROGO: ..." znači da nalog gubi pristup onome što treba da vidi.
-- Ako puca sa "TEST: ...", problem je u samom testu ili migracija nije primenjena.
begin;

-- 0. Podaci. A, B, C, D, F i G imaju po 1 dokument, 2 pasusa, 1 razgovor, 2 poruke, 1 red potrošnje i 1 audit zapis.
--    E ima samo audit zapis. H nema podataka (da brisanje naloga ne zaustavi RESTRICT iz Faze 1).
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  f uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  h uuid := gen_random_uuid();
  u uuid;
  doc uuid;
  chat uuid;
  tag text;
  v public.vector := array_fill(0.01::real, array[1024])::public.vector;
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'p2511-test-a-' || a || '@example.invalid', '{}', '{"full_name":"P2511 A"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'p2511-test-b-' || b || '@example.invalid', '{}', '{"full_name":"P2511 B"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'p2511-test-c-' || c || '@example.invalid', '{}', '{"full_name":"P2511 C"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', d, 'authenticated', 'authenticated', 'p2511-test-d-' || d || '@example.invalid', '{}', '{"full_name":"P2511 D"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', e, 'authenticated', 'authenticated', 'p2511-test-e-' || e || '@example.invalid', '{}', '{"full_name":"P2511 E"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', f, 'authenticated', 'authenticated', 'p2511-test-f-' || f || '@example.invalid', '{}', '{"full_name":"P2511 F"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', g, 'authenticated', 'authenticated', 'p2511-test-g-' || g || '@example.invalid', '{}', '{"full_name":"P2511 G"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', h, 'authenticated', 'authenticated', 'p2511-test-h-' || h || '@example.invalid', '{}', '{"full_name":"P2511 H"}', now(), now());

  -- okidač on_auth_user_created pravi profile (podrazumevana uloga lawyer)
  update public.profiles set role = 'admin' where id = e;
  update public.profiles set disabled_at = now() where id = c;
  update auth.users set banned_until = now() + interval '1 day'  where id = d;
  update auth.users set banned_until = now() - interval '1 day'  where id = f;

  -- MFA: A, E i H imaju potvrđen faktor, G samo nepotvrđen (uključivanje u toku).
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values
    (gen_random_uuid(), a, 'totp', 'verified',   now(), now()),
    (gen_random_uuid(), e, 'totp', 'verified',   now(), now()),
    (gen_random_uuid(), h, 'totp', 'verified',   now(), now()),
    (gen_random_uuid(), g, 'totp', 'unverified', now(), now());

  foreach u in array array[a, b, c, d, f, g] loop
    doc := gen_random_uuid();
    chat := gen_random_uuid();
    tag := case u when a then 'A' when b then 'B' when c then 'C' when d then 'D' when f then 'F' else 'G' end;

    insert into public.documents (id, title, user_id) values (doc, 'P2511-TEST ' || tag || ' dokument', u);
    insert into public.document_chunks (document_id, user_id, content, embedding) values
      (doc, u, 'P2511 ' || tag || ' pasus 1', v),
      (doc, u, 'P2511 ' || tag || ' pasus 2', v);
    insert into public.chats (id, title, user_id) values (chat, 'P2511-TEST ' || tag || ' razgovor', u);
    insert into public.messages (chat_id, user_id, role, content) values
      (chat, u, 'user', 'P2511 ' || tag || ' pitanje'),
      (chat, u, 'assistant', 'P2511 ' || tag || ' odgovor');
    insert into public.usage_ledger (user_id, kind, status, input_tokens, output_tokens, embed_tokens)
      values (u, 'chat', 'settled', 10, 5, 0);
    insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id)
      values (u, (select x.email::text from auth.users x where x.id = u), 'chat_created', 'chat', chat);

    perform set_config('test.' || lower(tag) || '_doc', doc::text, true);
    perform set_config('test.' || lower(tag) || '_chat', chat::text, true);
  end loop;

  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id)
    values (e, (select x.email::text from auth.users x where x.id = e), 'mfa_enrolled', 'user', e);

  perform set_config('test.a', a::text, true);
  perform set_config('test.b', b::text, true);
  perform set_config('test.c', c::text, true);
  perform set_config('test.d', d::text, true);
  perform set_config('test.e', e::text, true);
  perform set_config('test.f', f::text, true);
  perform set_config('test.g', g::text, true);
  perform set_config('test.h', h::text, true);
  perform set_config('test.a_email', (select x.email::text from auth.users x where x.id = a), true);
  perform set_config('test.a_audit', (select al.id::text from public.audit_log al where al.user_id = a and al.action = 'chat_created'), true);
end $$;

-- Pomoćne funkcije (nestaju sa rollback-om). Rade kao pozivalac (security invoker), pa važi RLS uloge koja ih zove.
-- Redosled brojeva: documents, document_chunks, chats, messages, usage_ledger, audit_log.
create function public.p2511_counts() returns int[]
language plpgsql security invoker as $$
declare
  t   text;
  n   int;
  res int[] := '{}';
begin
  foreach t in array array['documents', 'document_chunks', 'chats', 'messages', 'usage_ledger', 'audit_log'] loop
    execute format('select count(*) from public.%I', t) into n;
    res := res || n;
  end loop;
  return res;
end $$;

create function public.p2511_expect(label text, expected int[]) returns void
language plpgsql security invoker as $$
declare
  got int[] := public.p2511_counts();
  i   int;
begin
  if got is not distinct from expected then
    return;
  end if;
  for i in 1 .. array_length(expected, 1) loop
    if got[i] > expected[i] then
      raise exception 'CURENJE: % vidi % (documents, document_chunks, chats, messages, usage_ledger, audit_log), očekivano %', label, got, expected;
    end if;
  end loop;
  raise exception 'PRESTROGO: % vidi % (documents, document_chunks, chats, messages, usage_ledger, audit_log), očekivano %', label, got, expected;
end $$;

grant execute on function public.p2511_counts()               to authenticated;
grant execute on function public.p2511_expect(text, int[])    to authenticated;

-- 1. Statička provera konfiguracije (kao vlasnik baze).
do $$
declare
  n   int;
  s   text;
  r   record;
  t   text;
begin
  foreach s in array array['private.mfa_satisfied()', 'private.account_active()', 'private.audit_mfa_removed()'] loop
    if to_regprocedure(s) is null then
      raise exception 'TEST: ne postoji % (migracija 2.5.11 nije primenjena?)', s;
    end if;
    if not (select prosecdef from pg_proc where oid = s::regprocedure) then
      raise exception 'TEST: % nije security definer (mora: authenticated ne sme da čita auth.mfa_factors ni auth.users)', s;
    end if;
    if not coalesce((select 'search_path=""' = any(proconfig) from pg_proc where oid = s::regprocedure), false) then
      raise exception 'CURENJE: % nema set search_path = ''''', s;
    end if;
    if has_function_privilege('anon', s, 'execute') then
      raise exception 'CURENJE: anon sme da izvrši %', s;
    end if;
  end loop;

  foreach s in array array['private.mfa_satisfied()', 'private.account_active()'] loop
    if not has_function_privilege('authenticated', s, 'execute') then
      raise exception 'TEST: authenticated ne sme da izvrši % (polisa se izvršava kao pozivalac)', s;
    end if;
    if not (select provolatile = 's' from pg_proc where oid = s::regprocedure) then
      raise exception 'TEST: % nije stable (polisa bi se računala po redu, ne jednom po upitu)', s;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.audit_mfa_removed()', 'execute') then
    raise exception 'CURENJE: authenticated sme da izvrši okidačku funkciju private.audit_mfa_removed()';
  end if;

  -- tačno 6 restriktivnih polisa u public, po jedna na tabelu, za sve komande, samo za authenticated
  select count(*) into n from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE';
  if n <> 6 then raise exception 'TEST: očekivano 6 restriktivnih polisa u public, nađeno %', n; end if;

  foreach t in array array['documents', 'document_chunks', 'chats', 'messages', 'usage_ledger', 'audit_log'] loop
    select count(*) into n from pg_policies
    where schemaname = 'public' and tablename = t and permissive = 'RESTRICTIVE'
      and cmd = 'ALL' and roles = '{authenticated}'
      and qual ~ 'mfa_satisfied' and qual ~ 'account_active' and qual ~* 'select';
    if n <> 1 then
      raise exception 'TEST: na public.% nema tačno jedne restriktivne polise (ALL, authenticated, mfa_satisfied + account_active u (select ...) obliku): %', t, n;
    end if;
  end loop;

  -- postojeće (permissive) polise nisu dirane
  for r in
    select * from (values ('documents', 2), ('document_chunks', 1), ('chats', 2), ('messages', 1),
                          ('usage_ledger', 1), ('audit_log', 1), ('profiles', 1), ('office_settings', 1)) as x(tbl, expected)
  loop
    select count(*) into n from pg_policies
    where schemaname = 'public' and tablename = r.tbl and permissive = 'PERMISSIVE';
    if n <> r.expected then
      raise exception 'TEST: public.% ima % permissive polisa, očekivano % (migracija ne sme da menja postojeće)', r.tbl, n, r.expected;
    end if;
  end loop;

  -- NIKAKVA restriktivna polisa na profiles (aplikacija po profilu otkriva blokadu) ni na office_settings
  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename in ('profiles', 'office_settings') and permissive = 'RESTRICTIVE';
  if n <> 0 then raise exception 'TEST: restriktivna polisa na profiles/office_settings (blokirana korisnika bi sakrila disabled_at od requireUser)'; end if;

  -- okidač: AFTER DELETE, po redu, na auth.mfa_factors
  select pg_get_triggerdef(t.oid) into s from pg_trigger t
  where t.tgrelid = 'auth.mfa_factors'::regclass and not t.tgisinternal and t.tgfoid = 'private.audit_mfa_removed()'::regprocedure;
  if s is null then raise exception 'TEST: nema okidača na auth.mfa_factors koji zove private.audit_mfa_removed()'; end if;
  if s !~ 'AFTER DELETE ON auth.mfa_factors FOR EACH ROW' then
    raise exception 'TEST: okidač nije "AFTER DELETE ... FOR EACH ROW": %', s;
  end if;

  -- audit_log prihvata mfa_removed, a ne prihvata proizvoljnu akciju; sve ranije akcije i dalje prolaze
  foreach s in array array['document_uploaded', 'document_upload_blocked', 'document_deleted', 'chat_created', 'chat_deleted',
                           'question_asked', 'limit_reached', 'suspicious_content_flagged', 'user_invited', 'user_disabled',
                           'user_enabled', 'role_changed', 'settings_changed', 'admin_viewed_user', 'audit_exported',
                           'mfa_enrolled', 'mfa_removed'] loop
    insert into public.audit_log (user_id, action, resource_type) values (current_setting('test.b')::uuid, s, 'user');
  end loop;
  begin
    insert into public.audit_log (user_id, action) values (current_setting('test.b')::uuid, 'nepoznata_akcija');
    raise exception 'CURENJE: audit_log prihvata nepoznatu akciju';
  exception when check_violation then null;
  end;
  delete from public.audit_log where user_id = current_setting('test.b')::uuid and resource_id is null;

  -- okidač NE sme da ostavi zapise za početne faktore (umetanje nije uklanjanje)
  if exists (select 1 from public.audit_log where action = 'mfa_removed' and user_id = any(
       array[current_setting('test.a')::uuid, current_setting('test.e')::uuid, current_setting('test.g')::uuid, current_setting('test.h')::uuid])) then
    raise exception 'CURENJE: mfa_removed postoji pre ikakvog brisanja faktora (okidač se pali i na umetanje/izmenu)';
  end if;
end $$;

-- 2. A (potvrđen faktor), token BEZ koda (aal1): ništa ne vidi, ništa ne briše; profil i podešavanja ostaju čitljivi.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
  n int;
  v public.vector := array_fill(0.01::real, array[1024])::public.vector;
begin
  perform public.p2511_expect('A sa aal1', array[0, 0, 0, 0, 0, 0]);

  if exists (select 1 from public.match_document_chunks(v, 20)) then
    raise exception 'CURENJE: A sa aal1 dobija pasuse preko match_document_chunks';
  end if;
  select coalesce(sum(daily_messages), 0) into n from public.get_usage_summary();
  if n <> 0 then raise exception 'CURENJE: A sa aal1 vidi potrošnju preko get_usage_summary: %', n; end if;

  delete from public.documents where id = current_setting('test.a_doc')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: A sa aal1 je obrisao dokument'; end if;
  delete from public.chats where id = current_setting('test.a_chat')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: A sa aal1 je obrisao razgovor'; end if;

  -- izuzetak: profil se i dalje vidi (requireUser po njemu otkriva blokadu i ulogu), kao i podešavanja kancelarije
  if (select count(*) from public.profiles where id = a) <> 1 then
    raise exception 'PRESTROGO: A sa aal1 ne vidi svoj profil';
  end if;
  if (select count(*) from public.office_settings) <> 1 then
    raise exception 'PRESTROGO: A sa aal1 ne vidi podešavanja kancelarije';
  end if;
end $$;

-- isto kad u tokenu uopšte nema `aal` (stariji token): nije aal2
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
do $$ begin perform public.p2511_expect('A bez aal u tokenu', array[0, 0, 0, 0, 0, 0]); end $$;
reset role;

-- A je ipak vlasnik: dokument i razgovor postoje (brisanje nije prošlo)
do $$
begin
  if not exists (select 1 from public.documents where id = current_setting('test.a_doc')::uuid)
     or not exists (select 1 from public.chats where id = current_setting('test.a_chat')::uuid) then
    raise exception 'CURENJE: dokument ili razgovor naloga A su obrisani sa aal1';
  end if;
end $$;

-- 2b. Token bez `sub` (uloga authenticated, a korisnika nema): obe pomoćne funkcije su netačne (pravilo je zatvoreno).
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
do $$
begin
  if private.mfa_satisfied() then raise exception 'CURENJE: private.mfa_satisfied() je tačno bez prijavljenog korisnika'; end if;
  if private.account_active() then raise exception 'CURENJE: private.account_active() je tačno bez prijavljenog korisnika'; end if;
  perform public.p2511_expect('token bez sub', array[0, 0, 0, 0, 0, 0]);
end $$;
reset role;

-- 3. A sa kodom (aal2): vidi SVOJE redove, i samo njih.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  v public.vector := array_fill(0.01::real, array[1024])::public.vector;
  n int;
begin
  perform public.p2511_expect('A sa aal2', array[1, 2, 1, 2, 1, 1]);
  select count(*) into n from public.match_document_chunks(v, 20);
  if n <> 2 then raise exception 'PRESTROGO: A sa aal2 dobija % pasusa preko match_document_chunks, očekivano 2', n; end if;
  if exists (select 1 from public.match_document_chunks(v, 20) where document_title not like 'P2511-TEST A %') then
    raise exception 'CURENJE: A sa aal2 dobija tuđ pasus preko match_document_chunks';
  end if;
  select sum(daily_messages) into n from public.get_usage_summary();
  if n <> 1 then raise exception 'PRESTROGO: A sa aal2 vidi % poruka u get_usage_summary, očekivano 1', n; end if;
end $$;
reset role;

-- 4. B (bez faktora): radi kao pre, i sa aal1 i bez `aal` u tokenu (kao u phase1 testu).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
set local role authenticated;
do $$ begin perform public.p2511_expect('B sa aal1', array[1, 2, 1, 2, 1, 1]); end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated')::text, true);
do $$ begin perform public.p2511_expect('B bez aal u tokenu', array[1, 2, 1, 2, 1, 1]); end $$;
reset role;

-- 5. G (samo nepotvrđen faktor, uključivanje u toku): nije "nalog sa MFA", pa ne gubi pristup.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.g'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.g'), true);
set local role authenticated;
do $$ begin perform public.p2511_expect('G (nepotvrđen faktor) sa aal1', array[1, 2, 1, 2, 1, 1]); end $$;
reset role;

-- 6. C (blokiran u profilu): ne vidi ništa ni sa važećim aal2; profil ostaje čitljiv i pokazuje blokadu.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.c'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
set local role authenticated;

do $$
declare
  c uuid := current_setting('test.c')::uuid;
  v public.vector := array_fill(0.01::real, array[1024])::public.vector;
  n int;
begin
  perform public.p2511_expect('C (disabled_at) sa aal2', array[0, 0, 0, 0, 0, 0]);
  if exists (select 1 from public.match_document_chunks(v, 20)) then
    raise exception 'CURENJE: blokiran C dobija pasuse preko match_document_chunks';
  end if;
  delete from public.documents where id = current_setting('test.c_doc')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: blokiran C je obrisao dokument'; end if;

  -- OVO JE IZUZETAK KOJI DRŽI BLOKADU U APLIKACIJI: da se profil sakrije, requireUser bi "nema profila" protumačio kao "nije blokiran"
  if (select disabled_at from public.profiles where id = c) is null then
    raise exception 'TEST: blokiran C ne vidi svoj disabled_at u profilu (requireUser bi propustio blokadu)';
  end if;
end $$;
reset role;

-- 7. D (blokiran u Auth-u, banned_until u budućnosti): isto. F (blokada istekla): radi.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.d'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
set local role authenticated;
do $$ begin perform public.p2511_expect('D (banned_until u budućnosti) sa aal2', array[0, 0, 0, 0, 0, 0]); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.f'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.f'), true);
do $$ begin perform public.p2511_expect('F (banned_until u prošlosti)', array[1, 2, 1, 2, 1, 1]); end $$;
reset role;

-- 8. E (admin sa faktorom): audit_log vidi tuđe zapise samo sa aal2; sve ostalo samo svoje (kao pre).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.e'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.e'), true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.audit_log) then
    raise exception 'CURENJE: admin sa aal1 vidi audit zapise (čak i sopstvene)';
  end if;
  begin
    perform count(*) from public.admin_list_users();
    raise exception 'CURENJE: admin sa aal1 čita admin_list_users';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.e'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
do $$
declare
  n int;
begin
  if not exists (select 1 from public.audit_log where id = current_setting('test.a_audit')::uuid) then
    raise exception 'PRESTROGO: admin sa aal2 ne vidi audit zapis advokata A';
  end if;
  select count(*) into n from public.documents;
  if n <> 0 then raise exception 'CURENJE: admin vidi % dokumenata (nema svojih, admin nije superkorisnik nad podacima)', n; end if;
  select count(*) into n from public.admin_list_users();
  if n < 8 then raise exception 'PRESTROGO: admin sa aal2 ne vidi naloge preko admin_list_users (%)', n; end if;
end $$;
reset role;

-- 9. Kraj-do-kraja blokada: admin (aal2) blokira B preko admin_set_disabled, B odmah gubi pristup, pa ga vraća odblokada.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.e'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.e'), true);
set local role authenticated;
do $$ begin perform public.admin_set_disabled(current_setting('test.b')::uuid, true); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
do $$ begin perform public.p2511_expect('B posle admin_set_disabled', array[0, 0, 0, 0, 0, 0]); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.e'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.e'), true);
do $$ begin perform public.admin_set_disabled(current_setting('test.b')::uuid, false); end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
do $$ begin perform public.p2511_expect('B posle odblokade', array[1, 2, 1, 2, 1, 1]); end $$;
reset role;

-- 10. anon (javni ključ): i dalje ništa; pomoćne funkcije iz private mu nisu dostupne.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  t text;
begin
  foreach t in array array['documents', 'document_chunks', 'chats', 'messages', 'usage_ledger', 'audit_log', 'profiles'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'CURENJE: anon čita public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform private.mfa_satisfied();
    raise exception 'CURENJE: anon izvršava private.mfa_satisfied()';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.account_active();
    raise exception 'CURENJE: anon izvršava private.account_active()';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 11. service_role (server): zaobilazi RLS kao pre, upisi servera ne zavise od aal2 ni od blokade.
set local role service_role;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
  c uuid := current_setting('test.c')::uuid;
  n int;
begin
  select count(*) into n from public.documents where user_id in (a, c);
  if n <> 2 then raise exception 'TEST: service_role ne vidi dokumente naloga A i C (%), RLS ga ne sme ograničavati', n; end if;
  -- server upisuje poruku i audit za nalog sa faktorom i za blokiran nalog
  insert into public.messages (chat_id, user_id, role, content)
    values (current_setting('test.a_chat')::uuid, a, 'user', 'P2511 A server upis');
  insert into public.audit_log (user_id, action, resource_type) values (c, 'limit_reached', 'user');
  -- (audit_log je append-only i za server; sve se poništava rollback-om na kraju)
  delete from public.messages where content = 'P2511 A server upis';
end $$;
reset role;

-- 12. Okidač: brisanje POTVRĐENOG faktora ostavlja mfa_removed, ostalo ne (kao vlasnik baze, kao Auth server).
do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  g  uuid := current_setting('test.g')::uuid;
  h  uuid := current_setting('test.h')::uuid;
  n  int;
  r  record;
begin
  -- nepotvrđen faktor (napuštena prijava): bez zapisa
  delete from auth.mfa_factors where user_id = g;
  if exists (select 1 from public.audit_log where action = 'mfa_removed' and resource_id = g) then
    raise exception 'TEST: brisanje nepotvrđenog faktora je napravilo mfa_removed (šum: napuštene prijave nisu gašenje MFA)';
  end if;

  -- potvrđen faktor: tačno jedan zapis sa vlasnikom, e-mailom i vrstom faktora
  delete from auth.mfa_factors where user_id = a;
  select count(*) into n from public.audit_log where action = 'mfa_removed' and resource_id = a;
  if n <> 1 then raise exception 'TEST: brisanje potvrđenog faktora nije ostavilo tačno jedan mfa_removed (%)', n; end if;
  select * into r from public.audit_log where action = 'mfa_removed' and resource_id = a;
  if r.user_id is distinct from a or r.resource_type is distinct from 'user'
     or r.actor_email is distinct from current_setting('test.a_email') then
    raise exception 'TEST: mfa_removed ima pogrešnog vlasnika/tip resursa/e-mail: %', to_jsonb(r);
  end if;
  if r.metadata is distinct from jsonb_build_object('factor_type', 'totp', 'status', 'verified') then
    raise exception 'CURENJE: mfa_removed nosi neočekivan metadata (samo factor_type i status): %', r.metadata;
  end if;
  if r.ip is not null then raise exception 'TEST: mfa_removed ima ip (okidač ne zna IP adresu)'; end if;

  -- brisanje NALOGA sa potvrđenim faktorom: kaskada briše faktor, nalog više ne postoji, zapis se ne pravi, brisanje ne puca
  delete from auth.users where id = h;
  if exists (select 1 from auth.users where id = h) then raise exception 'TEST: nalog H nije obrisan'; end if;
  if exists (select 1 from public.audit_log where action = 'mfa_removed' and (resource_id = h or user_id = h)) then
    raise exception 'TEST: brisanje naloga je ostavilo mfa_removed (FK audit_log.user_id bi trebalo da obori ili da se zapis preskoči)';
  end if;
end $$;

-- 13. Posle uklanjanja faktora A nije više "nalog sa MFA": vidi svoje i bez koda (izgubljen telefon = vlasnik uklanja faktor);
--     zapis o uklanjanju vidi i sam A (sa aal1, jer faktora više nema) i admin (sa aal2).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;
do $$
begin
  perform public.p2511_expect('A posle uklanjanja faktora', array[1, 2, 1, 2, 1, 2]);
  if not exists (select 1 from public.audit_log where action = 'mfa_removed') then
    raise exception 'PRESTROGO: A ne vidi sopstveni zapis mfa_removed';
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.e'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.e'), true);
do $$
begin
  if not exists (select 1 from public.audit_log where action = 'mfa_removed' and resource_id = current_setting('test.a')::uuid) then
    raise exception 'PRESTROGO: admin sa aal2 ne vidi mfa_removed naloga A';
  end if;
end $$;
reset role;

-- 14. Greška pri upisu audita NE sme da zaustavi uklanjanje faktora (izgubljen telefon, brisanje naloga i promena šeme
--     Auth servisa ne smeju da zavise od audita). Upis se ovde namerno obara: nova provera (not valid, da stari zapisi
--     ne smetaju) zabranjuje mfa_removed. Sve se poništava rollback-om.
do $$
declare
  b uuid := current_setting('test.b')::uuid;
begin
  alter table public.audit_log drop constraint audit_log_action_check;
  alter table public.audit_log add constraint audit_log_action_check check (action <> 'mfa_removed') not valid;

  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
    values (gen_random_uuid(), b, 'totp', 'verified', now(), now());
  delete from auth.mfa_factors where user_id = b;   -- ne sme da pukne

  if exists (select 1 from auth.mfa_factors where user_id = b) then
    raise exception 'TEST: faktor naloga B nije obrisan';
  end if;
  if exists (select 1 from public.audit_log where action = 'mfa_removed' and resource_id = b) then
    raise exception 'TEST: zapis mfa_removed postoji iako je upis morao da padne';
  end if;
end $$;

do $$ begin raise notice 'FAZA 2.5.11: svi testovi tvrdog RLS-a prošli'; end $$;
select 'FAZA 2.5.11: svi testovi tvrdog RLS-a prošli' as rezultat;

rollback;
