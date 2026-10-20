-- M1 foundation: tenants, users, sessions, identities, audit, execution contexts.
-- Every tenant-owned table carries tenant_id and has row-level security. The runtime role (digi_app) cannot bypass it.
-- The app sets the tenant per transaction: select set_config('app.tenant_id', '<uuid>', true).

create table tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name          text not null,
  status        text not null default 'active' check (status in ('active', 'suspended')),
  -- tenant settings; defaults documented in architecture v0.3 (pending hold 7 days, conversation retention 30 days)
  configuration jsonb not null default '{"booking_pending_expiry_days": 7, "conversation_retention_days": 30}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table tenant_hostnames (
  hostname  text primary key check (hostname = lower(hostname)),
  tenant_id uuid not null references tenants (id) on delete cascade
);

create table users (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants (id),
  email                text not null check (email = lower(email)),
  name                 text not null,
  -- M2 replaces this column with roles and permissions tables
  role                 text not null default 'Student' check (role in ('Student', 'Faculty', 'Staff', 'Admin')),
  password_hash        text not null,
  must_change_password boolean not null default true,
  status               text not null default 'active' check (status in ('active', 'disabled')),
  failed_attempts      integer not null default 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, email)
);

-- Only a hash of the session token is stored, so a database leak does not hand out live sessions.
create table sessions (
  token_hash   text primary key,
  tenant_id    uuid not null references tenants (id),
  user_id      uuid not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text
);
create index sessions_user_idx on sessions (user_id);
create index sessions_expiry_idx on sessions (expires_at);

-- For later single sign-on: an external identity maps onto a Digi user.
create table user_identities (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id),
  user_id          uuid not null references users (id) on delete cascade,
  provider         text not null,
  provider_subject text not null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, provider, provider_subject)
);

create table audit_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references tenants (id),
  user_id     uuid references users (id) on delete set null,
  action      text not null,
  entity_type text,
  entity_id   text,
  source      text not null default 'portal',
  result      text not null default 'success',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_events_tenant_time_idx on audit_events (tenant_id, created_at desc);

-- One row per AI turn. The id handed to Open WebUI as the chat id is the random handle; only its hash is stored.
create table execution_contexts (
  id_hash         text primary key,
  tenant_id       uuid not null references tenants (id),
  user_id         uuid not null references users (id) on delete cascade,
  conversation_id uuid,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);
create index execution_contexts_expiry_idx on execution_contexts (expires_at);

-- Row-level security on every tenant-owned table.
do $$
declare t text;
begin
  foreach t in array array['users', 'sessions', 'user_identities', 'audit_events', 'execution_contexts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;

-- Tenants are resolved by hostname before a tenant is known, so these two are readable but not writable by the app role.
revoke insert, update, delete on tenants, tenant_hostnames from digi_app;
-- Audit rows are append-only for the app.
revoke update, delete on audit_events from digi_app;
