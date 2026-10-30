-- Forgot password (QA DEF-30): a person asks for a link on /forgot-password and Digi emails it. Only a hash of the link's token is stored,
-- like sessions, so a database leak does not hand out working links. A link works once, for 30 minutes; a newer one replaces it.
create table password_resets (
  token_hash text primary key,
  tenant_id  uuid not null references tenants (id),
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index password_resets_user_idx on password_resets (user_id);
alter table password_resets enable row level security;
alter table password_resets force row level security;
create policy tenant_isolation on password_resets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on password_resets to digi_app;
