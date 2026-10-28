-- FAZA 1: test izolacije podataka (RLS + grantovi + kompozitni FK + zaključani RPC).
--
-- Pokreće se u Supabase SQL Editoru POSLE primene migracije 20261027120000_phase1_data_isolation.sql
-- i posle SVAKE kasnije promene baze (trajno pravilo 6 iz CLAUDE.md).
--
-- Test sam pravi dva privremena korisnika (A i B) sa dokumentima, pasusima, razgovorima i porukama,
-- pa ne zavisi od stvarnih naloga, a na kraju SVE poništava (rollback): u bazi ne ostaje ništa.
-- Predstavlja se kao A, B, anon i service_role (set local role + request.jwt.claims).
--
-- Uspeh: nema greške i ispisuje se "FAZA 1: svi RLS testovi prošli".
-- Curenje: skripta puca sa "CURENJE: ...". Ako puca sa "TEST: ...", problem je u samom testu.
begin;

-- 0. Podaci: A i B, svaki sa 1 dokumentom, 1 razgovorom i porukama.
--    A: 1 dokument, 2 pasusa, 1 razgovor, 2 poruke.  B: 1 dokument, 1 pasus, 1 razgovor, 1 poruka.
--    Okidač on_auth_user_created pravi i profile (ujedno proverava da registracija i dalje radi).
do $$
declare
  a      uuid := gen_random_uuid();
  b      uuid := gen_random_uuid();
  a_doc  uuid := gen_random_uuid();
  b_doc  uuid := gen_random_uuid();
  a_chat uuid := gen_random_uuid();
  b_chat uuid := gen_random_uuid();
  v_a    public.vector := array_fill(0.01::real, array[1024])::public.vector;
  v_b    public.vector := array_fill(0.02::real, array[1024])::public.vector;
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', a, 'authenticated', 'authenticated', 'rls-test-a-' || a || '@example.invalid', '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', b, 'authenticated', 'authenticated', 'rls-test-b-' || b || '@example.invalid', '{}', '{}', now(), now());

  insert into public.documents (id, title, user_id) values
    (a_doc, 'RLS-TEST A dokument', a),
    (b_doc, 'RLS-TEST B dokument', b);

  insert into public.document_chunks (document_id, user_id, content, embedding) values
    (a_doc, a, 'A pasus 1', v_a),
    (a_doc, a, 'A pasus 2', v_a),
    (b_doc, b, 'B pasus 1', v_b);

  insert into public.chats (id, title, user_id) values
    (a_chat, 'RLS-TEST A razgovor', a),
    (b_chat, 'RLS-TEST B razgovor', b);

  insert into public.messages (chat_id, user_id, role, content) values
    (a_chat, a, 'user', 'A pitanje'),
    (a_chat, a, 'assistant', 'A odgovor'),
    (b_chat, b, 'user', 'B pitanje');

  perform set_config('test.a', a::text, true);
  perform set_config('test.b', b::text, true);
  perform set_config('test.a_doc', a_doc::text, true);
  perform set_config('test.b_doc', b_doc::text, true);
  perform set_config('test.a_chat', a_chat::text, true);
  perform set_config('test.b_chat', b_chat::text, true);
end $$;

-- 1. Statička provera konfiguracije (kao vlasnik baze).
do $$
declare
  n int;
  r record;
