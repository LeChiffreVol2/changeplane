-- Candidate authority storage. Apply with an administrative migration role only.
-- Acknowledged claims must survive every accepted failover/restore history (RPO 0).
-- Never expire or delete held lanes to recover availability. Fence old publishers first.
-- PostgreSQL 16+: operator needs CREATEROLE and CREATE on this database.
-- Precreated roles also require an explicitly reviewed SET grant on the owner.
begin;
-- Only the trusted migration operator gains SET on roles it creates. This does
-- not grant owner membership to runtime; existing memberships are left intact.
set local createrole_self_grant = 'set';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'changeplane_guard_journal_owner') then
    create role changeplane_guard_journal_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'changeplane_guard_journal_runtime') then
    create role changeplane_guard_journal_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname in ('changeplane_guard_journal_owner', 'changeplane_guard_journal_runtime')
    and (rolsuper or rolbypassrls or rolcanlogin or rolcreatedb or rolcreaterole or rolinherit))
    or exists (select 1 from pg_auth_members membership join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname in ('changeplane_guard_journal_owner', 'changeplane_guard_journal_runtime')) then
    raise exception 'Guard journal roles require separate unprivileged NOINHERIT non-login roles without memberships';
  end if;
  if not pg_has_role(current_user, 'changeplane_guard_journal_owner', 'SET') then
    raise exception 'Guard journal migration operator requires SET on the precreated owner role' using errcode = '42501';
  end if;
end $$;

create schema changeplane_guard authorization changeplane_guard_journal_owner;
-- Create objects with the actual owner, without inherited admin privileges or
-- a database-wide CREATE grant to the owner. COMMIT restores the caller role.
set local role changeplane_guard_journal_owner;
revoke all on schema changeplane_guard from public;
grant usage on schema changeplane_guard to changeplane_guard_journal_runtime;

create table changeplane_guard.enrollments (
  repository_id bigint primary key check (repository_id > 0),
  tenant_id bigint not null check (tenant_id > 0),
  installation_id bigint not null check (installation_id > 0),
  guard_app_id bigint not null check (guard_app_id > 0),
  epoch uuid not null,
  release_sha text not null check (release_sha ~ '^[a-f0-9]{40}$'),
  enabled boolean not null default false,
  max_lanes integer not null check (max_lanes between 1 and 1000),
  unique (tenant_id, repository_id, installation_id, guard_app_id, epoch, release_sha)
);

create table changeplane_guard.lanes (
  repository_id bigint not null,
  revision_fingerprint text not null check (revision_fingerprint ~ '^[a-f0-9]{64}$'),
  tenant_id bigint not null,
  installation_id bigint not null,
  guard_app_id bigint not null,
  epoch uuid not null,
  release_sha text not null,
  owner uuid not null,
  operation text not null check (operation in ('begin', 'complete', 'reconcile')),
  phase text not null check (phase in ('reserved', 'writing', 'poisoned')),
  claimed_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (repository_id, revision_fingerprint),
  foreign key (tenant_id, repository_id, installation_id, guard_app_id, epoch, release_sha)
    references changeplane_guard.enrollments (tenant_id, repository_id, installation_id, guard_app_id, epoch, release_sha)
    on update restrict on delete restrict
);

alter table changeplane_guard.enrollments owner to changeplane_guard_journal_owner;
alter table changeplane_guard.lanes owner to changeplane_guard_journal_owner;
alter table changeplane_guard.enrollments enable row level security;
alter table changeplane_guard.enrollments force row level security;
alter table changeplane_guard.lanes enable row level security;
alter table changeplane_guard.lanes force row level security;
create policy enrollment_tenant on changeplane_guard.enrollments
  using (tenant_id = nullif((select current_setting('changeplane.guard_tenant_id', true)), '')::bigint)
  with check (tenant_id = nullif((select current_setting('changeplane.guard_tenant_id', true)), '')::bigint);
create policy lane_tenant on changeplane_guard.lanes
  using (tenant_id = nullif((select current_setting('changeplane.guard_tenant_id', true)), '')::bigint)
  with check (tenant_id = nullif((select current_setting('changeplane.guard_tenant_id', true)), '')::bigint);

