-- M4 booking split: rooms, buildings, events and bookings move into Digi's database (from the Supabase pilot store).
-- A booking is requested by one person and decided by another. The database itself refuses to hold a room twice: pending and
-- approved bookings of the same room cannot overlap in time (exclusion constraint). Every tenant-owned table has tenant_id,
-- tenant-scoped foreign keys and row-level security, like the rest of Digi.

create extension if not exists btree_gist;

-- the university's time zone, used to turn "10:00 on 28 Oct" into a moment in time
update tenants set configuration = configuration || '{"timezone": "America/Chicago"}'::jsonb where not (configuration ? 'timezone');
alter table tenants alter column configuration set default
  '{"booking_pending_expiry_days": 7, "conversation_retention_days": 30, "timezone": "America/Chicago"}'::jsonb;

create table buildings (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id),
  legacy_id    text,
  name         text not null,
  abbreviation text not null default '',
  unique (tenant_id, id),
  unique (tenant_id, name)
);
create unique index buildings_legacy_idx on buildings (tenant_id, legacy_id) where legacy_id is not null;

create table rooms (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants (id),
  legacy_id    text,
  building_id  uuid not null,
  name         text not null,
  display_name text not null,
  type         text not null default 'room',
  capacity     integer not null check (capacity > 0),
  features     jsonb not null default '{}'::jsonb,
  reservable   boolean not null default true,
  searchable   boolean not null default true,
  access_notes text,
  unique (tenant_id, id),
  unique (tenant_id, display_name),
  foreign key (tenant_id, building_id) references buildings (tenant_id, id)
);
create unique index rooms_legacy_idx on rooms (tenant_id, legacy_id) where legacy_id is not null;

create table events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id),
  legacy_id   text,
  building_id uuid,
  name        text not null,
  type        text not null default 'event',
  capacity    integer,
  unique (tenant_id, id),
  foreign key (tenant_id, building_id) references buildings (tenant_id, id)
);
create unique index events_legacy_idx on events (tenant_id, legacy_id) where legacy_id is not null;

-- A scheduled event holds its room, so room search and booking treat it as busy.
create table event_occurrences (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants (id),
  legacy_id     text,
  event_id      uuid not null,
  room_id       uuid,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null check (ends_at > starts_at),
  status        text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  location_text text,
  foreign key (tenant_id, event_id) references events (tenant_id, id) on delete cascade,
  foreign key (tenant_id, room_id) references rooms (tenant_id, id)
);
create index event_occurrences_room_idx on event_occurrences (tenant_id, room_id, starts_at);
create unique index event_occurrences_legacy_idx on event_occurrences (tenant_id, legacy_id) where legacy_id is not null;

create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id),
  legacy_id           text,
  ref                 text not null,
  room_id             uuid not null,
  requester_user_id   uuid,
  requester_name      text not null,
  requester_email     text not null,
  purpose             text not null,
  description         text not null default '',
  attendees           integer not null check (attendees > 0),
  needs               jsonb not null default '[]'::jsonb,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null check (ends_at > starts_at),
  -- pending holds the slot until decided or expired; approved holds it; the rest release it
  status              text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'expired')),
  -- bumped on every change; a decision made on a stale copy is refused (two approvers at once)
  version             integer not null default 1,
  expires_at          timestamptz,
  decided_by_user_id  uuid,
  decided_at          timestamptz,
  decision_reason     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, ref),
  foreign key (tenant_id, room_id) references rooms (tenant_id, id),
  foreign key (tenant_id, requester_user_id) references users (tenant_id, id) on delete set null (requester_user_id),
  foreign key (tenant_id, decided_by_user_id) references users (tenant_id, id) on delete set null (decided_by_user_id),
  constraint bookings_no_double_booking exclude using gist (room_id with =, tstzrange(starts_at, ends_at) with &&) where (status in ('pending', 'approved'))
);
create index bookings_room_time_idx on bookings (tenant_id, room_id, starts_at);
create index bookings_requester_idx on bookings (tenant_id, requester_user_id, starts_at desc);
create index bookings_status_idx on bookings (tenant_id, status, starts_at);
create unique index bookings_legacy_idx on bookings (tenant_id, legacy_id) where legacy_id is not null;

-- Every change to a booking, who made it and why.
create table booking_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references tenants (id),
  booking_id    uuid not null,
  actor_user_id uuid,
  action        text not null,
  from_status   text,
  to_status     text,
  note          text,
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, booking_id) references bookings (tenant_id, id) on delete cascade,
  foreign key (tenant_id, actor_user_id) references users (tenant_id, id) on delete set null (actor_user_id)
);
create index booking_events_booking_idx on booking_events (booking_id, id);

-- In-app notifications (no email in Phase 1).
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id),
  user_id    uuid not null,
  kind       text not null,
  title      text not null,
  body       text not null default '',
  href       text not null default '/',
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade
);
create index notifications_user_idx on notifications (tenant_id, user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['buildings', 'rooms', 'events', 'event_occurrences', 'bookings', 'booking_events', 'notifications'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;

-- booking history is append-only for the app
revoke update, delete on booking_events from digi_app;

-- Editing and cancelling your own request now work, so those two permissions are enforced, and the built-in roles get them.
update permissions set enforced = true, description = 'Change the purpose or size of your own request while it is still waiting.' where code = 'bookings.update';
update permissions set enforced = true, label = 'Cancel bookings', description = 'Cancel your own request. People who can approve can also cancel an approved booking.' where code = 'bookings.delete';

do $$
declare t record;
begin
  for t in select id from tenants loop
    perform set_config('app.tenant_id', t.id::text, true);
    insert into role_permissions (tenant_id, role_id, permission_code)
    select r.tenant_id, r.id, v.p from roles r cross join (values ('bookings.update'), ('bookings.delete')) v(p)
    where r.tenant_id = t.id and r.is_system and not r.grants_all
    on conflict do nothing;
  end loop;
end $$;

create or replace function ensure_default_roles(p_tenant uuid) returns void language plpgsql as $$
declare r record; rid uuid;
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  for r in
    select * from (values
      ('Student', 'Uses Digi and requests rooms.',                             false, array['chat.use', 'bookings.view_own', 'bookings.create', 'bookings.update', 'bookings.delete']),
      ('Faculty', 'Uses Digi and requests rooms.',                             false, array['chat.use', 'bookings.view_own', 'bookings.create', 'bookings.update', 'bookings.delete']),
      ('Staff',   'Sees all bookings and approves or declines room requests.', false, array['chat.use', 'bookings.view_own', 'bookings.create', 'bookings.update', 'bookings.delete', 'bookings.view_all', 'bookings.approve']),
      ('Admin',   'Full access. Holds every permission and cannot be edited.', true,  array[]::text[])
    ) as v(name, descr, grants, perms)
  loop
    rid := null;
    insert into roles (tenant_id, name, description, is_system, grants_all)
    values (p_tenant, r.name, r.descr, true, r.grants)
    on conflict (tenant_id, lower(name)) do nothing
    returning id into rid;
    if rid is not null then
      insert into role_permissions (tenant_id, role_id, permission_code)
      select p_tenant, rid, unnest(r.perms);
    end if;
  end loop;
end $$;