begin
  -- RLS uključen na svim tabelama sa korisničkim podacima
  select count(*) into n from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('documents', 'document_chunks', 'chats', 'messages', 'profiles')
    and not relrowsecurity;
  if n > 0 then raise exception 'CURENJE: % tabela nema uključen RLS', n; end if;

  -- nijedna polisa ne važi za anon/public
  select count(*) into n from pg_policies
  where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles));
  if n > 0 then raise exception 'CURENJE: % polisa važi za anon/public', n; end if;

  -- authenticated nema INSERT/UPDATE polise (upisuje samo server)
  select count(*) into n from pg_policies
  where schemaname = 'public'
    and tablename in ('documents', 'document_chunks', 'chats', 'messages')
    and cmd in ('INSERT', 'UPDATE', 'ALL');
  if n > 0 then raise exception 'CURENJE: % INSERT/UPDATE/ALL polisa na tabelama sa korisničkim podacima', n; end if;

  -- anon nema nikakva prava ni na jednu relaciju u public
  for r in select c.oid, c.relname from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    if has_table_privilege('anon', r.oid, 'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'CURENJE: anon ima privilegiju na public.%', r.relname;
    end if;
  end loop;

  -- anon ne sme da izvršava nijednu našu funkciju u public (funkcije pgvector ekstenzije se izuzimaju)
  for r in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
             and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'CURENJE: anon sme da izvrši %', r.sig;
    end if;
  end loop;

  -- stari potpis match_document_chunks sa filter_user_id (3 argumenta) mora da ne postoji
  select count(*) into n from pg_proc
  where proname = 'match_document_chunks' and pronamespace = 'public'::regnamespace and pronargs <> 2;
  if n > 0 then raise exception 'CURENJE: postoji stari potpis match_document_chunks sa filter_user_id'; end if;

  select count(*) into n from pg_proc
  where proname = 'match_document_chunks' and pronamespace = 'public'::regnamespace;
  if n <> 1 then raise exception 'TEST: očekivana tačno jedna match_document_chunks, nađeno %', n; end if;
end $$;

-- 2. Predstavljamo se kao B.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.b'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
set local role authenticated;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  b      uuid := current_setting('test.b')::uuid;
  a_doc  uuid := current_setting('test.a_doc')::uuid;
  a_chat uuid := current_setting('test.a_chat')::uuid;
  n      int;
  m      int;
  s      text;
begin
  if auth.uid() is distinct from b then
    raise exception 'TEST: impersonacija ne radi (auth.uid() = %, očekivano %)', auth.uid(), b;
  end if;

  -- vidi TAČNO svoje redove: ni manje (RLS prestrog) ni više (curenje)
  select count(*) into n from public.documents;       if n <> 1 then raise exception 'CURENJE: B vidi % dokumenata, očekivano 1', n; end if;
  select count(*) into n from public.document_chunks; if n <> 1 then raise exception 'CURENJE: B vidi % pasusa, očekivano 1', n; end if;
  select count(*) into n from public.chats;           if n <> 1 then raise exception 'CURENJE: B vidi % razgovora, očekivano 1', n; end if;
  select count(*) into n from public.messages;        if n <> 1 then raise exception 'CURENJE: B vidi % poruka, očekivano 1', n; end if;
  select count(*) into n from public.profiles where id <> b;
  if n <> 0 then raise exception 'CURENJE: B vidi % tuđih profila', n; end if;

  -- razgovor po ID-u: tuđi izgleda isto kao nepostojeći (ruta vraća 404)
  select count(*) into n from public.chats where id = a_chat;
  if n <> 0 then raise exception 'CURENJE: B vidi A-ov razgovor po ID-u'; end if;
  select count(*) into n from public.messages where chat_id = a_chat;
  if n <> 0 then raise exception 'CURENJE: B vidi A-ove poruke po ID-u razgovora'; end if;

  -- vektorska pretraga vraća samo B-ove pasuse
  select count(*), count(*) filter (where document_title <> 'RLS-TEST B dokument') into n, m
  from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20);
  if m > 0 or n <> 1 then raise exception 'CURENJE: match_document_chunks za B vratio % redova (% tuđih), očekivano 1 (0 tuđih)', n, m; end if;
  -- document_id (audit question_asked) mora biti B-ov dokument, nikad A-ov
  select count(*) into m
  from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20)
  where document_id is distinct from current_setting('test.b_doc')::uuid;
  if m > 0 then raise exception 'CURENJE: match_document_chunks za B vratio % redova sa tuđim document_id', m; end if;

  -- tuđe redove ne može da obriše (RLS: 0 pogođenih redova, ne greška)
  delete from public.chats where id = a_chat;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: B je obrisao A-ov razgovor'; end if;
  delete from public.documents where id = a_doc;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: B je obrisao A-ov dokument'; end if;

  -- authenticated nema INSERT/UPDATE/DELETE gde ga ne sme biti (nema lažnih "assistant" poruka, nema zaobilaženja MAX_CHUNKS)
  foreach s in array array[
    format('insert into public.messages (chat_id, user_id, role, content) values (%L, %L, ''assistant'', ''lazna'')', current_setting('test.b_chat'), b),
    format('insert into public.document_chunks (document_id, user_id, content) values (%L, %L, ''lazan'')', current_setting('test.b_doc'), b),
    format('insert into public.documents (title, user_id) values (''x'', %L)', b),
    format('insert into public.chats (title, user_id) values (''x'', %L)', b),
    'update public.messages set content = ''izmenjeno''',
    'update public.documents set title = ''izmenjeno''',
    'update public.chats set title = ''izmenjeno''',
    'delete from public.messages',
    'delete from public.document_chunks',
    'update public.profiles set full_name = ''izmenjeno''',
    format('select public.get_daily_message_count(%L)', b),
    'select public.handle_new_user()'
  ] loop
    begin
      execute s;
      raise exception 'CURENJE: authenticated je uspeo da izvrši: %', s;
    exception when insufficient_privilege then
      null;  -- očekivano: 42501
    end;
  end loop;
