-- Row-level security checks each row's own tenant_id, but a foreign key could still point at another tenant's row
-- (for example a role from tenant B on a tenant A user). Composite foreign keys that include tenant_id close that gap.
-- Found by the isolation tests in db/tests/.

-- The owner role is bound by row-level security too, so validating the new keys against existing rows needs it switched off briefly.
alter table users no force row level security;
alter table roles no force row level security;

alter table users add constraint users_tenant_id_id_key unique (tenant_id, id);
alter table roles add constraint roles_tenant_id_id_key unique (tenant_id, id);

alter table sessions drop constraint sessions_user_id_fkey;
alter table sessions add constraint sessions_user_fk foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade;

alter table user_identities drop constraint user_identities_user_id_fkey;
alter table user_identities add constraint user_identities_user_fk foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade;

alter table execution_contexts drop constraint execution_contexts_user_id_fkey;
alter table execution_contexts add constraint execution_contexts_user_fk foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade;

alter table audit_events drop constraint audit_events_user_id_fkey;
alter table audit_events add constraint audit_events_user_fk foreign key (tenant_id, user_id) references users (tenant_id, id) on delete set null (user_id);

alter table user_roles drop constraint user_roles_user_id_fkey;
alter table user_roles drop constraint user_roles_role_id_fkey;
alter table user_roles add constraint user_roles_user_fk foreign key (tenant_id, user_id) references users (tenant_id, id) on delete cascade;
alter table user_roles add constraint user_roles_role_fk foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete restrict;

alter table role_permissions drop constraint role_permissions_role_id_fkey;
alter table role_permissions add constraint role_permissions_role_fk foreign key (tenant_id, role_id) references roles (tenant_id, id) on delete cascade;

alter table users force row level security;
alter table roles force row level security;
