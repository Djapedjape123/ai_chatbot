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
