-- FAZA 2.5.6: blokada naloga (profiles.disabled_at), admin_set_disabled i "bar jedan AKTIVAN admin".
--
-- Pokreće se u Supabase SQL Editoru POSLE primene migracije 20261029100000_phase256_user_blocking.sql
-- i posle SVAKE kasnije promene baze (trajno pravilo 6 iz CLAUDE.md), zajedno sa phase1, phase2 i phase25 testom.
--
-- Test sam pravi pet privremenih korisnika (A i A2 admini, B i C advokati, D advokat BEZ profila), pa na kraju
-- SVE poništava (rollback): u bazi ne ostaje ništa. Predstavlja se kao A, A2, B, anon i service_role
-- (set local role + request.jwt.claims, uključujući `aal`). Pravi admini u bazi ne smetaju: test ih unutar
-- svoje transakcije privremeno svede na A i A2.
--
-- Uspeh: nema greške i ispisuje se "FAZA 2.5.6: svi testovi blokade prošli".
-- Curenje: skripta puca sa "CURENJE: ...". Ako puca sa "TEST: ...", problem je u samom testu
-- ili migracija nije primenjena.
begin;

-- 0. Podaci. A i A2 su admini, B i C advokati, D advokat bez profila (stari nalog, vidi Fazu 2 korak 1).
do $$
declare
  a  uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid();
  b  uuid := gen_random_uuid();
  c  uuid := gen_random_uuid();
  d  uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', a,  'authenticated', 'authenticated', 'p256-test-a-'  || a  || '@example.invalid', '{}', '{"full_name":"P256 Admin A"}',  now(), now()),
    ('00000000-0000-0000-0000-000000000000', a2, 'authenticated', 'authenticated', 'p256-test-a2-' || a2 || '@example.invalid', '{}', '{"full_name":"P256 Admin A2"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', b,  'authenticated', 'authenticated', 'p256-test-b-'  || b  || '@example.invalid', '{}', '{"full_name":"P256 Advokat B"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', c,  'authenticated', 'authenticated', 'p256-test-c-'  || c  || '@example.invalid', '{}', '{"full_name":"P256 Advokat C"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', d,  'authenticated', 'authenticated', 'p256-test-d-'  || d  || '@example.invalid', '{}', '{"full_name":"P256 Advokat D"}', now(), now());

  -- okidač on_auth_user_created pravi profile (podrazumevana uloga lawyer)
  update public.profiles set role = 'admin' where id in (a, a2);
  delete from public.profiles where id = d;

  perform set_config('test.a', a::text, true);
  perform set_config('test.a2', a2::text, true);
  perform set_config('test.b', b::text, true);
  perform set_config('test.c', c::text, true);
  perform set_config('test.d', d::text, true);
  -- auth.users nije čitljiv ulozi authenticated, pa se e-mailovi pamte unapred
  perform set_config('test.a_email', (select u.email from auth.users u where u.id = a), true);
  perform set_config('test.d_email', (select u.email from auth.users u where u.id = d), true);
end $$;

