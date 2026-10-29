-- FAZA 2.5: test admin panela (uloga + MFA, uske RPC funkcije, audit, poslednji admin, podešavanja).
--
-- Pokreće se u Supabase SQL Editoru POSLE primene migracije 20261028150000_phase25_admin.sql
-- i posle SVAKE kasnije promene baze (trajno pravilo 6 iz CLAUDE.md), zajedno sa phase1 i phase2 testom.
--
-- Test sam pravi četiri privremena korisnika (A i A2 admini, B i C advokati) sa dokumentima, pasusima,
-- razgovorima, porukama i potrošnjom, pa na kraju SVE poništava (rollback): u bazi ne ostaje ništa.
-- Predstavlja se kao A, B, anon i service_role (set local role + request.jwt.claims, uključujući `aal`).
-- Pravi admini u bazi ne smetaju: test ih unutar svoje transakcije privremeno svede na A i A2.
--
-- Uspeh: nema greške i ispisuje se "FAZA 2.5: svi admin testovi prošli".
-- Curenje: skripta puca sa "CURENJE: ...". Ako puca sa "TEST: ...", problem je u samom testu
-- ili migracija nije primenjena.
begin;

-- 0. Podaci. A i A2 su admini, B i C advokati.
--    A: 1 dokument/1 pasus/1 razgovor/1 poruka.  B: 1 dokument/2 pasusa/1 razgovor/2 poruke + potrošnja.
--    C: 1 dokument/1 pasus/1 razgovor/1 poruka.
do $$
declare
  a      uuid := gen_random_uuid();
  a2     uuid := gen_random_uuid();
  b      uuid := gen_random_uuid();
  c      uuid := gen_random_uuid();
  a_doc  uuid := gen_random_uuid();
  b_doc  uuid := gen_random_uuid();
  c_doc  uuid := gen_random_uuid();
  a_chat uuid := gen_random_uuid();
  b_chat uuid := gen_random_uuid();
  c_chat uuid := gen_random_uuid();
  v      public.vector := array_fill(0.01::real, array[1024])::public.vector;
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', a,  'authenticated', 'authenticated', 'p25-test-a-'  || a  || '@example.invalid', '{}', '{"full_name":"P25 Admin A"}',  now(), now()),
    ('00000000-0000-0000-0000-000000000000', a2, 'authenticated', 'authenticated', 'p25-test-a2-' || a2 || '@example.invalid', '{}', '{"full_name":"P25 Admin A2"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', b,  'authenticated', 'authenticated', 'p25-test-b-'  || b  || '@example.invalid', '{}', '{"full_name":"P25 Advokat B"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', c,  'authenticated', 'authenticated', 'p25-test-c-'  || c  || '@example.invalid', '{}', '{"full_name":"P25 Advokat C"}', now(), now());

  -- okidač on_auth_user_created pravi profile (podrazumevana uloga lawyer)
  update public.profiles set role = 'admin' where id in (a, a2);

  insert into public.documents (id, title, user_id) values
    (a_doc, 'P25-TEST A dokument', a),
    (b_doc, 'P25-TEST B dokument', b),
    (c_doc, 'P25-TEST C dokument', c);
  insert into public.document_chunks (document_id, user_id, content, embedding) values
    (a_doc, a, 'P25 A pasus 1', v),
    (b_doc, b, 'P25 B pasus 1', v),
    (b_doc, b, 'P25 B pasus 2', v),
    (c_doc, c, 'P25 C pasus 1', v);
  insert into public.chats (id, title, user_id) values
    (a_chat, 'P25-TEST A razgovor', a),
    (b_chat, 'P25-TEST B razgovor', b),
    (c_chat, 'P25-TEST C razgovor', c);
  insert into public.messages (chat_id, user_id, role, content) values
    (a_chat, a, 'user', 'P25 A pitanje'),
    (b_chat, b, 'user', 'P25 B pitanje'),
    (b_chat, b, 'assistant', 'P25 B odgovor'),
    (c_chat, c, 'user', 'P25 C pitanje');

  -- B: dve poruke (jedna oslobođena se ne broji), jedan dokument. Tokeni: 150 + 300 + 40 + 300 = 790.
  insert into public.usage_ledger (user_id, kind, status, input_tokens, output_tokens, embed_tokens) values
    (b, 'chat',   'settled',  100, 50,  0),
    (b, 'chat',   'settled',  200, 100, 0),
    (b, 'chat',   'released', 0,   0,   40),
    (b, 'ingest', 'settled',  0,   0,   300);

  -- MFA: A ima potvrđen faktor, C samo nepotvrđen (ne računa se).
  insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values
    (gen_random_uuid(), a, 'totp', 'verified',   now(), now()),
    (gen_random_uuid(), c, 'totp', 'unverified', now(), now());

  perform set_config('test.a', a::text, true);
  perform set_config('test.a2', a2::text, true);
  perform set_config('test.b', b::text, true);
  perform set_config('test.c', c::text, true);
  perform set_config('test.a_doc', a_doc::text, true);
  perform set_config('test.b_doc', b_doc::text, true);
  perform set_config('test.a_chat', a_chat::text, true);
  perform set_config('test.b_chat', b_chat::text, true);
