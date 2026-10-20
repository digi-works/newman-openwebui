-- M5 AI gateway: capability registry, run records, tool-call log, pending actions (confirm in the Digi UI), customer secrets.
-- Every table that belongs to a tenant carries tenant_id with forced row-level security and tenant-scoped foreign keys, as before.

-- ---------------------------------------------------------------- capabilities (the catalogue is global; enablement is per tenant)
create table capabilities (
  id              text primary key,
  kind            text not null check (kind in ('tool', 'worker')),
  name            text not null,
  description     text not null default '',
  -- read: looks things up. write: changes data for the signed-in person (needs a confirm click). high_impact: needs another person's approval.
  risk            text not null default 'read' check (risk in ('read', 'write', 'high_impact')),
  -- a tool cannot exist without the permission that guards it
  permission      text,
  -- the Open WebUI tool module that carries this tool (tools are grouped per module so a turn can send only what a person may use)
  owui_tool_id    text,
  default_enabled boolean not null default true,
  -- allow: run it. ask: another person must approve first (job engine). deny: never run it.
  default_policy  text not null default 'allow' check (default_policy in ('allow', 'ask', 'deny')),
  created_at      timestamptz not null default now(),
  constraint tool_needs_permission check (kind <> 'tool' or (permission is not null and owui_tool_id is not null))
);
revoke all on capabilities from digi_app;
grant select on capabilities to digi_app;

create table tenant_capabilities (
  tenant_id     uuid not null references tenants (id),
  capability_id text not null references capabilities (id),
  enabled       boolean not null default true,
  policy        text check (policy in ('allow', 'ask', 'deny')),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, capability_id)
);

insert into capabilities (id, kind, name, description, risk, permission, owui_tool_id) values
  ('rooms.list',          'tool', 'List rooms',            'Rooms, buildings, capacity and features.',                          'read',  'bookings.view_own',  'digi_rooms'),
  ('rooms.form',          'tool', 'Room request form',     'Shows the room request form in the chat (and supplies its building list).',                          'read',  'bookings.create',    'digi_rooms'),
  ('rooms.search',        'tool', 'Find available rooms',  'Rooms that are free for a time, size and needs.',                   'read',  'bookings.create',    'digi_rooms'),
  ('bookings.list',       'tool', 'List bookings',         'Bookings the person is allowed to see (their own, or all with view-all).', 'read', 'bookings.view_own', 'digi_bookings'),
  ('bookings.request',    'tool', 'Request a room',        'Prepares a room request. The person confirms it in the Digi UI.',    'write', 'bookings.create',    'digi_bookings'),
  ('bookings.cancel',     'tool', 'Cancel a booking',      'Prepares a cancellation. The person confirms it in the Digi UI.',    'write', 'bookings.delete',    'digi_bookings'),
  ('approvals.queue',     'tool', 'Approval queue',        'Requests waiting for a decision (read only; approving is not a tool).', 'read', 'bookings.approve', 'digi_approvals');

-- the finance workers stay defined and hidden (decision 5): disabled capabilities, not deleted
insert into capabilities (id, kind, name, description, risk, default_enabled) values
  ('worker:finance-operations--ap-worker', 'worker', 'AP Worker', 'Accounts payable (hidden).', 'write', false),
  ('worker:finance-operations-ar-worker',  'worker', 'AR Worker', 'Accounts receivable (hidden).', 'write', false),
  ('worker:finance-operations-cfo',        'worker', 'CFO Worker', 'Finance reporting (hidden).', 'read', false);

-- ---------------------------------------------------------------- one run record per AI response
create table ai_runs (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id),
  user_id          uuid not null,
  conversation_id  uuid,
  message_id       uuid,
  runtime          text not null,
  model            text not null,
  tools_available  text[] not null default '{}',
  status           text not null default 'running' check (status in ('running', 'done', 'stopped', 'error')),
  error            text,
  queue_ms         integer,
  duration_ms      integer,
  input_chars      integer,
  output_chars     integer,
  tokens_in        integer,
  tokens_out       integer,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index ai_runs_recent_idx on ai_runs (tenant_id, started_at desc);

-- no raw arguments or results are kept here: only which tool, who decided what, and how it went
create table tool_calls (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id),
  run_id      uuid,
  user_id     uuid not null,
  tool        text not null,
  decision    text not null check (decision in ('allow', 'ask', 'deny')),
  status      text not null check (status in ('ok', 'error', 'denied', 'awaiting_confirmation', 'awaiting_approval')),
  reason      text,
  duration_ms integer,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade,
  foreign key (tenant_id, run_id) references ai_runs (tenant_id, id) on delete cascade
);
create index tool_calls_run_idx on tool_calls (tenant_id, run_id);

-- ---------------------------------------------------------------- pending actions: a write the model prepared, which only the person's click can commit
create table pending_actions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants (id),
  user_id          uuid not null,
  conversation_id  uuid,
  message_id       uuid,
  run_id           uuid,
  tool             text not null,
  args             jsonb not null,
  summary          text not null,
  status           text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
  -- the same prepared request, retried by the model or the browser, is one action and commits once
  idempotency_key  text not null,
  result           jsonb,
  error            text,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz,
  unique (tenant_id, user_id, idempotency_key),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index pending_actions_conv_idx on pending_actions (tenant_id, conversation_id);

-- ---------------------------------------------------------------- customer secrets (LLM key): encrypted at rest, never returned to a browser
create table tenant_secrets (
  tenant_id   uuid not null references tenants (id),
  name        text not null,
  ciphertext  bytea not null,
  iv          bytea not null,
  tag         bytea not null,
  last4       text not null default '',
  meta        jsonb not null default '{}'::jsonb,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, name)
);

do $$
declare t text;
begin
  foreach t in array array['tenant_capabilities', 'ai_runs', 'tool_calls', 'pending_actions', 'tenant_secrets'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
    execute format('grant select, insert, update, delete on %I to digi_app', t);
  end loop;
end $$;
-- run and call records are history: the app can add and finish them but never delete them
revoke delete on tool_calls from digi_app;

-- ---------------------------------------------------------------- the execution handle now also names the run it belongs to
alter table execution_contexts add column run_id uuid;
drop function resolve_execution_context(text);
create function resolve_execution_context(p_hash text)
returns table (tenant_id uuid, user_id uuid, conversation_id uuid, run_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.tenant_id, e.user_id, e.conversation_id, e.run_id
    from execution_contexts e
   where e.id_hash = p_hash and e.expires_at > now()
$$;
revoke all on function resolve_execution_context(text) from public;
grant execute on function resolve_execution_context(text) to digi_app;
