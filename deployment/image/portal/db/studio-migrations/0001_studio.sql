-- Studio P0: the platform realm. This database belongs to the platform, not to any customer: it holds operators, the specs Workers are built from,
-- releases, installations and the signing audit. It is NOT tenant data and has no tenant_id or row-level security; what protects it is that only
-- the platform instance can connect (a separate database, role and credentials) and that every mutation is audited.

-- ---------------------------------------------------------------- platform identity (ST.1): separate from customer users and roles
create table platform_operators (
  id               uuid primary key default gen_random_uuid(),
  email            text not null unique check (email = lower(email)),
  name             text not null,
  role             text not null check (role in ('operator', 'platform_admin')),
  password_hash    text not null,
  -- the TOTP secret, encrypted with STUDIO_SECRET_KEY (AES-256-GCM): iv || tag || ciphertext
  totp_secret_enc  bytea,
  mfa_enrolled     boolean not null default false,
  -- the last 30-second step accepted, so a code cannot be used twice
  last_totp_step   bigint,
  status           text not null default 'active' check (status in ('active', 'disabled')),
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now()
);

create table platform_sessions (
  token_hash   text primary key,
  operator_id  uuid not null references platform_operators (id) on delete cascade,
  -- a session is only useful for Studio once the second factor has been proved
  mfa_verified boolean not null default false,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index platform_sessions_operator_idx on platform_sessions (operator_id);

-- ---------------------------------------------------------------- audit: append only (the app role cannot update or delete)
create table studio_audit_events (
  id          bigint generated always as identity primary key,
  operator_id uuid,
  actor       text not null default 'operator',
  action      text not null,
  entity_type text,
  entity_id   text,
  result      text not null default 'success' check (result in ('success', 'denied', 'failed')),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index studio_audit_recent_idx on studio_audit_events (created_at desc);

-- ---------------------------------------------------------------- canonical specs (ST.2/ST.3). Runtime-neutral JSON, versioned, immutable once published.
-- One table per kind keeps the lock simple: a reference is (id, version) and resolves to exactly one row.
create table studio_tools (
  id text not null, version integer not null, spec jsonb not null, spec_hash text not null,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  created_by uuid, created_at timestamptz not null default now(),
  primary key (id, version)
);
create table studio_skills (
  id text not null, version integer not null, spec jsonb not null, spec_hash text not null,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  created_by uuid, created_at timestamptz not null default now(),
  primary key (id, version)
);
create table studio_policies (
  id text not null, version integer not null, spec jsonb not null, spec_hash text not null,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  created_by uuid, created_at timestamptz not null default now(),
  primary key (id, version)
);
create table studio_model_profiles (
  id text not null, version integer not null, spec jsonb not null, spec_hash text not null,
  status text not null default 'active' check (status in ('active', 'deprecated')),
  created_by uuid, created_at timestamptz not null default now(),
  primary key (id, version)
);

-- a spec row, once written, never changes: a new version is a new row
create function studio_immutable_spec() returns trigger language plpgsql as $$
begin
  if (old.spec is distinct from new.spec) or (old.spec_hash is distinct from new.spec_hash) or (old.id is distinct from new.id) or (old.version is distinct from new.version) then
    raise exception 'a spec version cannot be changed; create a new version';
  end if;
  return new;
end $$;
create trigger studio_tools_immutable before update on studio_tools for each row execute function studio_immutable_spec();
create trigger studio_skills_immutable before update on studio_skills for each row execute function studio_immutable_spec();
create trigger studio_policies_immutable before update on studio_policies for each row execute function studio_immutable_spec();
create trigger studio_model_profiles_immutable before update on studio_model_profiles for each row execute function studio_immutable_spec();

create table studio_workers (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name        text not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

create table studio_worker_versions (
  worker_id    text not null references studio_workers (id),
  version      integer not null,
  -- draft: being written. in_review: waiting for a human. approved: a human reviewed exactly this spec. published: frozen and in the catalogue. retired: no longer offered.
  status       text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'retired')),
  spec         jsonb not null,
  spec_hash    text not null,
  -- exact versions of every Skill, Policy, Tool and Model Profile this version resolved to at publish time
  lock         jsonb,
  source       text not null default 'manual' check (source in ('manual', 'generated')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  primary key (worker_id, version)
);

-- once published, the content of a Worker version is frozen; only its status may move on (published -> retired)
create function studio_immutable_worker_version() returns trigger language plpgsql as $$
begin
  if old.status in ('published', 'retired') then
    if (old.spec is distinct from new.spec) or (old.spec_hash is distinct from new.spec_hash) or (old.lock is distinct from new.lock)
       or (old.worker_id is distinct from new.worker_id) or (old.version is distinct from new.version) then
      raise exception 'a published Worker version cannot be changed';
    end if;
    if old.status = 'retired' and new.status <> 'retired' then
      raise exception 'a retired Worker version cannot come back';
    end if;
  end if;
  return new;
end $$;
create trigger studio_worker_versions_immutable before update on studio_worker_versions for each row execute function studio_immutable_worker_version();

-- ST.5: nothing published without a human review of exactly this spec
create table studio_reviews (
  id          bigint generated always as identity primary key,
  worker_id   text not null,
  version     integer not null,
  reviewer_id uuid not null,
  -- the hash of the spec the reviewer actually saw; editing afterwards makes the review stale
  spec_hash   text not null,
  checklist   jsonb not null,
  decision    text not null check (decision in ('approve', 'reject')),
  note        text not null default '',
  created_at  timestamptz not null default now(),
  foreign key (worker_id, version) references studio_worker_versions (worker_id, version)
);

-- ---------------------------------------------------------------- releases, installations, revocation (ST.6/ST.7)
create table studio_releases (
  seq               bigint generated always as identity unique,
  release_id        text primary key,
  channel           text not null default 'stable' check (channel in ('stable', 'preview')),
  status            text not null default 'signed' check (status in ('signed', 'revoked')),
  security_critical boolean not null default false,
  notes             text not null default '',
  digi_min_version  text not null default '0.1.0',
  manifest          jsonb not null,
  bundle            jsonb not null,
  digest            text not null,
  signature         jsonb not null,
  key_id            text not null,
  signed_at         timestamptz not null default now(),
  created_by        uuid
);

create table studio_enrollment_tokens (
  token_hash      text primary key,
  label           text not null,
  created_by      uuid,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  installation_id text
);

create table studio_installations (
  id                   text primary key,
  label                text not null,
  public_key           jsonb not null,
  status               text not null default 'active' check (status in ('active', 'revoked')),
  enrolled_at          timestamptz not null default now(),
  last_pull_at         timestamptz,
  digi_version         text,
  current_release      text,
  runtime_capabilities jsonb not null default '{}'::jsonb
);

-- a signed client assertion can be used once
create table studio_assertion_replays (jti text primary key, expires_at timestamptz not null);

create table studio_revocations (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('release', 'key', 'installation')),
  ref         text not null,
  reason      text not null default '',
  revoked_by  uuid,
  revoked_at  timestamptz not null default now(),
  unique (kind, ref)
);

revoke update, delete on studio_audit_events from studio_app;
revoke update, delete on studio_reviews from studio_app;
revoke delete on studio_tools, studio_skills, studio_policies, studio_model_profiles, studio_worker_versions, studio_releases from studio_app;