end $$;

-- 1. Statička provera konfiguracije (kao vlasnik baze).
do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  b  uuid := current_setting('test.b')::uuid;
  n  int;
  s  text;
  r  record;
begin
  -- šema private postoji i nije izložena
  if not exists (select 1 from information_schema.schemata where schema_name = 'private') then
    raise exception 'TEST: ne postoji šema private (migracija Faze 2.5 nije primenjena?)';
  end if;
  if exists (select 1 from pg_namespace ns, aclexplode(coalesce(ns.nspacl, acldefault('n', ns.nspowner))) acl
             where ns.nspname = 'private' and acl.grantee = 0) then
    raise exception 'CURENJE: šema private je dostupna ulozi PUBLIC';
  end if;
  if has_schema_privilege('anon', 'private', 'usage') then
    raise exception 'CURENJE: anon ima USAGE na šemi private';
  end if;
  if not has_schema_privilege('authenticated', 'private', 'usage')
     or not has_schema_privilege('service_role', 'private', 'usage') then
    raise exception 'TEST: authenticated/service_role nemaju USAGE na šemi private';
  end if;

  -- private.is_admin(): invoker, samo za prijavljene
  if to_regprocedure('private.is_admin()') is null then
    raise exception 'TEST: ne postoji private.is_admin()';
  end if;
  if (select prosecdef from pg_proc where oid = 'private.is_admin()'::regprocedure) then
    raise exception 'CURENJE: private.is_admin() je security definer';
  end if;
  if has_function_privilege('anon', 'private.is_admin()', 'execute')
     or not has_function_privilege('authenticated', 'private.is_admin()', 'execute') then
    raise exception 'CURENJE: private.is_admin() grantovi nisu anon=ne, authenticated=da';
  end if;

  -- trigger funkcija za poslednjeg admina ne sme biti dostupna korisnicima
  if to_regprocedure('private.ensure_admin_remains()') is null then
    raise exception 'TEST: ne postoji private.ensure_admin_remains()';
  end if;
  if has_function_privilege('anon', 'private.ensure_admin_remains()', 'execute')
     or has_function_privilege('authenticated', 'private.ensure_admin_remains()', 'execute') then
    raise exception 'CURENJE: korisnik sme da izvrši private.ensure_admin_remains()';
  end if;
  if not exists (select 1 from pg_trigger
                 where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_keep_one_admin' and tgenabled = 'O') then
    raise exception 'TEST: trigger profiles_keep_one_admin ne postoji ili nije uključen';
  end if;

  -- admin RPC funkcije: security definer, prazan search_path, anon ne sme, authenticated sme
  foreach s in array array[
    'public.admin_list_users()',
    'public.admin_get_user(uuid)',
    'public.admin_set_role(uuid, text)',
    'public.admin_update_settings(integer, integer, bigint, bigint)'
  ] loop
    if to_regprocedure(s) is null then
      raise exception 'TEST: ne postoji %', s;
    end if;
    if not (select prosecdef from pg_proc where oid = s::regprocedure) then
      raise exception 'TEST: % nije security definer (mora da čita auth.users i tuđe redove)', s;
    end if;
    if not coalesce((select 'search_path=""' = any(proconfig) from pg_proc where oid = s::regprocedure), false) then
      raise exception 'CURENJE: % nema set search_path = ''''', s;
    end if;
    if has_function_privilege('anon', s, 'execute') then
      raise exception 'CURENJE: anon sme da izvrši %', s;
    end if;
    if not has_function_privilege('authenticated', s, 'execute') then
      raise exception 'TEST: authenticated ne sme da izvrši % (admin je authenticated)', s;
    end if;
  end loop;

  -- nijedna druga security definer funkcija u public ne sme biti dostupna anon/authenticated
  select count(*) into n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    and p.oid <> all (array[
      coalesce(to_regprocedure('public.admin_list_users()')::oid, 0),
      coalesce(to_regprocedure('public.admin_get_user(uuid)')::oid, 0),
      coalesce(to_regprocedure('public.admin_set_role(uuid, text)')::oid, 0),
      coalesce(to_regprocedure('public.admin_update_settings(integer, integer, bigint, bigint)')::oid, 0),
      -- dodato u 2.5.6 (migracija 20261029100000); njena svojstva proverava phase256_users_test.sql
      coalesce(to_regprocedure('public.admin_set_disabled(uuid, boolean)')::oid, 0)
    ]);
  if n > 0 then raise exception 'CURENJE: % dodatnih security definer funkcija je dostupno anon/authenticated', n; end if;

  -- office_settings: RLS, jedan red, čitanje za prijavljene, nikakav upis osim kroz RPC
  if to_regclass('public.office_settings') is null then
    raise exception 'TEST: ne postoji tabela public.office_settings';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.office_settings'::regclass) then
    raise exception 'CURENJE: office_settings nema uključen RLS';
  end if;
  select count(*) into n from public.office_settings;
  if n <> 1 then raise exception 'TEST: office_settings ima % redova, očekivan tačno 1', n; end if;
  begin
    insert into public.office_settings (id) values (false);
    raise exception 'CURENJE: office_settings prihvatila drugi red';
  exception when check_violation or unique_violation then null;
  end;
  if has_table_privilege('anon', 'public.office_settings', 'select, insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.office_settings', 'insert, update, delete, truncate')
     or has_table_privilege('service_role', 'public.office_settings', 'insert, update, delete, truncate') then
    raise exception 'CURENJE: neko osim RPC funkcije sme da menja office_settings (ili anon sme da čita)';
  end if;
  if not has_table_privilege('authenticated', 'public.office_settings', 'select')
     or not has_table_privilege('service_role', 'public.office_settings', 'select') then
    raise exception 'TEST: authenticated/service_role ne mogu da čitaju office_settings';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'office_settings' and cmd <> 'SELECT';
  if n > 0 then raise exception 'CURENJE: % polisa za upis na office_settings', n; end if;

  -- audit_log: nove akcije i tipovi resursa; stari zapisi i dalje prolaze
  foreach s in array array['user_invited', 'user_disabled', 'user_enabled', 'role_changed',
                           'settings_changed', 'admin_viewed_user', 'audit_exported', 'mfa_enrolled'] loop
    begin
      insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id)
      values (b, 'b@example.invalid', s, 'user', b);
    exception when check_violation then
      raise exception 'TEST: audit_log ne prihvata akciju % (CHECK nije proširen)', s;
    end;
  end loop;
  begin
    insert into public.audit_log (user_id, action, resource_type) values (b, 'settings_changed', 'settings');
  exception when check_violation then
    raise exception 'TEST: audit_log ne prihvata resource_type settings';
  end;
  begin
    insert into public.audit_log (user_id, action, resource_type) values (b, 'chat_created', 'nepoznat_tip');
    raise exception 'CURENJE: audit_log prihvatio nepoznat resource_type';
  exception when check_violation then null;
  end;
  begin
    insert into public.audit_log (user_id, action) values (b, 'nepostojeca_akcija');
    raise exception 'CURENJE: audit_log prihvatio nepoznatu akciju';
  exception when check_violation then null;
  end;
  -- ostaje: 8 akcija + 1 settings = 9 zapisa za B (koristi se niže za proveru vidljivosti admina)

  -- polisa audit_loga zavisi od private.is_admin() (uloga + aal2), ne samo od uloge
  if not exists (select 1 from pg_policy
                 where polrelid = 'public.audit_log'::regclass and polname = 'audit_log_select_own_or_admin'
                   and pg_get_expr(polqual, polrelid) like '%is_admin%') then
    raise exception 'CURENJE: polisa audit_log_select_own_or_admin ne koristi private.is_admin() (admin bez MFA vidi sve?)';
  end if;

  -- bazne tabele sa korisničkim podacima NEMAJU admin polisu (admin nije superkorisnik nad sadržajem)
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('documents', 'document_chunks', 'chats', 'messages', 'usage_ledger', 'profiles')
             and (coalesce(qual, '') ilike '%admin%' or coalesce(with_check, '') ilike '%admin%')
  loop
    raise exception 'CURENJE: polisa % na % pominje admina (admin ne sme da čita tuđe redove)', r.policyname, r.tablename;
  end loop;
end $$;

-- 1b. Test sam određuje ko je admin: A i A2 (pravi admini, ako ih ima, ostaju netaknuti van ove transakcije).
do $$
begin
  alter table public.profiles disable trigger profiles_keep_one_admin;
  update public.profiles set role = 'lawyer'
  where role = 'admin' and id not in (current_setting('test.a')::uuid, current_setting('test.a2')::uuid);
  alter table public.profiles enable trigger profiles_keep_one_admin;
end $$;

-- 2. B (advokat): nikad admin, ni sa aal1 ni sa aal2 (MFA ne daje ulogu).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
set local role authenticated;

do $$
declare
  b      uuid := current_setting('test.b')::uuid;
  c      uuid := current_setting('test.c')::uuid;
  n      int;
  s      text;
  v_aal  text;
begin
  if auth.uid() is distinct from b then
    raise exception 'TEST: impersonacija ne radi (auth.uid() = %, očekivano %)', auth.uid(), b;
  end if;

  foreach v_aal in array array['aal1', 'aal2'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated', 'aal', v_aal)::text, true);

    if private.is_admin() then
      raise exception 'CURENJE: advokat B prolazi private.is_admin() sa %', v_aal;
    end if;

    foreach s in array array[
      'select * from public.admin_list_users()',
      format('select * from public.admin_get_user(%L)', c),
      format('select public.admin_set_role(%L, ''admin'')', b),
      'select public.admin_update_settings(5, 5, 1000, 1000)'
    ] loop
      begin
        execute s;
        raise exception 'CURENJE: advokat B (%) je uspeo da izvrši: %', v_aal, s;
      exception when insufficient_privilege then
        null;  -- očekivano: 42501
      end;
    end loop;
  end loop;

  -- B ne sme da se proglasi adminom ni direktno
  begin
    update public.profiles set role = 'admin' where id = b;
    raise exception 'CURENJE: advokat B je sam sebi dao ulogu admin';
  exception when insufficient_privilege then null;
  end;

  -- podešavanja sme da čita (upozorenje na 80%), ali ne da menja
  select count(*) into n from public.office_settings;
  if n <> 1 then raise exception 'TEST: advokat B vidi % redova office_settings, očekivano 1', n; end if;
  foreach s in array array[
    'update public.office_settings set daily_message_limit = 1',
    'delete from public.office_settings',
    'insert into public.office_settings (id) values (false)'
  ] loop
    begin
      execute s;
      raise exception 'CURENJE: advokat B je uspeo da izvrši: %', s;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- audit: samo svoje (zapisi sa akcijama za B postoje, ali samo B ih vidi)
  select count(*) into n from public.audit_log where user_id is distinct from b;
  if n <> 0 then raise exception 'CURENJE: advokat B vidi % tuđih audit zapisa', n; end if;
end $$;
reset role;

-- 3. A (admin) BEZ MFA (aal1, odnosno bez `aal` u tokenu): nije admin.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  b      uuid := current_setting('test.b')::uuid;
  n      int;
  s      text;
  v_case text;
begin
  if auth.uid() is distinct from a then
    raise exception 'TEST: impersonacija ne radi (auth.uid() = %, očekivano %)', auth.uid(), a;
  end if;

  -- profil jeste admin (uloga u bazi), ali bez aal2 to ne znači ništa
  if (select role from public.profiles where id = a) is distinct from 'admin' then
    raise exception 'TEST: A nije admin u profiles';
  end if;

  foreach v_case in array array['aal1', 'bez_aal'] loop
    if v_case = 'aal1' then
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    else
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    end if;

    if private.is_admin() then
      raise exception 'CURENJE: admin A bez MFA (%) prolazi private.is_admin()', v_case;
    end if;

    foreach s in array array[
      'select * from public.admin_list_users()',
      format('select * from public.admin_get_user(%L)', b),
      format('select public.admin_set_role(%L, ''admin'')', b),
      'select public.admin_update_settings(5, 5, 1000, 1000)'
    ] loop
      begin
        execute s;
        raise exception 'CURENJE: admin A bez MFA (%) je uspeo da izvrši: %', v_case, s;
      exception when insufficient_privilege then null;
      end;
    end loop;

    -- audit log: bez MFA vidi samo svoje zapise, kao običan advokat
    select count(*) into n from public.audit_log where user_id is distinct from a;
    if n <> 0 then raise exception 'CURENJE: admin A bez MFA (%) vidi % tuđih audit zapisa', v_case, n; end if;
  end loop;
end $$;
reset role;

-- 4. A (admin) SA MFA (aal2): uske funkcije rade, ali sadržaj ostaje zaključan.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  a2     uuid := current_setting('test.a2')::uuid;
  b      uuid := current_setting('test.b')::uuid;
  c      uuid := current_setting('test.c')::uuid;
  b_doc  uuid := current_setting('test.b_doc')::uuid;
  b_chat uuid := current_setting('test.b_chat')::uuid;
  n      int;
  m      int;
  u      record;
  g      record;
  txt    text;
  keys   text[];
  old_limit integer;
begin
  if not private.is_admin() then
    raise exception 'TEST: admin A sa aal2 ne prolazi private.is_admin()';
  end if;

  -- 4a. Sadržaj: admin i dalje vidi SAMO svoje redove (uloga ne otvara baznim tabelama)
  select count(*) into n from public.documents;       if n <> 1 then raise exception 'CURENJE: admin vidi % dokumenata, očekivano 1 (svoj)', n; end if;
  select count(*) into n from public.document_chunks; if n <> 1 then raise exception 'CURENJE: admin vidi % pasusa, očekivano 1 (svoj)', n; end if;
  select count(*) into n from public.chats;           if n <> 1 then raise exception 'CURENJE: admin vidi % razgovora, očekivano 1 (svoj)', n; end if;
  select count(*) into n from public.messages;        if n <> 1 then raise exception 'CURENJE: admin vidi % poruka, očekivano 1 (svoju)', n; end if;
  select count(*) into n from public.usage_ledger;    if n <> 0 then raise exception 'CURENJE: admin vidi % tuđih redova potrošnje direktno', n; end if;
  select count(*) into n from public.profiles;        if n <> 1 then raise exception 'CURENJE: admin vidi % profila, očekivano 1 (svoj)', n; end if;
  select count(*), count(*) filter (where document_title <> 'P25-TEST A dokument') into n, m
  from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20);
  if n <> 1 or m > 0 then raise exception 'CURENJE: match_document_chunks za admina vratio % redova (% tuđih), očekivano 1 (0 tuđih)', n, m; end if;

  -- 4b. Audit log: admin sa aal2 vidi zapise drugih (9 koje je test upisao za B), ali ih ne menja
  select count(*) into n from public.audit_log where user_id = b;
  if n <> 9 then raise exception 'TEST: admin A (aal2) vidi % audit zapisa korisnika B, očekivano 9', n; end if;
  begin
    update public.audit_log set action = 'chat_deleted' where user_id = b;
    raise exception 'CURENJE: admin je izmenio audit_log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_log where user_id = b;
    raise exception 'CURENJE: admin je obrisao audit_log';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.audit_log (user_id, action) values (b, 'chat_created');
    raise exception 'CURENJE: admin je lažirao audit zapis direktnim upisom';
  exception when insufficient_privilege then null;
  end;

  -- 4c. admin_list_users: tačni podaci, bez ikakvog sadržaja
  select count(*) into n from public.admin_list_users() where id in (a, a2, b, c);
  if n <> 4 then raise exception 'TEST: admin_list_users vratio % test korisnika, očekivano 4', n; end if;

  select * into u from public.admin_list_users() l where l.id = b;
  if u.email is distinct from ('p25-test-b-' || b || '@example.invalid') then raise exception 'TEST: admin_list_users pogrešan email za B (%)', u.email; end if;
  if u.full_name is distinct from 'P25 Advokat B' or u.role is distinct from 'lawyer' then
    raise exception 'TEST: admin_list_users pogrešno ime/uloga za B (%/%)', u.full_name, u.role;
  end if;
  if u.documents_count <> 1 or u.chats_count <> 1 then
    raise exception 'TEST: admin_list_users B ima % dokumenata / % razgovora, očekivano 1 / 1', u.documents_count, u.chats_count;
  end if;
  if u.daily_messages <> 2 or u.daily_documents <> 1 then
    raise exception 'TEST: admin_list_users B ima % poruka / % dokumenata danas, očekivano 2 / 1', u.daily_messages, u.daily_documents;
  end if;
  if u.daily_tokens <> 790 or u.monthly_tokens <> 790 then
    raise exception 'TEST: admin_list_users B tokeni % / %, očekivano 790 / 790', u.daily_tokens, u.monthly_tokens;
  end if;
  if u.has_mfa then raise exception 'TEST: admin_list_users B nema MFA, a has_mfa = true'; end if;
  if u.banned_until is not null then raise exception 'TEST: admin_list_users B nije blokiran'; end if;

  if not (select has_mfa from public.admin_list_users() l where l.id = a) then
    raise exception 'TEST: admin_list_users A ima potvrđen MFA faktor, a has_mfa = false';
  end if;
  if (select has_mfa from public.admin_list_users() l where l.id = c) then
    raise exception 'TEST: admin_list_users C ima samo nepotvrđen faktor, a has_mfa = true';
  end if;
  select * into u from public.admin_list_users() l where l.id = c;
  if u.daily_messages <> 0 or u.daily_tokens <> 0 or u.documents_count <> 1 then
    raise exception 'TEST: admin_list_users C pogrešna brojila (% / % / %)', u.daily_messages, u.daily_tokens, u.documents_count;
  end if;

  select jsonb_agg(to_jsonb(l))::text into txt from public.admin_list_users() l;
  if txt ~* 'pasus|pitanje|odgovor' then
    raise exception 'CURENJE: admin_list_users vraća sadržaj pasusa/poruka';
  end if;

  -- admin_list_users nema audit zapis (samo nazivi i brojevi), admin_get_user ima (vidi 4d)
  select count(*) into n from public.audit_log where user_id = a and action = 'admin_viewed_user';
  if n <> 0 then raise exception 'TEST: admin_list_users je upisao admin_viewed_user (% zapisa)', n; end if;

  -- 4d. admin_get_user: nazivi i datumi, bez sadržaja, a svaki pregled se beleži
  select count(*) into n from public.admin_get_user(b);
  if n <> 1 then raise exception 'TEST: admin_get_user(B) vratio % redova, očekivano 1', n; end if;
  select * into g from public.admin_get_user(b);
  if g.id <> b or g.email is distinct from ('p25-test-b-' || b || '@example.invalid') then
    raise exception 'TEST: admin_get_user(B) vratio pogrešnog korisnika';
  end if;
  if jsonb_array_length(g.documents) <> 1 or jsonb_array_length(g.chats) <> 1 then
    raise exception 'TEST: admin_get_user(B) vratio % dokumenata / % razgovora, očekivano 1 / 1',
                    jsonb_array_length(g.documents), jsonb_array_length(g.chats);
  end if;
  if g.documents -> 0 ->> 'title' is distinct from 'P25-TEST B dokument'
     or g.chats -> 0 ->> 'title' is distinct from 'P25-TEST B razgovor' then
    raise exception 'TEST: admin_get_user(B) pogrešni nazivi (% / %)', g.documents -> 0 ->> 'title', g.chats -> 0 ->> 'title';
  end if;
  if (g.documents -> 0 ->> 'id')::uuid <> b_doc or (g.chats -> 0 ->> 'id')::uuid <> b_chat then
    raise exception 'TEST: admin_get_user(B) pogrešni ID-evi dokumenta/razgovora';
  end if;
  if (g.documents -> 0 ->> 'chunk_count')::int <> 2 or (g.chats -> 0 ->> 'message_count')::int <> 2 then
    raise exception 'TEST: admin_get_user(B) pogrešni brojevi pasusa/poruka (% / %)',
                    g.documents -> 0 ->> 'chunk_count', g.chats -> 0 ->> 'message_count';
  end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(g.documents -> 0) k;
  if keys is distinct from array['chunk_count', 'created_at', 'id', 'title'] then
    raise exception 'CURENJE: admin_get_user dokument ima polja % (dozvoljeno: chunk_count, created_at, id, title)', keys;
  end if;
  select array_agg(k order by k) into keys from jsonb_object_keys(g.chats -> 0) k;
  if keys is distinct from array['created_at', 'id', 'message_count', 'title'] then
    raise exception 'CURENJE: admin_get_user razgovor ima polja % (dozvoljeno: created_at, id, message_count, title)', keys;
  end if;
  select jsonb_agg(to_jsonb(x))::text into txt from public.admin_get_user(b) x;
  if txt ~* 'pasus|pitanje|odgovor' then
    raise exception 'CURENJE: admin_get_user vraća sadržaj pasusa/poruka';
  end if;

  -- pregled je zabeležen (jedan poziv u 4d dosad: count(*), select *, jsonb_agg = 3 poziva)
  select count(*) into n from public.audit_log
  where user_id = a and action = 'admin_viewed_user' and resource_type = 'user' and resource_id = b;
  if n <> 3 then raise exception 'CURENJE: pregled B je zabeležen % puta, očekivano 3 (po jedan za svaki poziv)', n; end if;
  if (select actor_email from public.audit_log
      where user_id = a and action = 'admin_viewed_user' limit 1) is distinct from ('p25-test-a-' || a || '@example.invalid') then
    raise exception 'TEST: audit admin_viewed_user nema email admina (actor_email)';
  end if;
  if exists (select 1 from public.audit_log where action = 'admin_viewed_user' and metadata::text ~* 'pasus|pitanje|odgovor|dokument') then
    raise exception 'CURENJE: audit admin_viewed_user sadrži tekst';
  end if;

  -- nepostojeći korisnik: nema redova i nema audit zapisa
  select count(*) into n from public.audit_log where action = 'admin_viewed_user';
  select count(*) into m from public.admin_get_user(gen_random_uuid());
  if m <> 0 then raise exception 'TEST: admin_get_user za nepostojećeg korisnika vratio % redova', m; end if;
  if (select count(*) from public.audit_log where action = 'admin_viewed_user') <> n then
    raise exception 'CURENJE: pregled nepostojećeg korisnika je upisan u audit log';
  end if;

  -- 4e. admin_set_role: validacija, audit, bez duplih zapisa
  begin
    perform public.admin_set_role(b, 'superadmin');
    raise exception 'CURENJE: admin_set_role prihvatio nepoznatu ulogu';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_role(b, null);
    raise exception 'CURENJE: admin_set_role prihvatio NULL ulogu';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_set_role(gen_random_uuid(), 'admin');
    raise exception 'CURENJE: admin_set_role prihvatio nepostojećeg korisnika';
  exception when no_data_found then null;
  end;

  perform public.admin_set_role(b, 'admin');
  if (select role from public.admin_list_users() l where l.id = b) is distinct from 'admin' then
    raise exception 'TEST: admin_set_role(B, admin) nije promenio ulogu';
  end if;
  select count(*) into n from public.audit_log
  where user_id = a and action = 'role_changed' and resource_type = 'user' and resource_id = b
    and metadata ->> 'from' = 'lawyer' and metadata ->> 'to' = 'admin';
  if n <> 1 then raise exception 'TEST: role_changed zapis za B -> admin: %, očekivano 1', n; end if;
  perform public.admin_set_role(b, 'admin');   -- ista uloga: bez promene i bez novog zapisa
  select count(*) into n from public.audit_log where user_id = a and action = 'role_changed';
  if n <> 1 then raise exception 'CURENJE: ista uloga je ponovo upisana u audit (% zapisa)', n; end if;
  perform public.admin_set_role(b, 'lawyer');
  select count(*) into n from public.audit_log where user_id = a and action = 'role_changed';
  if n <> 2 then raise exception 'TEST: role_changed zapisa %, očekivano 2', n; end if;

  -- 4f. Poslednji admin: A2 se skida (A ostaje), pa A ne može da skine sebe
  perform public.admin_set_role(a2, 'lawyer');
  begin
    perform public.admin_set_role(a, 'lawyer');
    raise exception 'CURENJE: skinut je poslednji admin (kancelarija bez admina)';
  exception when check_violation then null;
  end;
  if (select role from public.profiles where id = a) is distinct from 'admin' then
    raise exception 'CURENJE: A je izgubio ulogu iako je poslednji admin';
  end if;
  if not private.is_admin() then raise exception 'TEST: A više nije admin posle neuspelog skidanja'; end if;
  select count(*) into n from public.audit_log where user_id = a and action = 'role_changed' and resource_id = a;
  if n <> 0 then raise exception 'CURENJE: neuspelo skidanje poslednjeg admina je ostalo u audit logu'; end if;
  perform public.admin_set_role(a2, 'admin');  -- dva admina ponovo

  -- 4g. admin_update_settings: opseg, NULL, audit sa starom i novom vrednošću
  select daily_message_limit into old_limit from public.office_settings;
  begin
    perform public.admin_update_settings(0, 20, 1000000, 20000000);
    raise exception 'CURENJE: admin_update_settings prihvatio dnevni limit poruka 0';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_update_settings(100000, 20, 1000000, 20000000);
    raise exception 'CURENJE: admin_update_settings prihvatio dnevni limit poruka 100000';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_update_settings(100, 20, -1, 20000000);
    raise exception 'CURENJE: admin_update_settings prihvatio negativan budžet';
  exception when check_violation then null;
  end;
  begin
    perform public.admin_update_settings(100, null, 1000000, 20000000);
    raise exception 'CURENJE: admin_update_settings prihvatio NULL';
  exception when invalid_parameter_value then null;
  end;
  if (select daily_message_limit from public.office_settings) <> old_limit then
    raise exception 'CURENJE: neispravan poziv admin_update_settings je promenio podešavanja';
  end if;
  if exists (select 1 from public.audit_log where action = 'settings_changed' and user_id = a) then
    raise exception 'CURENJE: neispravan poziv admin_update_settings je upisan u audit log';
  end if;

  perform public.admin_update_settings(50, 10, 500000, 5000000);
  select * into g from public.office_settings;
  if g.daily_message_limit <> 50 or g.daily_document_limit <> 10 or g.daily_token_budget <> 500000 or g.monthly_token_budget <> 5000000 then
    raise exception 'TEST: admin_update_settings nije upisao nove vrednosti';
  end if;
  if g.updated_by is distinct from a then raise exception 'TEST: office_settings.updated_by nije admin koji je menjao'; end if;
  select count(*) into n from public.audit_log
  where user_id = a and action = 'settings_changed' and resource_type = 'settings'
    and (metadata -> 'old' ->> 'daily_message_limit')::int = old_limit
    and (metadata -> 'new' ->> 'daily_message_limit')::int = 50
    and (metadata -> 'new' ->> 'monthly_token_budget')::bigint = 5000000;
  if n <> 1 then raise exception 'TEST: settings_changed zapis sa starom i novom vrednošću: %, očekivano 1', n; end if;

  -- 4h. Čak ni admin ne menja podešavanja i uloge mimo RPC funkcija
  foreach txt in array array[
    'update public.office_settings set daily_message_limit = 1',
    'delete from public.office_settings',
    format('update public.profiles set role = ''lawyer'' where id = %L', a),
    format('update public.profiles set role = ''admin'' where id = %L', c),
    'delete from public.profiles'
  ] loop
    begin
      execute txt;
      raise exception 'CURENJE: admin je mimo RPC funkcija izvršio: %', txt;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

-- 5. service_role (server): poziva, upisuje audit za pozive/blokade, ali ne menja podešavanja.
set local role service_role;

do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  a2 uuid := current_setting('test.a2')::uuid;
  b  uuid := current_setting('test.b')::uuid;
  n  int;
begin
  select count(*) into n from public.office_settings;
  if n <> 1 then raise exception 'TEST: service_role vidi % redova office_settings, očekivano 1', n; end if;
  begin
    update public.office_settings set daily_message_limit = 1;
    raise exception 'CURENJE: service_role je izmenio office_settings';
  exception when insufficient_privilege then null;
  end;

  -- server upisuje audit za radnje nad nalozima (poziv, blokada...) preko Auth Admin API-ja
  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id, metadata)
  values (a, 'a@example.invalid', 'user_invited', 'user', b, '{"email_domain": "example.invalid"}'),
         (a, 'a@example.invalid', 'audit_exported', null, null, '{"rows": 3}');

  -- poslednji admin je zaštićen i od greške u SQL Editoru ili serverskom kodu:
  -- bilo koji put koji ostavlja 0 admina puca na 23514
  begin
    update public.profiles set role = 'lawyer' where id in (a, a2);
    raise exception 'CURENJE: service_role je skinuo oba admina odjednom';
  exception when check_violation then null;
  end;
  update public.profiles set role = 'lawyer' where id = a2;   -- A ostaje: dozvoljeno
  begin
    update public.profiles set role = 'lawyer' where id = a;
    raise exception 'CURENJE: service_role je skinuo poslednjeg admina';
  exception when check_violation then null;
  end;
  begin
    delete from public.profiles where id = a;
    raise exception 'CURENJE: service_role je obrisao profil poslednjeg admina';
  exception when check_violation then null;
  end;
  update public.profiles set role = 'admin' where id = a2;    -- prvo postavljanje i vraćanje ne smeju da smetaju
  delete from public.profiles where id = a2;                   -- A ostaje: brisanje drugog admina je dozvoljeno
  if (select count(*) from public.profiles where role = 'admin') <> 1 then
    raise exception 'TEST: posle brisanja profila A2 očekivan 1 admin';
  end if;
end $$;
reset role;

-- 6. anon (javni ključ iz JS bundle-a): ništa ne sme da prođe.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  s text;
begin
  foreach s in array array[
    'select private.is_admin()',
    'select * from public.admin_list_users()',
    format('select * from public.admin_get_user(%L)', current_setting('test.b')),
    format('select public.admin_set_role(%L, ''admin'')', current_setting('test.b')),
    'select public.admin_update_settings(5, 5, 1000, 1000)',
    'select count(*) from public.office_settings'
  ] loop
    begin
      execute s;
      raise exception 'CURENJE: anon je uspeo da izvrši: %', s;
    exception when insufficient_privilege then
      null;  -- očekivano: 42501
    end;
  end loop;
end $$;
reset role;

do $$ begin raise notice 'FAZA 2.5: svi admin testovi prošli'; end $$;
select 'FAZA 2.5: svi admin testovi prošli' as rezultat;

rollback;
