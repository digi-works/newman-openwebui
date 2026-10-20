-- M3 conversations: chats and messages are owned by the person who had them, in Digi's database.
-- Every row carries tenant_id and user_id; every query is scoped by the signed-in user, and row-level security backs that up per tenant.
-- Foreign keys include tenant_id so a row can never point at another tenant's conversation or user.

create table conversations (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants (id),
  user_id        uuid not null,
  agent_id       text not null,
  title          text not null default 'New chat',
  -- a prompt chosen on another page (a starter, a card) that the chat sends once when it first opens
  pending_prompt text,
  status         text not null default 'active' check (status in ('active', 'archived')),
  message_count  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index conversations_user_recent_idx on conversations (tenant_id, user_id, updated_at desc);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id),
  conversation_id uuid not null,
  user_id         uuid not null,
  seq             bigint generated always as identity,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null default '',
  -- streaming: being written now; done: finished; stopped: the person stopped it or left; error: it failed
  status          text not null default 'done' check (status in ('streaming', 'done', 'stopped', 'error')),
  tool_label      text,
  embeds          jsonb not null default '[]'::jsonb,
  feedback        text check (feedback in ('up', 'down')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references conversations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index messages_conversation_idx on messages (conversation_id, seq);

create table user_favorites (
  tenant_id  uuid not null references tenants (id),
  user_id    uuid not null,
  agent_id   text not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, agent_id),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['conversations', 'messages', 'user_favorites'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;
