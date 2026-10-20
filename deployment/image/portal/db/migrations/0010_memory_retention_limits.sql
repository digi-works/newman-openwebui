-- M6: explicit memory, plus an index for the daily-limit checks.

-- What a person asked Digi to remember. Nothing is extracted automatically. Scoped by tenant and person; the person can view and delete it,
-- and an organisation can switch memory off (tenants.configuration.memory_enabled = false).
create table user_memories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id),
  user_id    uuid not null,
  content    text not null check (length(content) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index user_memories_user_idx on user_memories (tenant_id, user_id, created_at);
alter table user_memories enable row level security;
alter table user_memories force row level security;
create policy tenant_isolation on user_memories
  using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
grant select, insert, update, delete on user_memories to digi_app;

insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('memory.remember', 'tool', 'Remember this', 'Prepares a note Digi keeps for this person. They confirm it in the Digi UI.', 'write', 'chat.use', 'digi_memory');

create index ai_runs_user_day_idx on ai_runs (tenant_id, user_id, started_at desc);
