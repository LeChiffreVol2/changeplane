-- Candidate finite pilot accounting, in the dedicated COMMERCIAL database.
-- This is separate from telemetry and from the Guard authority journal.
-- Apply once with an administrative migration role. Runtime cannot enroll,
-- change contracts, refund, delete, or prune accepted evaluations.
-- PostgreSQL 16+: operator needs CREATEROLE and CREATE on this database.
-- Precreated roles also require an explicitly reviewed SET grant on the owner.
begin;
-- Only the trusted migration operator gains SET on roles it creates. This does
-- not grant owner membership to runtime; existing memberships are left intact.
set local createrole_self_grant = 'set';

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'changeplane_commercial_owner') then
    create role changeplane_commercial_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'changeplane_commercial_runtime') then
    create role changeplane_commercial_runtime nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists (select 1 from pg_roles where rolname in ('changeplane_commercial_owner', 'changeplane_commercial_runtime')
    and (rolsuper or rolbypassrls or rolcanlogin or rolcreatedb or rolcreaterole or rolinherit))
    or exists (select 1 from pg_auth_members membership join pg_roles member_role on member_role.oid = membership.member
      where member_role.rolname in ('changeplane_commercial_owner', 'changeplane_commercial_runtime')) then
    raise exception 'Pilot admission roles require separate unprivileged NOINHERIT non-login roles without memberships';
  end if;
  if not pg_has_role(current_user, 'changeplane_commercial_owner', 'SET') then
    raise exception 'Pilot admission migration operator requires SET on the precreated owner role' using errcode = '42501';
  end if;
end $$;

create schema changeplane_commercial authorization changeplane_commercial_owner;
-- Create objects with the actual owner, without inherited admin privileges or
-- a database-wide CREATE grant to the owner. COMMIT restores the caller role.
set local role changeplane_commercial_owner;
revoke all on schema changeplane_commercial from public;
grant usage on schema changeplane_commercial to changeplane_commercial_runtime;

create table changeplane_commercial.contracts (
  tenant_id bigint primary key check (tenant_id > 0),
  contract_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  active boolean not null default false,
  starts_at timestamptz not null check (isfinite(starts_at)),
  expires_at timestamptz not null check (isfinite(expires_at)),
  included_monthly integer not null check (included_monthly between 1 and 1000000),
  grace integer not null check (grace >= 0 and grace <= greatest(10, ceil(included_monthly::numeric * 0.01))),
  max_repositories integer not null check (max_repositories between 1 and 50),
  check (expires_at > starts_at and expires_at <= starts_at + interval '30 days')
);

create table changeplane_commercial.enrollments (
  repository_id bigint primary key check (repository_id > 0),
  tenant_id bigint not null references changeplane_commercial.contracts(tenant_id) on delete restrict,
  installation_id bigint not null check (installation_id > 0),
  guard_app_id bigint not null check (guard_app_id > 0),
  enabled boolean not null default false,
  unique (tenant_id, repository_id, installation_id, guard_app_id)
);

create table changeplane_commercial.monthly_usage (
  tenant_id bigint not null references changeplane_commercial.contracts(tenant_id) on delete restrict,
  period date not null check (extract(day from period) = 1),
  evaluations integer not null check (evaluations between 0 and 1010000),
  primary key (tenant_id, period)
);

create table changeplane_commercial.admission_receipts (
  tenant_id bigint not null,
  repository_id bigint not null,
  installation_id bigint not null,
  guard_app_id bigint not null,
  revision_fingerprint text not null check (revision_fingerprint ~ '^[a-f0-9]{64}$'),
  evaluation_generation text not null check (evaluation_generation ~ '^[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$'),
  workflow_started_at timestamptz not null check (isfinite(workflow_started_at)),
  capability text not null check (capability = 'verify'),
  target_type text not null check (target_type = 'pull_request'),
  contract_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  contract_starts_at timestamptz not null,
  contract_expires_at timestamptz not null,
  included_monthly integer not null check (included_monthly between 1 and 1000000),
  grace integer not null check (grace >= 0 and grace <= greatest(10, ceil(included_monthly::numeric * 0.01))),
  max_repositories integer not null check (max_repositories between 1 and 50),
  period date not null,
  evaluations integer not null check (evaluations > 0 and evaluations <= included_monthly + grace),
  admitted_at timestamptz not null check (isfinite(admitted_at)),
  primary key (tenant_id, repository_id, revision_fingerprint, evaluation_generation),
  -- A workflow attempt cannot be rebound to another PR/head or tenant and charged again.
  unique (repository_id, evaluation_generation),
  foreign key (tenant_id, repository_id, installation_id, guard_app_id)
    references changeplane_commercial.enrollments(tenant_id, repository_id, installation_id, guard_app_id)
    on update restrict on delete restrict,
  foreign key (tenant_id, period) references changeplane_commercial.monthly_usage(tenant_id, period)
    on update restrict on delete restrict,
  check (period = date_trunc('month', admitted_at at time zone 'UTC')::date),
  check (admitted_at >= contract_starts_at and admitted_at < contract_expires_at),
  check (workflow_started_at >= contract_starts_at and workflow_started_at < contract_expires_at and workflow_started_at <= admitted_at),
  check (contract_expires_at <= contract_starts_at + interval '30 days')
);