-- 1. Statička provera konfiguracije (kao vlasnik baze).
do $$
declare
  s text := 'public.admin_set_disabled(uuid, boolean)';
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'disabled_at'
                   and data_type = 'timestamp with time zone' and is_nullable = 'YES') then
    raise exception 'TEST: ne postoji kolona public.profiles.disabled_at (migracija 2.5.6 nije primenjena?)';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'disabled_at', 'update')
     or has_column_privilege('anon', 'public.profiles', 'disabled_at', 'select') then
    raise exception 'CURENJE: authenticated sme da menja disabled_at, ili anon sme da ga čita';
  end if;

  if to_regprocedure(s) is null then
    raise exception 'TEST: ne postoji %', s;
  end if;
  if not (select prosecdef from pg_proc where oid = s::regprocedure) then
    raise exception 'TEST: % nije security definer', s;
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

  -- admin_list_users i admin_get_user vraćaju i disabled_at
  if not exists (select 1 from pg_proc p, unnest(p.proargnames) n
                 where p.oid = 'public.admin_list_users()'::regprocedure and n = 'disabled_at')
     or not exists (select 1 from pg_proc p, unnest(p.proargnames) n
                    where p.oid = 'public.admin_get_user(uuid)'::regprocedure and n = 'disabled_at') then
    raise exception 'TEST: admin_list_users/admin_get_user ne vraćaju kolonu disabled_at';
  end if;
  -- i dalje samo za prijavljene
  if has_function_privilege('anon', 'public.admin_list_users()', 'execute')
     or has_function_privilege('anon', 'public.admin_get_user(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_list_users()', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_get_user(uuid)', 'execute') then
    raise exception 'CURENJE: grantovi admin_list_users/admin_get_user nisu anon=ne, authenticated=da';
  end if;
end $$;

-- 1b. Test sam određuje ko je admin: A i A2 (pravi admini, ako ih ima, ostaju netaknuti van ove transakcije).
do $$
begin
  alter table public.profiles disable trigger profiles_keep_one_admin;
  update public.profiles set role = 'lawyer'
  where role = 'admin' and id not in (current_setting('test.a')::uuid, current_setting('test.a2')::uuid);
  alter table public.profiles enable trigger profiles_keep_one_admin;
end $$;

-- 2. B (advokat): ne sme da blokira nikoga, ni sa aal2.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
set local role authenticated;

do $$
declare
  b uuid := current_setting('test.b')::uuid;
  c uuid := current_setting('test.c')::uuid;
begin
  begin
    perform public.admin_set_disabled(c, true);
    raise exception 'CURENJE: advokat je blokirao drugog advokata';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_set_disabled(b, false);
    raise exception 'CURENJE: advokat je pozvao admin_set_disabled nad sobom';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set disabled_at = null where id = b;
    raise exception 'CURENJE: advokat je direktno izmenio profiles.disabled_at';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 3. A (admin) BEZ MFA (aal1, odnosno bez `aal` u tokenu): nije admin, pa ne blokira.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
  b uuid := current_setting('test.b')::uuid;
begin
  begin
    perform public.admin_set_disabled(b, true);
    raise exception 'CURENJE: admin sa aal1 je blokirao nalog';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  begin
    perform public.admin_set_disabled(b, true);
    raise exception 'CURENJE: admin bez `aal` u tokenu je blokirao nalog';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- (samo test nalozi: u pravoj bazi mogu da postoje stvarno blokirani nalozi i zapisi)
do $$
declare
  ids uuid[] := array[current_setting('test.b')::uuid, current_setting('test.c')::uuid];
begin
  if exists (select 1 from public.profiles where id = any(ids) and disabled_at is not null) then
    raise exception 'CURENJE: neki profil je blokiran bez admina sa aal2';
  end if;
  if exists (select 1 from public.audit_log where action in ('user_disabled', 'user_enabled') and resource_id = any(ids)) then
    raise exception 'CURENJE: odbijen poziv je ostavio audit zapis';
  end if;
end $$;

-- 4. A (admin) SA MFA (aal2): blokira i odblokira, svaki put sa audit zapisom, bez dupliranja.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  b  uuid := current_setting('test.b')::uuid;
  c  uuid := current_setting('test.c')::uuid;
  d  uuid := current_setting('test.d')::uuid;
  v  timestamptz;
  n  int;
  r  record;
  s  text;
begin
  -- blokada B
  perform public.admin_set_disabled(b, true);
  select l.disabled_at into v from public.admin_list_users() l where l.id = b;
  if v is null then raise exception 'TEST: admin_list_users ne vraća disabled_at za blokiranog B'; end if;
  select l.disabled_at into v from public.admin_list_users() l where l.id = c;
  if v is not null then raise exception 'TEST: neblokiran C ima disabled_at'; end if;
  select g.disabled_at into v from public.admin_get_user(b) g;
  if v is null then raise exception 'TEST: admin_get_user ne vraća disabled_at za blokiranog B'; end if;

  select * into r from public.audit_log where action = 'user_disabled' and resource_id = b;
  if not found then raise exception 'TEST: blokada B nije ostavila audit zapis user_disabled'; end if;
  if r.user_id is distinct from a or r.resource_type is distinct from 'user'
     or r.actor_email is distinct from current_setting('test.a_email') then
    raise exception 'TEST: audit user_disabled ima pogrešnog aktera/tip resursa: %', to_jsonb(r);
  end if;
  if r.metadata is distinct from '{}'::jsonb then
    raise exception 'CURENJE: audit user_disabled nosi metadata (očekivano prazno): %', r.metadata;
  end if;

  -- ponovna blokada istog naloga ne radi ništa i ne pravi novi audit zapis
  perform public.admin_set_disabled(b, true);
  select count(*) into n from public.audit_log where action = 'user_disabled' and resource_id = b;
  if n <> 1 then raise exception 'TEST: ponovna blokada B je napravila % audit zapisa (očekivan 1)', n; end if;

  -- odblokada B
  perform public.admin_set_disabled(b, false);
  select l.disabled_at into v from public.admin_list_users() l where l.id = b;
  if v is not null then raise exception 'TEST: odblokiran B i dalje ima disabled_at'; end if;
  select count(*) into n from public.audit_log where action = 'user_enabled' and resource_id = b;
  if n <> 1 then raise exception 'TEST: odblokada B je napravila % audit zapisa user_enabled (očekivan 1)', n; end if;
  perform public.admin_set_disabled(b, false);
  select count(*) into n from public.audit_log where action = 'user_enabled' and resource_id = b;
  if n <> 1 then raise exception 'TEST: ponovna odblokada B je napravila novi audit zapis'; end if;

  -- odblokada naloga koji nikad nije bio blokiran ne pravi audit
  perform public.admin_set_disabled(c, false);
  if exists (select 1 from public.audit_log where action = 'user_enabled' and resource_id = c) then
    raise exception 'TEST: odblokada neblokiranog C napravila audit zapis';
  end if;

  -- sebe ne blokira (baza je poslednja linija, UI/akcija to odbija ranije)
  begin
    perform public.admin_set_disabled(a, true);
    raise exception 'CURENJE: admin je blokirao sam sebe';
  exception when invalid_parameter_value then null;
  end;
  select l.disabled_at into v from public.admin_list_users() l where l.id = a;
  if v is not null then raise exception 'CURENJE: admin A je blokiran iako je odbijeno'; end if;

  -- neispravni argumenti
  foreach s in array array[
    'select public.admin_set_disabled(null, true)',
    format('select public.admin_set_disabled(%L, null)', c)
  ] loop
    begin
      execute s;
      raise exception 'CURENJE: neispravan poziv je prošao: %', s;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  begin
    perform public.admin_set_disabled(gen_random_uuid(), true);
    raise exception 'CURENJE: blokiran nepostojeći nalog';
  exception when no_data_found then null;
  end;

  -- nalog bez profila (D): profil se pravi iz auth.users, pa blokada ima gde da se upiše
  perform public.admin_set_disabled(d, true);
  select * into r from public.admin_list_users() l where l.id = d;
  if r.role is distinct from 'lawyer' or r.disabled_at is null then
    raise exception 'TEST: blokada naloga bez profila nije napravila blokiran profil sa ulogom lawyer: %', to_jsonb(r);
  end if;
  if current_setting('test.d_email') is distinct from r.email then
    raise exception 'TEST: profil naloga D nema ispravan email';
  end if;
  perform public.admin_set_disabled(d, false);

  -- promena uloge i dalje radi (kao pre 2.5.6)
  perform public.admin_set_role(c, 'admin');
  perform public.admin_set_role(c, 'lawyer');
end $$;
reset role;

-- 5. service_role/vlasnik baze: poslednji AKTIVAN admin je zaštićen i od blokade (ne samo od skidanja uloge).
set local role service_role;

do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  a2 uuid := current_setting('test.a2')::uuid;
begin
  begin
    update public.profiles set disabled_at = now() where id in (a, a2);
    raise exception 'CURENJE: oba admina su blokirana jednom naredbom';
  exception when check_violation then null;
  end;
  update public.profiles set disabled_at = now() where id = a2;   -- A ostaje aktivan: dozvoljeno
  update public.profiles set disabled_at = null  where id = a2;   -- vraćanje ne sme da smeta
  if exists (select 1 from public.profiles where id in (a, a2) and disabled_at is not null) then
    raise exception 'TEST: posle vraćanja neko od admina je ostao blokiran';
  end if;
end $$;
reset role;

-- 6. A blokira A2: blokiran admin gubi sva admin prava, a A je jedini aktivan admin (iako je A2 i dalje "admin" po ulozi).
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a  uuid := current_setting('test.a')::uuid;
  a2 uuid := current_setting('test.a2')::uuid;
  b  uuid := current_setting('test.b')::uuid;
  n  int;
begin
  perform public.admin_set_disabled(a2, true);

  -- A2 sa važećim tokenom (aal2) više nije admin
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', a2::text, true);
  if private.is_admin() then raise exception 'CURENJE: blokiran admin je i dalje admin (private.is_admin())'; end if;
  begin
    perform count(*) from public.admin_list_users();
    raise exception 'CURENJE: blokiran admin čita admin_list_users';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_set_disabled(a2, false);
    raise exception 'CURENJE: blokiran admin je sam sebe odblokirao';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_set_role(b, 'admin');
    raise exception 'CURENJE: blokiran admin menja uloge';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from public.audit_log where user_id is distinct from a2;
  if n > 0 then raise exception 'CURENJE: blokiran admin vidi % tuđih audit zapisa', n; end if;

  -- A je jedini aktivan admin: ne može da skine sopstvenu ulogu, iako A2 po ulozi ostaje admin
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  begin
    perform public.admin_set_role(a, 'lawyer');
    raise exception 'CURENJE: skinuta uloga jedinom aktivnom adminu';
  exception when check_violation then null;
  end;

  -- ali može da skine ulogu blokiranom A2
  perform public.admin_set_role(a2, 'lawyer');
  perform public.admin_set_disabled(a2, false);
end $$;
reset role;

-- 7. A je sada jedini admin: ni service_role ga ne sme blokirati.
set local role service_role;

do $$
declare
  a uuid := current_setting('test.a')::uuid;
begin
  begin
    update public.profiles set disabled_at = now() where id = a;
    raise exception 'CURENJE: service_role je blokirao poslednjeg aktivnog admina';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- 8. anon (javni ključ iz JS bundle-a): ništa ne sme da prođe.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
begin
  begin
    perform public.admin_set_disabled(current_setting('test.b')::uuid, true);
    raise exception 'CURENJE: anon je pozvao admin_set_disabled';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.profiles where disabled_at is not null;
    raise exception 'CURENJE: anon čita profiles.disabled_at';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin raise notice 'FAZA 2.5.6: svi testovi blokade prošli'; end $$;
select 'FAZA 2.5.6: svi testovi blokade prošli' as rezultat;

rollback;
