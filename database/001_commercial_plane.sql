begin;

create table if not exists customer_organizations (
  github_organization_id bigint primary key check (github_organization_id > 0),
  plan text not null check (plan in ('free', 'starter', 'team', 'scale', 'enterprise')),
  repository_limit integer not null check (repository_limit > 0),
  monthly_evaluation_limit integer not null check (monthly_evaluation_limit > 0),
  detailed_retention_days integer not null check (detailed_retention_days between 7 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists github_installations (
  github_installation_id bigint primary key check (github_installation_id > 0),
  github_organization_id bigint not null references customer_organizations(github_organization_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (github_organization_id, github_installation_id)
);

create table if not exists protected_repositories (
  github_repository_id bigint primary key check (github_repository_id > 0),
  github_organization_id bigint not null references customer_organizations(github_organization_id) on delete cascade,
  github_installation_id bigint not null references github_installations(github_installation_id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (github_organization_id, github_repository_id),
  unique (github_organization_id, github_installation_id, github_repository_id),
  foreign key (github_organization_id, github_installation_id)
    references github_installations(github_organization_id, github_installation_id) on delete cascade
);

create table if not exists evaluation_events (
  event_id uuid primary key,
  github_organization_id bigint not null references customer_organizations(github_organization_id) on delete cascade,
  github_installation_id bigint not null references github_installations(github_installation_id) on delete cascade,
  github_repository_id bigint not null references protected_repositories(github_repository_id) on delete cascade,
  revision_fingerprint char(64) not null check (revision_fingerprint ~ '^[a-f0-9]{64}$'),
  evaluation_generation text not null check (evaluation_generation ~ '^[1-9][0-9]{0,19}\.[1-9][0-9]{0,9}$'),
  assurance_level text not null check (assurance_level in ('strict_head', 'queue_certified')),
  state text not null check (state in ('evaluating', 'pass', 'action_required', 'error', 'usage_action_required')),
  reason text not null check (reason ~ '^[a-z][a-z0-9_]{0,63}$'),
  latency_ms integer not null check (latency_ms between 0 and 86400000),
  customer_confirmed_valuable boolean not null default false,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (github_organization_id, github_repository_id, revision_fingerprint, evaluation_generation, state),
  foreign key (github_organization_id, github_installation_id, github_repository_id)
    references protected_repositories(github_organization_id, github_installation_id, github_repository_id)
    on delete cascade
);

create table if not exists monthly_usage (
  github_organization_id bigint not null references customer_organizations(github_organization_id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  evaluations bigint not null check (evaluations >= 0),
  assured_pull_requests bigint not null check (assured_pull_requests >= 0),
  valuable_blocks bigint not null check (valuable_blocks >= 0),
  p95_latency_ms integer check (p95_latency_ms between 0 and 86400000),
  updated_at timestamptz not null default now(),
  primary key (github_organization_id, period)
);

create table if not exists organization_deletion_requests (
  request_id uuid primary key,
  github_organization_id bigint not null,
  requested_at timestamptz not null default now(),
  complete_by timestamptz not null check (complete_by <= requested_at + interval '30 days'),
  completed_at timestamptz,
  check (completed_at is null or completed_at >= requested_at)
);

create index if not exists evaluation_events_org_time_idx
  on evaluation_events (github_organization_id, occurred_at desc);
create index if not exists evaluation_events_repo_time_idx
  on evaluation_events (github_organization_id, github_repository_id, occurred_at desc);
create unique index if not exists evaluation_events_one_terminal_generation_idx
  on evaluation_events (github_organization_id, github_repository_id, revision_fingerprint, evaluation_generation)
  where state <> 'evaluating';

alter table customer_organizations enable row level security;
alter table github_installations enable row level security;
alter table protected_repositories enable row level security;
alter table evaluation_events enable row level security;
alter table monthly_usage enable row level security;
alter table organization_deletion_requests enable row level security;
alter table customer_organizations force row level security;
alter table github_installations force row level security;
alter table protected_repositories force row level security;
alter table evaluation_events force row level security;
alter table monthly_usage force row level security;
alter table organization_deletion_requests force row level security;

create policy customer_organizations_tenant on customer_organizations
  using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint)
  with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy github_installations_tenant on github_installations
  using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint)
  with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy protected_repositories_tenant on protected_repositories
  using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint)
  with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy evaluation_events_tenant on evaluation_events
  for select using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy evaluation_events_append_only on evaluation_events
  for insert with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy monthly_usage_tenant on monthly_usage
  using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint)
  with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);
create policy organization_deletion_requests_tenant on organization_deletion_requests
  using (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint)
  with check (github_organization_id = nullif(current_setting('changeplane.organization_id', true), '')::bigint);

comment on table evaluation_events is
  'Pseudonymous assurance telemetry only. Never store repository names, source, diffs, prompts, patches, provider responses, credentials, or customer business data.';

commit;