alter table changeplane_commercial.contracts owner to changeplane_commercial_owner;
alter table changeplane_commercial.enrollments owner to changeplane_commercial_owner;
alter table changeplane_commercial.monthly_usage owner to changeplane_commercial_owner;
alter table changeplane_commercial.admission_receipts owner to changeplane_commercial_owner;
alter table changeplane_commercial.contracts enable row level security;
alter table changeplane_commercial.contracts force row level security;
alter table changeplane_commercial.enrollments enable row level security;
alter table changeplane_commercial.enrollments force row level security;
alter table changeplane_commercial.monthly_usage enable row level security;
alter table changeplane_commercial.monthly_usage force row level security;
alter table changeplane_commercial.admission_receipts enable row level security;
alter table changeplane_commercial.admission_receipts force row level security;
create policy contract_tenant on changeplane_commercial.contracts
  using (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint)
  with check (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint);
create policy enrollment_tenant on changeplane_commercial.enrollments
  using (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint)
  with check (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint);
create policy usage_tenant on changeplane_commercial.monthly_usage
  using (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint)
  with check (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint);
create policy receipt_tenant on changeplane_commercial.admission_receipts
  using (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint)
  with check (tenant_id = nullif(current_setting('changeplane.commercial_tenant_id', true), '')::bigint);

