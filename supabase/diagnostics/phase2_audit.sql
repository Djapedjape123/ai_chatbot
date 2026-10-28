-- SAMO ČITANJE. Dijagnostika pred migraciju Faze 2 (usage ledger, audit log, uloge).
-- Pokreni u Supabase SQL Editoru i pošalji ceo JSON rezultat.
select jsonb_pretty(jsonb_build_object(
  'profiles_columns', (
    select jsonb_agg(jsonb_build_object('column', column_name, 'type', udt_name,
                                        'nullable', is_nullable, 'default', column_default)
                     order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'),
  'profiles_rls', (
    select jsonb_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity)
    from pg_class where oid = to_regclass('public.profiles')),
  'profiles_policies', (
    select jsonb_agg(jsonb_build_object('name', policyname, 'cmd', cmd, 'roles', roles,
                                        'using', qual, 'check', with_check))
    from pg_policies where schemaname = 'public' and tablename = 'profiles'),
  'profiles_constraints', (
    select jsonb_agg(jsonb_build_object('name', conname, 'def', pg_get_constraintdef(oid)))
    from pg_constraint where conrelid = to_regclass('public.profiles')),
  -- has_table_privilege, a ne information_schema: read-only uloga (MCP) ne vidi tuđe grantove u
  -- information_schema.role_table_grants, pa bi prazan rezultat lažno izgledao kao "nema granta".
  'profiles_grants', (
    select jsonb_object_agg(r.role, jsonb_build_object(
             'select', has_table_privilege(r.role, 'public.profiles', 'select'),
             'insert', has_table_privilege(r.role, 'public.profiles', 'insert'),
             'update', has_table_privilege(r.role, 'public.profiles', 'update'),
             'delete', has_table_privilege(r.role, 'public.profiles', 'delete')))
    from unnest(array['anon', 'authenticated', 'service_role']) as r(role)),
  -- Trigger koji pravi profil pri registraciji (auth.users -> public.profiles)
  'auth_users_triggers', (
    select jsonb_agg(jsonb_build_object('name', t.tgname, 'function', t.tgfoid::regprocedure::text,
                                        'definition', pg_get_functiondef(t.tgfoid)))
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal),
  'functions', (
    select jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text,
                                        'security_definer', p.prosecdef,
                                        'config', p.proconfig,
                                        'anon_can_execute', has_function_privilege('anon', p.oid, 'execute'),
                                        'authenticated_can_execute', has_function_privilege('authenticated', p.oid, 'execute')))
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
      and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')),
  -- Retencija audit loga: pg_cron (90 dana) ili Vercel Cron kao rezerva
  'extensions', (
    select jsonb_agg(jsonb_build_object('name', extname, 'version', extversion,
                                        'schema', extnamespace::regnamespace::text))
    from pg_extension where extname in ('pg_cron', 'vector', 'pgcrypto')),
  'pg_cron_available', exists (select 1 from pg_available_extensions where name = 'pg_cron'),
  'existing_phase2_tables', (
    select jsonb_agg(relname) from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
      and relname in ('usage_ledger', 'audit_log')),
  'counts', jsonb_build_object(
    'users', (select count(*) from auth.users),
    'profiles', (select count(*) from public.profiles),
    'users_without_profile', (select count(*) from auth.users u
                              where not exists (select 1 from public.profiles p where p.id = u.id)),
    'messages_last_24h', (select count(*) from public.messages where created_at > now() - interval '24 hours'),
    'documents', (select count(*) from public.documents))
)) as phase2_audit;
