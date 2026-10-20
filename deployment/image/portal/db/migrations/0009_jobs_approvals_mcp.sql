-- M5.7 / M5.8 / M5.9: service identities, the durable job engine with approvals, and the MCP proxy registry.

-- ---------------------------------------------------------------- permission to decide approvals (Admin holds every permission already)
insert into permissions (code, module, action, label, description, sort, enforced) values
  ('approvals.decide', 'Approvals', 'decide', 'Decide approvals', 'Approve or decline actions that wait for another person (never your own).', 60, true),
  ('mcp.manage',       'Tool connections', 'manage', 'Manage tool connections', 'Register tool servers, choose which of their tools are on, and set their permissions.', 70, true)
on conflict (code) do nothing;

-- the connected-tools lookup for the MCP proxy (it lists only what the person may use)
insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('mcp.list', 'tool', 'List connected tools', 'The tools from connected tool servers that this person may use.', 'read', 'chat.use', 'digi_mcp');

-- ---------------------------------------------------------------- service identities: named actors for automations, with explicit grants only
create table service_identities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id),
  name        text not null,
  permissions text[] not null default '{}',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- ---------------------------------------------------------------- jobs: a durable queue in Postgres
create table jobs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id),
  type             text not null,
  status           text not null default 'queued' check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled')),
  payload          jsonb not null default '{}'::jsonb,
  -- where the job got to; a retry or a resume after approval continues from here
  checkpoint       jsonb not null default '{}'::jsonb,
  result           jsonb,
  error            text,
  actor_user_id    uuid,
  actor_service_id uuid,
  attempts         integer not null default 0,
  max_attempts     integer not null default 3,
  run_after        timestamptz not null default now(),
  locked_by        text,
  locked_until     timestamptz,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, actor_user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_service_id) references service_identities (tenant_id, id) on delete cascade,
  constraint one_actor check (num_nonnulls(actor_user_id, actor_service_id) = 1)
);
create unique index jobs_idempotency_idx on jobs (tenant_id, idempotency_key) where idempotency_key is not null;
create index jobs_ready_idx on jobs (run_after) where status in ('queued', 'running');

create table approvals (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id),
  job_id        uuid not null,
  -- the person whose action this is (null for a service identity); they can never decide it
  requested_by  uuid,
  tool          text not null,
  summary       text not null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by    uuid,
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, job_id) references jobs (tenant_id, id) on delete cascade,
  foreign key (tenant_id, requested_by) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, decided_by) references users (tenant_id, id) on delete set null (decided_by)
);
create unique index approvals_one_pending_idx on approvals (tenant_id, job_id) where status = 'pending';

-- ---------------------------------------------------------------- MCP proxy registry: runtimes never reach a tool server directly
create table mcp_servers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id),
  name          text not null check (name ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
  url           text not null,
  -- the credential is a reference to a tenant secret, never the value
  secret_name   text,
  enabled       boolean not null default false,
  status        text not null default 'unknown' check (status in ('unknown', 'healthy', 'unreachable', 'error')),
  last_checked  timestamptz,
  last_error    text,
  -- a hash of every tool's name and input schema; a change means the server's tools changed
  schema_hash   text,
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table mcp_tools (
  tenant_id     uuid not null references tenants (id),
  server_id     uuid not null,
  name          text not null,
  description   text not null default '',
  input_schema  jsonb not null default '{}'::jsonb,
  schema_hash   text not null,
  -- a newly discovered tool is off, needs a permission, and asks for approval until an admin decides otherwise
  enabled       boolean not null default false,
  risk          text not null default 'write' check (risk in ('read', 'write', 'high_impact')),
  permission    text,
  policy        text not null default 'ask' check (policy in ('allow', 'ask', 'deny')),
  discovered_at timestamptz not null default now(),
  primary key (server_id, name),
  foreign key (tenant_id, server_id) references mcp_servers (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['service_identities', 'jobs', 'approvals', 'mcp_servers', 'mcp_tools'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
    execute format('grant select, insert, update, delete on %I to digi_app', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- the worker picks the next job across tenants, then works inside that tenant
-- jobs stops forcing RLS on its owner so this one function (and nothing else) can look across tenants; digi_app stays bound by the policy.
alter table jobs no force row level security;

create function claim_job(p_worker text, p_lease_secs integer, p_tenant_limit integer)
returns table (id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare j jobs%rowtype;
begin
  loop
    select * into j from jobs x
     where ((x.status = 'queued' and x.run_after <= now()) or (x.status = 'running' and x.locked_until < now()))
       and (select count(*) from jobs r where r.tenant_id = x.tenant_id and r.status = 'running' and r.locked_until >= now()) < p_tenant_limit
     order by x.run_after
     for update skip locked
     limit 1;
    if not found then return; end if;
    -- a job whose worker keeps dying is failed, not retried forever
    if j.status = 'running' and j.attempts >= j.max_attempts then
      update jobs set status = 'failed', error = 'The worker stopped repeatedly while running this job.', locked_by = null, locked_until = null, completed_at = now(), updated_at = now() where jobs.id = j.id;
      continue;
    end if;
    update jobs set status = 'running', attempts = j.attempts + 1, locked_by = p_worker, locked_until = now() + make_interval(secs => p_lease_secs), updated_at = now() where jobs.id = j.id;
    return query select j.id, j.tenant_id;
    return;
  end loop;
end $$;
revoke all on function claim_job(text, integer, integer) from public;
grant execute on function claim_job(text, integer, integer) to digi_app;
