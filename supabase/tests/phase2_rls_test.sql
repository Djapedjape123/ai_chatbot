-- FAZA 2: test potrošnje (usage ledger), audit loga, uloga i IP burst brojača.
--
-- Pokreće se u Supabase SQL Editoru POSLE primene migracije 20261028120000_phase2_usage_audit.sql
-- i posle SVAKE kasnije promene baze (trajno pravilo 6 iz CLAUDE.md), zajedno sa phase1_rls_test.sql.
--
-- Test sam pravi tri privremena korisnika (A i B advokati, C admin) i na kraju SVE poništava
-- (rollback): u bazi ne ostaje ništa, ni redovi u ledger-u ni u audit logu.
--
-- Uspeh: nema greške i ispisuje se "FAZA 2: svi testovi prošli".
-- Curenje: skripta puca sa "CURENJE: ...". Ako puca sa "TEST: ...", problem je u samom testu.
begin;

-- 0. Podaci: A, B i C. C postaje admin (kao što bi to uradio vlasnik u SQL Editoru).
do $$
declare
  a      uuid := gen_random_uuid();
  b      uuid := gen_random_uuid();
  c      uuid := gen_random_uuid();
  a_chat uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'p2-test-a-' || a || '@example.invalid', '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'p2-test-b-' || b || '@example.invalid', '{}', '{}', now(), now()),
    -- pokušaj da se uloga podmetne kroz user_metadata (korisnik ih bira pri registraciji) ne sme da uspe
    ('00000000-0000-0000-0000-000000000000', c, 'authenticated', 'authenticated', 'p2-test-c-' || c || '@example.invalid', '{}', '{"role":"admin"}', now(), now());

  -- okidač pravi profile sa podrazumevanom ulogom
  if (select count(*) from public.profiles where id in (a, b, c) and role = 'lawyer') <> 3 then
    raise exception 'CURENJE: novi nalozi ne dobijaju ulogu lawyer (ili user_metadata menja ulogu)';
  end if;

  update public.profiles set role = 'admin' where id = c;

  insert into public.chats (id, title, user_id) values (a_chat, 'P2-TEST A razgovor', a);

  perform set_config('test.a', a::text, true);
  perform set_config('test.b', b::text, true);
  perform set_config('test.c', c::text, true);
  perform set_config('test.a_chat', a_chat::text, true);
end $$;

-- 1. Statička provera konfiguracije (kao vlasnik baze).
do $$
declare
  n int;
  s text;
begin
  select count(*) into n from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('usage_ledger', 'audit_log', 'ip_rate_limit', 'profiles')
    and not relrowsecurity;
  if n > 0 then raise exception 'CURENJE: % tabela Faze 2 nema uključen RLS', n; end if;

  select count(*) into n from pg_class
  where relnamespace = 'public'::regnamespace and relname in ('usage_ledger', 'audit_log', 'ip_rate_limit');
  if n <> 3 then raise exception 'TEST: očekivane 3 tabele Faze 2, nađeno %', n; end if;

  -- korisnik ni na jednoj od ovih tabela nema polisu za upis
  select count(*) into n from pg_policies
  where schemaname = 'public'
    and tablename in ('usage_ledger', 'audit_log', 'ip_rate_limit', 'profiles')
    and cmd <> 'SELECT' and permissive = 'PERMISSIVE';  -- restriktivna polisa (2.5.11) samo sužava, ne daje pristup
  if n > 0 then raise exception 'CURENJE: % polisa za upis na tabelama Faze 2', n; end if;

  -- authenticated: samo SELECT na ledger/audit/profiles, ništa na ip_rate_limit
  foreach s in array array['usage_ledger', 'audit_log', 'profiles'] loop
    if has_table_privilege('authenticated', 'public.' || s, 'insert, update, delete, truncate') then
      raise exception 'CURENJE: authenticated sme da menja public.%', s;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.ip_rate_limit', 'select, insert, update, delete') then
    raise exception 'CURENJE: authenticated ima pristup public.ip_rate_limit';
  end if;

  -- server ne sme da briše istoriju potrošnje, a audit log je append-only i za njega
  if has_table_privilege('service_role', 'public.usage_ledger', 'delete, truncate') then
    raise exception 'CURENJE: service_role sme da briše usage_ledger';
  end if;
  if has_table_privilege('service_role', 'public.audit_log', 'update, delete, truncate') then
    raise exception 'CURENJE: service_role sme da menja ili briše audit_log';
  end if;
  -- pozitivna kontrola: server mora moći da upisuje (od 2026-10-30 nema automatskih grantova)
  if not has_table_privilege('service_role', 'public.usage_ledger', 'select, insert, update')
     or not has_table_privilege('service_role', 'public.audit_log', 'select, insert')
     or not has_table_privilege('service_role', 'public.ip_rate_limit', 'select, insert, update') then
    raise exception 'TEST: service_role nema grantove potrebne serveru';
  end if;

  -- funkcije sa user_id parametrom smeju da izvrše SAMO server
  foreach s in array array[
    'public.reserve_usage(uuid, text, integer, integer, bigint, bigint)',
    'public.close_usage(uuid, uuid, integer, integer, integer, boolean)',
    'public.hit_ip_rate_limit(inet, integer, integer)'
  ] loop
    if has_function_privilege('authenticated', s, 'execute') or has_function_privilege('anon', s, 'execute') then
      raise exception 'CURENJE: korisnik sme da izvrši %', s;
    end if;
    if not has_function_privilege('service_role', s, 'execute') then
      raise exception 'TEST: service_role ne sme da izvrši %', s;
    end if;
    if (select prosecdef from pg_proc where oid = s::regprocedure) then
      raise exception 'CURENJE: % je security definer', s;
    end if;
  end loop;

  if (select prosecdef from pg_proc where oid = 'public.get_usage_summary()'::regprocedure)
     or has_function_privilege('anon', 'public.get_usage_summary()', 'execute') then
    raise exception 'CURENJE: get_usage_summary je security definer ili ga sme anon';
  end if;