-- The backend authenticates scope before calling this RPC. Tenant settings are
-- defense in depth, not authentication supplied by a browser or Actions input.
-- Every transition is one transaction. No transaction/connection lock spans HTTP.
create function changeplane_guard.transition(
  p_tenant bigint, p_repository bigint, p_installation bigint, p_app bigint,
  p_epoch uuid, p_release text, p_revision text, p_operation text,
  p_owner uuid, p_action text
) returns text language plpgsql security definer
set search_path = pg_catalog, changeplane_guard
as $$
declare enrollment changeplane_guard.enrollments%rowtype;
declare affected integer;
begin
  if p_tenant is null or p_tenant <= 0 or p_repository is null or p_repository <= 0
    or p_installation is null or p_installation <= 0 or p_app is null or p_app <= 0
    or p_epoch is null or p_owner is null
    or p_release is null or p_release !~ '^[a-f0-9]{40}$'
    or p_revision is null or p_revision !~ '^[a-f0-9]{64}$'
    or p_operation is null or p_operation not in ('begin', 'complete', 'reconcile')
    or p_action is null or p_action not in ('claim', 'write', 'release_reserved', 'release_written', 'poison') then
    return 'invalid_scope';
  end if;
  perform set_config('changeplane.guard_tenant_id', p_tenant::text, true);
  -- A single enrollment per immutable repository ID also prevents principal or
  -- epoch changes from creating a second independent lane for the same Check.
  select * into enrollment from changeplane_guard.enrollments
    where repository_id = p_repository and tenant_id = p_tenant
      and installation_id = p_installation and guard_app_id = p_app
      and epoch = p_epoch and release_sha = p_release and enabled
    for update;
  if not found then return 'not_enrolled'; end if;

  if p_action = 'claim' then
    if exists (select 1 from changeplane_guard.lanes
      where repository_id = p_repository and revision_fingerprint = p_revision) then
      return 'busy';
    end if;
    -- Enrollment lock makes count + insert race safe, including different SHAs.
    if (select count(*) from changeplane_guard.lanes where repository_id = p_repository) >= enrollment.max_lanes then
      return 'capacity';
    end if;
    insert into changeplane_guard.lanes
      (tenant_id, repository_id, installation_id, guard_app_id, epoch, release_sha,
       revision_fingerprint, operation, owner, phase)
      values (p_tenant, p_repository, p_installation, p_app, p_epoch, p_release,
        p_revision, p_operation, p_owner, 'reserved');
    return 'claimed';
  end if;

  if p_action in ('release_reserved', 'release_written') then
    delete from changeplane_guard.lanes
      where tenant_id = p_tenant and repository_id = p_repository
        and installation_id = p_installation and guard_app_id = p_app
        and epoch = p_epoch and release_sha = p_release
        and revision_fingerprint = p_revision and operation = p_operation and owner = p_owner
        and phase = case when p_action = 'release_reserved' then 'reserved' else 'writing' end;
  else
    update changeplane_guard.lanes
      set phase = case when p_action = 'write' then 'writing' else 'poisoned' end,
        updated_at = clock_timestamp()
      where tenant_id = p_tenant and repository_id = p_repository
        and installation_id = p_installation and guard_app_id = p_app
        and epoch = p_epoch and release_sha = p_release
        and revision_fingerprint = p_revision and operation = p_operation and owner = p_owner
        and phase = case when p_action = 'write' then 'reserved' else 'writing' end;
  end if;
  get diagnostics affected = row_count;
  return case when affected = 1 then 'ok' else 'not_owner' end;
end $$;

alter function changeplane_guard.transition(bigint, bigint, bigint, bigint, uuid, text, text, text, uuid, text)
  owner to changeplane_guard_journal_owner;
revoke all on all tables in schema changeplane_guard from public, changeplane_guard_journal_runtime;
revoke all on all functions in schema changeplane_guard from public;
grant select on changeplane_guard.enrollments to changeplane_guard_journal_runtime;
grant execute on function changeplane_guard.transition(bigint, bigint, bigint, bigint, uuid, text, text, text, uuid, text)
  to changeplane_guard_journal_runtime;

comment on table changeplane_guard.lanes is
  'Durable publication reservations, never PASS evidence. No expiry, takeover, retention deletion, tokens, raw revisions, repository names, payloads, or cached responses. Administrative recovery requires fencing every old publisher and in-flight external write.';
commit;
