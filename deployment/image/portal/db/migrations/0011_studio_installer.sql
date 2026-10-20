-- Studio P0, customer side: this stack's identity, the releases it has pulled and installed, the Workers they contain, capability permissions, Apps,
-- and which Worker handled a turn. These tables describe the STACK (not one tenant), like the capabilities catalogue; per-tenant switches are in
-- tenant_app_capabilities and in the ordinary role permissions.

-- permissions get a scope: a platform permission can never be granted from a customer's Permissions page
alter table permissions add column scope text not null default 'customer' check (scope = 'customer');

-- the stack's own cryptographic identity and update settings (one row)
create table stack_identity (
  singleton        boolean primary key default true check (singleton),
  installation_id  text,
  public_key       jsonb,
  -- iv || tag || ciphertext, encrypted with DIGI_SECRET_KEY; the private key never leaves this stack
  private_key_enc  bytea,
  release_url      text,
  channel          text not null default 'stable' check (channel in ('stable', 'preview')),
  update_mode      text not null default 'approval' check (update_mode in ('approval', 'auto', 'pin')),
  pinned_release   text,
  min_allowed_seq  bigint not null default 0,
  active_release   text,
  previous_release text,
  enrolled_at      timestamptz,
  last_check_at    timestamptz,
  last_check_error text
);
insert into stack_identity (singleton) values (true);

create table installed_releases (
  release_id        text primary key,
  seq               bigint not null,
  channel           text not null,
  security_critical boolean not null default false,
  manifest          jsonb not null,
  bundle            jsonb not null,
  -- pending_approval: verified, waiting for a customer Admin. active: the one running. superseded: replaced. rolled_back: undone by an Admin.
  -- rejected: failed verification or compatibility (never activated). revoked: the platform revoked it. failed: could not be compiled.
  status            text not null check (status in ('pending_approval', 'active', 'superseded', 'rolled_back', 'rejected', 'revoked', 'failed')),
  reason            text,
  pulled_at         timestamptz not null default now(),
  approved_by       uuid,
  approved_at       timestamptz,
  activated_at      timestamptz,
  -- a security-critical release can wait at most this long, whatever the customer's update setting
  grace_deadline    timestamptz
);

create table installed_workers (
  release_id        text not null references installed_releases (release_id) on delete cascade,
  worker_id         text not null,
  version           integer not null,
  name              text not null,
  description       text not null,
  spec              jsonb not null,
  -- the effective policy for each tool after the Worker's own list and every Policy have been applied (the stricter always wins)
  tool_policies     jsonb not null,
  compiled_model_id text,
  active            boolean not null default false,
  primary key (release_id, worker_id)
);
create index installed_workers_active_idx on installed_workers (worker_id) where active;

-- Apps: a surface a capability can be switched on or off for (Digi chat in the portal, an assistant on the Bookings page, ...)
create table apps (id text primary key check (id ~ '^[a-z0-9-]{2,30}$'), name text not null, description text not null default '');
insert into apps (id, name, description) values ('portal', 'Digi chat', 'The main Digi conversation in the portal.'), ('bookings', 'Bookings assistant', 'Digi on the Bookings page.');

create table tenant_app_capabilities (
  tenant_id     uuid not null references tenants (id),
  app_id        text not null references apps (id),
  capability_id text not null,
  enabled       boolean not null,
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, app_id, capability_id)
);
alter table tenant_app_capabilities enable row level security;
alter table tenant_app_capabilities force row level security;
create policy tenant_isolation on tenant_app_capabilities
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- which Worker (and which App) handled a turn, for the run record and so the gateway can apply that Worker's policy
alter table ai_runs add column worker_id text;
alter table ai_runs add column app text;
alter table execution_contexts add column worker_id text;
drop function resolve_execution_context(text);
create function resolve_execution_context(p_hash text)
returns table (tenant_id uuid, user_id uuid, conversation_id uuid, run_id uuid, worker_id text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.tenant_id, e.user_id, e.conversation_id, e.run_id, e.worker_id
    from execution_contexts e
   where e.id_hash = p_hash and e.expires_at > now()
$$;
revoke all on function resolve_execution_context(text) from public;
grant execute on function resolve_execution_context(text) to digi_app;

-- Installing a release has to add a permission to the catalogue (the catalogue is otherwise read-only for the app). This function does exactly
-- that and nothing else: one permission per installed capability, named capability.<worker>.use, in the "AI Capabilities" module.
create function register_capability_permission(p_worker text, p_label text, p_description text)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare code text := 'capability.' || p_worker || '.use';
begin
  if p_worker !~ '^[a-z0-9][a-z0-9-]{1,40}$' then raise exception 'invalid capability id'; end if;
  insert into permissions (code, module, action, label, description, sort, enforced, scope)
  values (code, 'AI Capabilities', 'use', left(p_label, 80), left(p_description, 240), 900, true, 'customer')
  on conflict (code) do update set label = excluded.label, description = excluded.description;
  return code;
end $$;
revoke all on function register_capability_permission(text, text, text) from public;
grant execute on function register_capability_permission(text, text, text) to digi_app;

-- the tool the P0 Room Booking Worker uses for the action that needs another person's approval
insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('bookings.override_conflict', 'tool', 'Override a conflicting request', 'Asks to take a room held by someone else''s waiting request. Another person must approve it first.', 'high_impact', 'bookings.create', 'digi_bookings')
on conflict (id) do nothing;

-- the signed revocation list last fetched from the platform (kept so the stack can still refuse revoked releases while the platform is unreachable)
create table stack_revocations (singleton boolean primary key default true check (singleton), list jsonb, fetched_at timestamptz);
insert into stack_revocations (singleton) values (true);

-- what happened to releases on this stack (pulled, rejected and why, activated, rolled back, revoked), without any customer data
create table stack_events (
  id         bigint generated always as identity primary key,
  kind       text not null,
  release_id text,
  detail     jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
revoke update, delete on stack_events from digi_app;

-- an installed Worker appears in the capabilities catalogue (kind 'worker') so it is listed and governed like every other capability
create function register_worker_capability(p_worker text, p_name text, p_description text, p_permission text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_worker !~ '^[a-z0-9][a-z0-9-]{1,40}$' or p_permission <> 'capability.' || p_worker || '.use' then raise exception 'invalid capability'; end if;
  insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id, default_enabled, default_policy)
  values ('worker:' || p_worker, 'worker', left(p_name, 80), left(p_description, 240), 'write', p_permission, null, true, 'allow')
  on conflict (id) do update set name = excluded.name, description = excluded.description, permission = excluded.permission, default_enabled = true;
end $$;
revoke all on function register_worker_capability(text, text, text, text) from public;
grant execute on function register_worker_capability(text, text, text, text) to digi_app;