end $$;

-- 2. Server (service_role): rezervacije, limiti, zatvaranje, audit, IP brojač.
set local role service_role;

do $$
declare
  a   uuid := current_setting('test.a')::uuid;
  b   uuid := current_setting('test.b')::uuid;
  c   uuid := current_setting('test.c')::uuid;
  r   record;
  ids uuid[] := '{}';
  ok  boolean;
begin
  -- limit 3 poruke dnevno: prve 3 prolaze, 4. se odbija
  for i in 1..3 loop
    select * into r from public.reserve_usage(a, 'chat', 100, 3, 1000000, 20000000);
    if not r.allowed or r.reservation_id is null then
      raise exception 'TEST: rezervacija % za A odbijena (%)', i, r.reason;
    end if;
    ids := ids || r.reservation_id;
  end loop;
  select * into r from public.reserve_usage(a, 'chat', 100, 3, 1000000, 20000000);
  if r.allowed or r.reason <> 'daily_count' or r.daily_count <> 3 then
    raise exception 'CURENJE: 4. poruka preko limita od 3 je prošla (allowed=%, reason=%, count=%)', r.allowed, r.reason, r.daily_count;
  end if;

  -- neuspeo poziv (released) ne troši dnevni limit, ali potrošeni tokeni ostaju u budžetu
  ok := public.close_usage(ids[1], a, 0, 0, 50, true);
  if not ok then raise exception 'TEST: close_usage(release) nije zatvorio rezervaciju'; end if;
  select * into r from public.reserve_usage(a, 'chat', 100, 3, 1000000, 20000000);
  if not r.allowed then raise exception 'TEST: posle release-a nova poruka odbijena (%)', r.reason; end if;
  -- tokeni: 3 rezervacije x 100 + 50 stvarno potrošenih na oslobođenoj
  if r.daily_tokens <> 350 then raise exception 'TEST: dnevni tokeni %, očekivano 350', r.daily_tokens; end if;

  -- settle upisuje stvarne tokene; ponovno zatvaranje i tuđi user_id ne rade ništa
  ok := public.close_usage(ids[2], a, 1000, 200, 10, false);
  if not ok then raise exception 'TEST: close_usage(settle) nije zatvorio rezervaciju'; end if;
  ok := public.close_usage(ids[2], a, 1, 1, 1, false);
  if ok then raise exception 'CURENJE: zatvorena rezervacija je ponovo zatvorena (prepisana potrošnja)'; end if;
  ok := public.close_usage(ids[3], b, 0, 0, 0, true);
  if ok then raise exception 'CURENJE: B je zatvorio A-ovu rezervaciju'; end if;

  -- budžet tokena: procena koja bi probila dnevni budžet se odbija (chat i ingest dele budžet)
  select * into r from public.reserve_usage(a, 'ingest', 5000, 20, 2000, 20000000);
  if r.allowed or r.reason <> 'daily_tokens' then
    raise exception 'CURENJE: ingest preko dnevnog budžeta tokena je prošao (allowed=%, reason=%)', r.allowed, r.reason;
  end if;
  select * into r from public.reserve_usage(a, 'ingest', 5000, 20, 1000000, 2000);
  if r.allowed or r.reason <> 'monthly_tokens' then
    raise exception 'CURENJE: ingest preko mesečnog budžeta tokena je prošao (allowed=%, reason=%)', r.allowed, r.reason;
  end if;
  -- limit dokumenata se broji odvojeno od poruka
  select * into r from public.reserve_usage(a, 'ingest', 10, 20, 1000000, 20000000);
  if not r.allowed or r.daily_count <> 1 then
    raise exception 'TEST: prvi dokument za A odbijen ili pogrešno brojan (%/%)', r.reason, r.daily_count;
  end if;

  -- B ima svoj, nezavisan brojač
  select * into r from public.reserve_usage(b, 'chat', 100, 3, 1000000, 20000000);
  if not r.allowed or r.daily_count <> 1 then
    raise exception 'CURENJE: B-ov brojač nije nezavisan od A-ovog (count=%)', r.daily_count;
  end if;

  -- neispravni argumenti
  begin
    perform public.reserve_usage(a, 'nesto', 1, 1, 1, 1);
    raise exception 'TEST: reserve_usage prihvatio nepoznat kind';
  exception when invalid_parameter_value then null;
  end;

  -- audit: po jedan zapis za A i B, bez sadržaja
  insert into public.audit_log (user_id, actor_email, action, resource_type, resource_id, metadata, ip) values
    (a, 'a@example.invalid', 'chat_created', 'chat', current_setting('test.a_chat')::uuid, '{}', '203.0.113.1'),
    (b, 'b@example.invalid', 'question_asked', null, null, '{"tokens": 10}', '203.0.113.2');

  begin
    insert into public.audit_log (user_id, action) values (a, 'nepostojeca_akcija');
    raise exception 'CURENJE: audit_log prihvatio nepoznatu akciju';
  exception when check_violation then null;
  end;
  begin
    insert into public.audit_log (user_id, action, metadata) values (a, 'chat_created', '"tekst"');
    raise exception 'CURENJE: audit_log prihvatio metadata koji nije objekat';
  exception when check_violation then null;
  end;
  begin
    insert into public.audit_log (user_id, action, metadata)
    values (a, 'chat_created', jsonb_build_object('x', repeat('a', 5000)));
    raise exception 'CURENJE: audit_log prihvatio metadata veći od 4KB (sadržaj dokumenta?)';
  exception when check_violation then null;
  end;

  -- server ne sme da briše ledger ni da menja audit
  begin
    delete from public.usage_ledger where user_id = a;
    raise exception 'CURENJE: service_role je obrisao usage_ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.audit_log set action = 'chat_deleted' where user_id = a;
    raise exception 'CURENJE: service_role je izmenio audit_log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_log where user_id = a;
    raise exception 'CURENJE: service_role je obrisao audit_log';
  exception when insufficient_privilege then null;
  end;

  -- IP burst: limit 2 u prozoru, 3. zahtev se odbija; druga IP adresa ima svoj brojač
  if not public.hit_ip_rate_limit('198.51.100.7', 2, 3600) then raise exception 'TEST: 1. IP zahtev odbijen'; end if;
  if not public.hit_ip_rate_limit('198.51.100.7', 2, 3600) then raise exception 'TEST: 2. IP zahtev odbijen'; end if;
  if public.hit_ip_rate_limit('198.51.100.7', 2, 3600) then raise exception 'CURENJE: 3. IP zahtev preko limita od 2 je prošao'; end if;
  if not public.hit_ip_rate_limit('198.51.100.8', 2, 3600) then raise exception 'CURENJE: IP brojač nije nezavisan po adresi'; end if;