create function changeplane_commercial.receipt_result(receipt changeplane_commercial.admission_receipts, duplicate boolean)
returns jsonb language sql immutable set search_path = pg_catalog, changeplane_commercial as $$
  select jsonb_build_object('admitted', true, 'duplicate', duplicate,
    'reason', case when duplicate then 'already_admitted' else 'admitted' end,
    'period', to_char(receipt.period, 'YYYY-MM'), 'evaluations', receipt.evaluations,
    'included', receipt.included_monthly,
    'graceRemaining', greatest(0, receipt.grace - greatest(0, receipt.evaluations - receipt.included_monthly)),
    'admittedAt', to_char(receipt.admitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;

-- Both methods authenticate exact enrollment and immutable receipt binding.
-- Existing accepted attempts survive expiry, disabled enrollment, and exhaustion.
create function changeplane_commercial.evaluation(
  p_tenant bigint, p_repository bigint, p_installation bigint, p_app bigint,
  p_revision text, p_generation text, p_started text, p_capability text, p_target text, p_action text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, changeplane_commercial as $$
declare contract changeplane_commercial.contracts%rowtype;
declare enrollment changeplane_commercial.enrollments%rowtype;
declare receipt changeplane_commercial.admission_receipts%rowtype;
declare accepted_at timestamptz;
declare accepted_period date;
declare workflow_started timestamptz;
declare used integer := 0;
declare denial text;
begin
  if p_tenant is null or p_tenant <= 0 or p_repository is null or p_repository <= 0
    or p_installation is null or p_installation <= 0 or p_app is null or p_app <= 0
    or p_revision is null or p_revision !~ '^[a-f0-9]{64}$'
    or p_generation is null or p_generation !~ '^[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$'
    or p_started is null or p_started !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    or p_capability is null or p_capability !~ '^[a-z][a-z_]{0,31}$'
    or p_target is null or p_target !~ '^[a-z][a-z_]{0,31}$'
    or p_action is null or p_action not in ('admit', 'read') then
    return jsonb_build_object('error', 'authority');
  end if;
  begin
    workflow_started := p_started::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('error', 'authority');
  end;
  if to_char(workflow_started at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> p_started then
    return jsonb_build_object('error', 'authority');
  end if;
  perform set_config('changeplane.commercial_tenant_id', p_tenant::text, true);
  -- This tenant-wide lock serializes all repositories and month-boundary claims.
  -- It also synchronizes administrative contract updates with admission.
  select * into contract from changeplane_commercial.contracts where tenant_id = p_tenant for update;
  select * into enrollment from changeplane_commercial.enrollments
    where tenant_id = p_tenant and repository_id = p_repository
      and installation_id = p_installation and guard_app_id = p_app;
  if not found then
    if p_action = 'read' then return null; end if;
    denial := 'not_enrolled';
  else
    select * into receipt from changeplane_commercial.admission_receipts
      where repository_id = p_repository and evaluation_generation = p_generation;
    if found then
      if receipt.tenant_id <> p_tenant or receipt.installation_id <> p_installation
        or receipt.guard_app_id <> p_app or receipt.revision_fingerprint <> p_revision
        or receipt.workflow_started_at <> workflow_started
        or receipt.capability <> p_capability or receipt.target_type <> p_target then
        return jsonb_build_object('error', 'authority');
      end if;
      return changeplane_commercial.receipt_result(receipt, true);
    end if;
    if p_action = 'read' then return null; end if;
  end if;
  -- Assign the time after lock acquisition; caller timestamps never affect billing.
  accepted_at := clock_timestamp();
  accepted_period := date_trunc('month', accepted_at at time zone 'UTC')::date;
  select evaluations into used from changeplane_commercial.monthly_usage
    where tenant_id = p_tenant and period = accepted_period;
  used := coalesce(used, 0);
  if denial is null then
    if p_capability <> 'verify' or p_target <> 'pull_request' then denial := 'unsupported_capability';
    elsif not contract.active then denial := 'contract_inactive';
    elsif accepted_at < contract.starts_at then denial := 'contract_not_started';
    elsif accepted_at >= contract.expires_at then denial := 'contract_expired';
    elsif workflow_started < contract.starts_at or workflow_started >= contract.expires_at or workflow_started > accepted_at then
      denial := 'workflow_outside_contract';
    elsif not enrollment.enabled then denial := 'not_enrolled';
    elsif (select count(*) from changeplane_commercial.enrollments where tenant_id = p_tenant and enabled) > contract.max_repositories then
      denial := 'repository_limit';
    elsif used >= contract.included_monthly + contract.grace then denial := 'quota_exhausted';
    end if;
  end if;
  if denial is not null then
    return jsonb_build_object('admitted', false, 'duplicate', false, 'reason', denial,
      'period', to_char(accepted_period, 'YYYY-MM'), 'evaluations', used,
      'included', coalesce(contract.included_monthly, 0),
      'graceRemaining', greatest(0, coalesce(contract.grace, 0) - greatest(0, used - coalesce(contract.included_monthly, 0))),
      'admittedAt', null);
  end if;

  insert into changeplane_commercial.monthly_usage(tenant_id, period, evaluations)
    values(p_tenant, accepted_period, 1)
    on conflict (tenant_id, period) do update set evaluations = changeplane_commercial.monthly_usage.evaluations + 1
    returning evaluations into used;
  insert into changeplane_commercial.admission_receipts
    (tenant_id, repository_id, installation_id, guard_app_id, revision_fingerprint, evaluation_generation, workflow_started_at,
     capability, target_type, contract_id, contract_version, contract_starts_at, contract_expires_at,
     included_monthly, grace, max_repositories, period, evaluations, admitted_at)
    values (p_tenant, p_repository, p_installation, p_app, p_revision, p_generation, workflow_started, p_capability, p_target,
      contract.contract_id, contract.contract_version, contract.starts_at, contract.expires_at,
      contract.included_monthly, contract.grace, contract.max_repositories, accepted_period, used, accepted_at)
    returning * into receipt;
  return changeplane_commercial.receipt_result(receipt, false);
end $$;

create function changeplane_commercial.read_usage(p_tenant bigint, p_period text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, changeplane_commercial as $$
declare used integer;
begin
  if p_tenant is null or p_tenant <= 0 or p_period is null or p_period !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('error', 'authority');
  end if;
  perform set_config('changeplane.commercial_tenant_id', p_tenant::text, true);
  select evaluations into used from changeplane_commercial.monthly_usage
    where tenant_id = p_tenant and period = (p_period || '-01')::date;
  return jsonb_build_object('tenantId', p_tenant, 'period', p_period, 'evaluations', coalesce(used, 0));
end $$;

alter function changeplane_commercial.receipt_result(changeplane_commercial.admission_receipts, boolean) owner to changeplane_commercial_owner;
alter function changeplane_commercial.evaluation(bigint, bigint, bigint, bigint, text, text, text, text, text, text) owner to changeplane_commercial_owner;
alter function changeplane_commercial.read_usage(bigint, text) owner to changeplane_commercial_owner;
revoke all on all tables in schema changeplane_commercial from public, changeplane_commercial_runtime;
revoke all on all functions in schema changeplane_commercial from public, changeplane_commercial_runtime;
grant execute on function changeplane_commercial.evaluation(bigint, bigint, bigint, bigint, text, text, text, text, text, text) to changeplane_commercial_runtime;
grant execute on function changeplane_commercial.read_usage(bigint, text) to changeplane_commercial_runtime;

comment on table changeplane_commercial.admission_receipts is
  'Immutable accepted-evaluation accounting only, never PASS evidence. No raw SHAs, repository names, code, prompts, tokens, or outcomes. Retain at most 90 days from admission; operator pruning requires closed contract/enrollment and proven rejection of old-generation replay. Runtime has no pruning, refund or delete authority.';
comment on table changeplane_commercial.monthly_usage is
  'Authoritative admission counts independent of telemetry and receipt retention. Retain 13 months; runtime increments only with atomic accepted receipt and cannot decrement/delete. No uncertain-begin refund.';
commit;
