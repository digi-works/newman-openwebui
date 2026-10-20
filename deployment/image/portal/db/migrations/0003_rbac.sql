-- M2 RBAC: permissions (a fixed catalog by module), roles per tenant, permissions on roles, roles on users.
-- Permission codes are defined by the product (this catalog); the customer's Admin decides which role gets which.
-- The Admin role "grants all": it holds every permission, including ones added later, and cannot be edited, so nobody can lock themselves out.

create table permissions (
  code        text primary key,
  module      text not null,
  action      text not null,
  label       text not null,
  description text not null default '',
  sort        integer not null default 0,
  -- false = the permission exists but no screen enforces it yet; shown as "coming" on the Permissions page
  enforced    boolean not null default true
);

insert into permissions (code, module, action, label, description, sort, enforced) values
  ('chat.use',            'Chat',                  'use',      'Use Digi chat',                'Open chats with Digi and use its tools.', 10, true),
  ('bookings.view_own',   'Bookings',              'view_own', 'View own bookings',            'See the room requests this person made.', 20, true),
  ('bookings.view_all',   'Bookings',              'view_all', 'View all bookings',            'See every room request and booking on campus.', 21, true),
  ('bookings.create',     'Bookings',              'create',   'Request a room',               'Add a room request, in the form or through Digi.', 22, true),
  ('bookings.update',     'Bookings',              'update',   'Edit bookings',                'Change a request before it is decided.', 23, false),
  ('bookings.delete',     'Bookings',              'delete',   'Delete or cancel bookings',    'Cancel or remove a request or booking.', 24, false),
  ('bookings.approve',    'Bookings',              'approve',  'Approve or decline requests',  'Decide room requests. Nobody can decide their own request.', 25, true),
  ('users.view',          'Users',                 'view',     'View users',                   'See the list of people who can sign in.', 30, true),
  ('users.create',        'Users',                 'create',   'Add users',                    'Create accounts and set temporary passwords.', 31, true),
  ('users.update',        'Users',                 'update',   'Change roles and reset passwords', 'Give a person a different role or reset their password. Only an Admin can grant or remove the Admin role.', 32, true),
  ('users.disable',       'Users',                 'disable',  'Disable or enable users',      'Stop or restore a person''s access.', 33, true),
  ('roles.manage',        'Roles and permissions', 'manage',   'Manage roles and permissions', 'Create roles and choose their permissions.', 40, true);

create table roles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants (id),
  name        text not null check (length(name) between 1 and 60),
  description text not null default '',
  is_system   boolean not null default false,   -- built-in: cannot be renamed or deleted
  grants_all  boolean not null default false,   -- holds every permission and cannot be edited (Admin)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index roles_tenant_name_idx on roles (tenant_id, lower(name));

create table role_permissions (
  tenant_id       uuid not null references tenants (id),
  role_id         uuid not null references roles (id) on delete cascade,
  permission_code text not null references permissions (code) on delete cascade,
  primary key (role_id, permission_code)
);

create table user_roles (
  tenant_id uuid not null references tenants (id),
  user_id   uuid not null references users (id) on delete cascade,
  role_id   uuid not null references roles (id) on delete restrict,   -- a role in use cannot be deleted
  primary key (user_id, role_id)
);
create index user_roles_role_idx on user_roles (role_id);

do $$
declare t text;
begin
  foreach t in array array['roles', 'role_permissions', 'user_roles'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) with check (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t);
  end loop;
end $$;

revoke insert, update, delete on permissions from digi_app;

-- Built-in roles for a tenant. Existing roles are left alone, so it is safe to call again.
create function ensure_default_roles(p_tenant uuid) returns void language plpgsql as $$
declare r record; rid uuid;
begin
  perform set_config('app.tenant_id', p_tenant::text, true);
  for r in
    select * from (values
      ('Student', 'Uses Digi and requests rooms.',                                 false, array['chat.use', 'bookings.view_own', 'bookings.create']),
      ('Faculty', 'Uses Digi and requests rooms.',                                 false, array['chat.use', 'bookings.view_own', 'bookings.create']),
      ('Staff',   'Sees all bookings and approves or declines room requests.',     false, array['chat.use', 'bookings.view_own', 'bookings.create', 'bookings.view_all', 'bookings.approve']),
      ('Admin',   'Full access. Holds every permission and cannot be edited.',     true,  array[]::text[])
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

-- Existing tenants get the built-in roles, and each user keeps the role they had.
do $$
declare t record;
begin
  for t in select id from tenants loop
    perform ensure_default_roles(t.id);
    insert into user_roles (tenant_id, user_id, role_id)
    select u.tenant_id, u.id, r.id from users u join roles r on r.tenant_id = u.tenant_id and lower(r.name) = lower(u.role)
    where u.tenant_id = t.id;
  end loop;
end $$;

alter table users drop column role;
