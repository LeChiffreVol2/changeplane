-- Read-only catalog probe after the reviewed Guard migration. No tenant rows,
-- connection strings, credentials, or GitHub requests are read or written.
-- This does not qualify a provider, runtime login, TLS, or durable publication.
with
target_schema as (
  select * from pg_namespace where nspname = 'changeplane_guard'
),
target_tables as (
  select * from pg_class where relnamespace in (select oid from target_schema) and relkind = 'r'
),
target_functions as (
  select * from pg_proc where pronamespace in (select oid from target_schema)
),
api_roles as (
  select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
),
checks(name, passed) as (
  values
  ('supported_postgres', current_setting('server_version_num')::integer >= 160000),
  ('schema_owner', (select pg_get_userbyid(nspowner) = 'changeplane_guard_journal_owner' from target_schema)),
  ('isolated_roles', (
    select count(*) = 2 and bool_and(not (rolsuper or rolbypassrls or rolcanlogin or rolcreatedb or rolcreaterole or rolinherit))
      from pg_roles where rolname in ('changeplane_guard_journal_owner', 'changeplane_guard_journal_runtime')
  ) and not exists (
    select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
      where r.rolname in ('changeplane_guard_journal_owner', 'changeplane_guard_journal_runtime')
  )),
  ('table_ownership_and_rls', (
    select count(*) = 2 and bool_and(relname in ('enrollments', 'lanes')
      and pg_get_userbyid(relowner) = 'changeplane_guard_journal_owner' and relrowsecurity and relforcerowsecurity)
      from target_tables
  )),
  ('function_authority', (
    select count(*) = 1 and bool_and(oid = to_regprocedure('changeplane_guard.transition(bigint,bigint,bigint,bigint,uuid,text,text,text,uuid,text)')
      and prosecdef and pg_get_userbyid(proowner) = 'changeplane_guard_journal_owner'
      and proconfig = array['search_path=pg_catalog, changeplane_guard']) from target_functions
  )),
  ('runtime_schema_usage_only', (
    select has_schema_privilege('changeplane_guard_journal_runtime', oid, 'USAGE')
      and not has_schema_privilege('changeplane_guard_journal_runtime', oid, 'CREATE') from target_schema
  )),
  ('runtime_table_privileges', (
    select count(*) = 2 and bool_and(
      has_table_privilege('changeplane_guard_journal_runtime', oid, 'SELECT') = (relname = 'enrollments')
      and not has_table_privilege('changeplane_guard_journal_runtime', oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      from target_tables
  )),
  ('runtime_function_execution', (
    select count(*) = 1 and bool_and(has_function_privilege('changeplane_guard_journal_runtime', oid, 'EXECUTE')) from target_functions
  )),
  ('public_grants_absent', not exists (
    select 1 from target_schema s, lateral aclexplode(coalesce(s.nspacl, acldefault('n', s.nspowner))) a where a.grantee = 0
    union all
    select 1 from target_tables t, lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a where a.grantee = 0
    union all
    select 1 from target_functions f, lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0
  )),
  ('api_role_grants_absent', not exists (
    select 1 from api_roles r cross join target_schema s where has_schema_privilege(r.oid, s.oid, 'USAGE,CREATE')
    union all
    select 1 from api_roles r cross join target_tables t where has_table_privilege(r.oid, t.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    union all
    select 1 from api_roles r cross join target_functions f where has_function_privilege(r.oid, f.oid, 'EXECUTE')
  ))
)
select jsonb_build_object(
  'scope', 'guard_catalog_only',
  'postgresVersion', current_setting('server_version'),
  'apiRolesInspected', (select count(*) from api_roles),
  'catalogChecksPassed', bool_and(coalesce(passed, false)),
  'checks', jsonb_object_agg(name, coalesce(passed, false)),
  'runtimeLoginVerified', false,
  'providerDurabilityVerified', false
) as result from checks;