end $$;
reset role;

-- 3. A (advokat): vidi samo svoje, ne može ništa da upiše, briše ni da sebi da admin ulogu.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  b      uuid := current_setting('test.b')::uuid;
  a_chat uuid := current_setting('test.a_chat')::uuid;
  n      int;
  m      int;
  s      text;
  u      record;
begin
  if auth.uid() is distinct from a then
    raise exception 'TEST: impersonacija ne radi (auth.uid() = %, očekivano %)', auth.uid(), a;
  end if;

  -- ledger: tačno svoji redovi (4 chat + 3 ingest pokušaja, od kojih su upisana 4 chat + 1 ingest)
  select count(*), count(*) filter (where user_id <> a) into n, m from public.usage_ledger;
  if m > 0 then raise exception 'CURENJE: A vidi % tuđih redova potrošnje', m; end if;
  if n <> 5 then raise exception 'TEST: A vidi % svojih redova potrošnje, očekivano 5', n; end if;

  -- audit: samo svoj zapis
  select count(*), count(*) filter (where user_id is distinct from a) into n, m from public.audit_log;
  if m > 0 then raise exception 'CURENJE: advokat A vidi % tuđih audit zapisa', m; end if;
  if n <> 1 then raise exception 'TEST: A vidi % svojih audit zapisa, očekivano 1', n; end if;

  -- profil: vidi samo svoj, i to sa ulogom
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'CURENJE: A vidi % profila, očekivano 1 (svoj)', n; end if;
  if (select role from public.profiles where id = a) <> 'lawyer' then
    raise exception 'TEST: A ne vidi svoju ulogu';
  end if;

  -- pregled potrošnje: 3 poruke danas (jedna oslobođena se ne broji), 1 dokument
  select * into u from public.get_usage_summary();
  if u.daily_messages <> 3 or u.daily_documents <> 1 then
    raise exception 'TEST: get_usage_summary vratio % poruka / % dokumenata, očekivano 3 / 1', u.daily_messages, u.daily_documents;
  end if;
  -- tokeni: oslobođena 50 + settled 1210 + 2 rezervisane x 100 + ingest 10 = 1470
  if u.daily_tokens <> 1470 or u.monthly_tokens <> 1470 then
    raise exception 'TEST: get_usage_summary tokeni % / %, očekivano 1470 / 1470', u.daily_tokens, u.monthly_tokens;
  end if;

  -- brisanje razgovora NE resetuje brojač (zaobilaženje iz revizije Faze 1)
  delete from public.chats where id = a_chat;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'TEST: A ne može da obriše svoj razgovor'; end if;
  select * into u from public.get_usage_summary();
  if u.daily_messages <> 3 then
    raise exception 'CURENJE: brisanje razgovora je promenilo brojač poruka (% umesto 3)', u.daily_messages;
  end if;

  foreach s in array array[
    format('insert into public.usage_ledger (user_id, kind) values (%L, ''chat'')', a),
    'update public.usage_ledger set status = ''released''',
    'delete from public.usage_ledger',
    format('insert into public.audit_log (user_id, action) values (%L, ''chat_created'')', a),
    'update public.audit_log set action = ''chat_deleted''',
    'delete from public.audit_log',
    'update public.profiles set role = ''admin''',
    'select count(*) from public.ip_rate_limit',
    format('select public.reserve_usage(%L, ''chat'', 1, 1000, 1000000, 1000000)', a),
    format('select public.close_usage(gen_random_uuid(), %L, 0, 0, 0, true)', a),
    'select public.hit_ip_rate_limit(''203.0.113.9'', 1000, 60)'
  ] loop
    begin
      execute s;
      raise exception 'CURENJE: advokat A je uspeo da izvrši: %', s;
    exception when insufficient_privilege then
      null;  -- očekivano: 42501
    end;
  end loop;