end $$;
reset role;

-- 3. Predstavljamo se kao A.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.a'), 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
set local role authenticated;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  b_doc  uuid := current_setting('test.b_doc')::uuid;
  a_doc  uuid := current_setting('test.a_doc')::uuid;
  b_chat uuid := current_setting('test.b_chat')::uuid;
  a_chat uuid := current_setting('test.a_chat')::uuid;
  n      int;
  m      int;
begin
  if auth.uid() is distinct from a then
    raise exception 'TEST: impersonacija ne radi (auth.uid() = %, očekivano %)', auth.uid(), a;
  end if;

  select count(*) into n from public.documents;       if n <> 1 then raise exception 'CURENJE: A vidi % dokumenata, očekivano 1', n; end if;
  select count(*) into n from public.document_chunks; if n <> 2 then raise exception 'CURENJE: A vidi % pasusa, očekivano 2', n; end if;
  select count(*) into n from public.chats;           if n <> 1 then raise exception 'CURENJE: A vidi % razgovora, očekivano 1', n; end if;
  select count(*) into n from public.messages;        if n <> 2 then raise exception 'CURENJE: A vidi % poruka, očekivano 2', n; end if;
  select count(*) into n from public.profiles where id <> a;
  if n <> 0 then raise exception 'CURENJE: A vidi % tuđih profila', n; end if;

  select count(*), count(*) filter (where document_title <> 'RLS-TEST A dokument') into n, m
  from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20);
  if m > 0 or n <> 2 then raise exception 'CURENJE: match_document_chunks za A vratio % redova (% tuđih), očekivano 2 (0 tuđih)', n, m; end if;
  select count(*) into m
  from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20)
  where document_id is distinct from current_setting('test.a_doc')::uuid;
  if m > 0 then raise exception 'CURENJE: match_document_chunks za A vratio % redova sa tuđim document_id', m; end if;

  delete from public.chats where id = b_chat;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: A je obrisao B-ov razgovor'; end if;
  delete from public.documents where id = b_doc;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CURENJE: A je obrisao B-ov dokument'; end if;

  -- svoje sme da briše, i to jednim pozivom (kao ruta DELETE /api/chats/[chatId]):
  -- poruke i pasusi nestaju kaskadno, iako authenticated nema DELETE grant nad njima.
  delete from public.chats where id = a_chat;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CURENJE: A ne može da obriše sopstveni razgovor (obrisano % redova)', n; end if;
  delete from public.documents where id = a_doc;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CURENJE: A ne može da obriše sopstveni dokument (obrisano % redova)', n; end if;
end $$;
reset role;

-- 4. Kaskadno brisanje (kao vlasnik baze): A-ovo je nestalo, B-ovo je netaknuto.
do $$
declare
  n int;