end $$;
reset role;

-- 4. C (admin, prijavljen sa MFA = aal2): vidi SVE audit zapise, ali potrošnju samo svoju (ledger nije za admina).
--    Od migracije 20261028150000 (Faza 2.5) admin vidi tuđe audit zapise samo sa aal2; admin bez MFA
--    vidi samo svoje, što proverava phase25_admin_test.sql.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.c'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
  b uuid := current_setting('test.b')::uuid;
  n int;
begin
  select count(*) into n from public.audit_log where user_id in (a, b);
  if n <> 2 then raise exception 'TEST: admin C vidi % audit zapisa A i B, očekivano 2', n; end if;

  select count(*) into n from public.usage_ledger;
  if n <> 0 then raise exception 'CURENJE: admin vidi % tuđih redova potrošnje', n; end if;

  begin
    update public.audit_log set action = 'chat_deleted';
    raise exception 'CURENJE: admin je izmenio audit_log';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_log;
    raise exception 'CURENJE: admin je obrisao audit_log';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 5. anon (javni ključ iz JS bundle-a): ništa ne sme da prođe.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  s text;
begin
  foreach s in array array[
    'select count(*) from public.usage_ledger',
    'select count(*) from public.audit_log',
    'select count(*) from public.ip_rate_limit',
    'select * from public.get_usage_summary()',
    format('select public.reserve_usage(%L, ''chat'', 1, 1000, 1000000, 1000000)', current_setting('test.a')),
    'select public.hit_ip_rate_limit(''203.0.113.9'', 1000, 60)'
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

-- 6. Retencija je zakazana.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'audit-log-retention-90d') then
    raise exception 'TEST: nije zakazana retencija audit loga (pg_cron)';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ip-rate-limit-cleanup') then
    raise exception 'TEST: nije zakazano čišćenje IP brojača (pg_cron)';
  end if;
end $$;

do $$ begin raise notice 'FAZA 2: svi testovi prošli'; end $$;
select 'FAZA 2: svi testovi prošli' as rezultat;

rollback;