begin
  select count(*) into n from public.messages where chat_id = current_setting('test.a_chat')::uuid;
  if n <> 0 then raise exception 'CURENJE: posle brisanja razgovora ostalo % poruka (nema ON DELETE CASCADE?)', n; end if;
  select count(*) into n from public.document_chunks where document_id = current_setting('test.a_doc')::uuid;
  if n <> 0 then raise exception 'CURENJE: posle brisanja dokumenta ostalo % pasusa (nema ON DELETE CASCADE?)', n; end if;

  select count(*) into n from public.messages where chat_id = current_setting('test.b_chat')::uuid;
  if n <> 1 then raise exception 'CURENJE: B-ove poruke posle A-ovog brisanja: %, očekivano 1', n; end if;
  select count(*) into n from public.document_chunks where document_id = current_setting('test.b_doc')::uuid;
  if n <> 1 then raise exception 'CURENJE: B-ovi pasusi posle A-ovog brisanja: %, očekivano 1', n; end if;
end $$;

-- 5. Predstavljamo se kao anon (javni ključ iz JS bundle-a): ništa ne sme da prođe.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
declare
  s text;
begin
  foreach s in array array[
    'select count(*) from public.documents',
    'select count(*) from public.document_chunks',
    'select count(*) from public.chats',
    'select count(*) from public.messages',
    'select count(*) from public.profiles',
    'select * from public.match_document_chunks(array_fill(0.01::real, array[1024])::public.vector, 20)',
    format('select public.get_daily_message_count(%L)', current_setting('test.b')),
    format('insert into public.messages (chat_id, user_id, role, content) values (%L, %L, ''user'', ''x'')', current_setting('test.b_chat'), current_setting('test.b'))
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

-- 6. Predstavljamo se kao service_role (server): upisuje, a kompozitni FK čuva vlasništvo.
set local role service_role;

do $$
declare
  a      uuid := current_setting('test.a')::uuid;
  b      uuid := current_setting('test.b')::uuid;
  b_doc  uuid := current_setting('test.b_doc')::uuid;
  b_chat uuid := current_setting('test.b_chat')::uuid;
  n      int;
begin
  -- pozitivna kontrola: ispravan upis prolazi (inače negativni testovi ispod ne bi ništa dokazivali)
  insert into public.document_chunks (document_id, user_id, content, embedding)
  values (b_doc, b, 'B pasus 2', array_fill(0.02::real, array[1024])::public.vector);
  insert into public.messages (chat_id, user_id, role, content)
  values (b_chat, b, 'assistant', 'B odgovor');

  -- pasus/poruka pod tuđim vlasnikom mora da padne na kompozitnom FK (23503)
  begin
    insert into public.document_chunks (document_id, user_id, content) values (b_doc, a, 'podmetnut pasus');
    raise exception 'CURENJE: upisan pasus u B-ov dokument pod A-ovim user_id';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.messages (chat_id, user_id, role, content) values (b_chat, a, 'assistant', 'podmetnuta poruka');
    raise exception 'CURENJE: upisana poruka u B-ov razgovor pod A-ovim user_id';
  exception when foreign_key_violation then null;
  end;

  -- roditelj je obavezan: NULL bi zaobišao MATCH SIMPLE kompozitni FK
  begin
    insert into public.document_chunks (document_id, user_id, content) values (null, b, 'siroce');
    raise exception 'CURENJE: upisan pasus bez dokumenta';
  exception when not_null_violation then null;
  end;

  begin
    insert into public.messages (chat_id, user_id, role, content) values (null, b, 'user', 'siroce');
    raise exception 'CURENJE: upisana poruka bez razgovora';
  exception when not_null_violation then null;
  end;

  -- brojač za rate limit radi samo serveru
  select public.get_daily_message_count(b) into n;
  if n is null then raise exception 'TEST: get_daily_message_count za service_role vratio NULL'; end if;
end $$;
reset role;

do $$ begin raise notice 'FAZA 1: svi RLS testovi prošli'; end $$;
select 'FAZA 1: svi RLS testovi prošli' as rezultat;

rollback;
