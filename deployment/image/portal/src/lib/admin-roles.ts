import { auditEvent } from "./audit";
import { withTenant } from "./digi-db";
import type { SessionUser } from "./session";

export type PermissionInfo = { code: string; module: string; action: string; label: string; description: string; enforced: boolean };
export type RoleRow = {
  id: string; name: string; description: string; isSystem: boolean; grantsAll: boolean; userCount: number; permissions: string[];
};
type Failure = { error: string; status?: number };

export async function listCatalog(tenantId: string): Promise<PermissionInfo[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query("select code, module, action, label, description, enforced from permissions order by sort, code");
    return rows as PermissionInfo[];
  });
}

export async function listRoles(tenantId: string): Promise<RoleRow[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `select r.id, r.name, r.description, r.is_system, r.grants_all,
              (select count(*)::int from user_roles ur where ur.role_id = r.id) as user_count,
              coalesce((select array_agg(rp.permission_code order by rp.permission_code) from role_permissions rp where rp.role_id = r.id), '{}') as perms
         from roles r
        order by r.grants_all desc, r.is_system desc, lower(r.name)`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, isSystem: r.is_system, grantsAll: r.grants_all, userCount: r.user_count, permissions: r.perms,
    }));
  });
}

const UUID = /^[0-9a-f-]{36}$/;

export async function createRole(admin: SessionUser, input: { name: string; description?: string }): Promise<Failure | { id: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return { error: "Enter a role name of up to 60 characters." };
  return withTenant(admin.tenantId, async (c) => {
    const dup = await c.query("select 1 from roles where lower(name) = lower($1)", [name]);
    if (dup.rows[0]) return { error: "A role with that name already exists." };
    const { rows } = await c.query("insert into roles (tenant_id, name, description) values ($1, $2, $3) returning id", [admin.tenantId, name, (input.description ?? "").trim().slice(0, 300)]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "role.create", entityType: "role", entityId: rows[0].id, metadata: { name } });
    return { id: rows[0].id as string };
  });
}

/** Saves a role's description and permissions. The Admin role cannot be changed; built-in roles keep their names. */
export async function saveRole(admin: SessionUser, id: string, input: { description?: string; permissions?: string[] }): Promise<Failure | { ok: true }> {
  if (!UUID.test(id)) return { error: "Unknown role.", status: 404 };
  return withTenant(admin.tenantId, async (c) => {
    const role = (await c.query("select id, name, grants_all from roles where id = $1 for update", [id])).rows[0];
    if (!role) return { error: "Unknown role.", status: 404 };
    if (role.grants_all) return { error: "The Admin role always has every permission and cannot be edited.", status: 400 };
    if (input.permissions) {
      const wanted = [...new Set(input.permissions)];
      const known = new Set((await c.query("select code from permissions")).rows.map((r) => r.code as string));
      const bad = wanted.find((p) => !known.has(p));
      if (bad) return { error: `Unknown permission: ${bad}`, status: 400 };
      const before = new Set((await c.query("select permission_code from role_permissions where role_id = $1", [id])).rows.map((r) => r.permission_code as string));
      await c.query("delete from role_permissions where role_id = $1", [id]);
      if (wanted.length) {
        await c.query("insert into role_permissions (tenant_id, role_id, permission_code) select $1, $2, unnest($3::text[])", [admin.tenantId, id, wanted]);
      }
      const added = wanted.filter((p) => !before.has(p)), removed = [...before].filter((p) => !wanted.includes(p));
      await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "role.permissions", entityType: "role", entityId: id, metadata: { role: role.name, added, removed } });
    }
    if (typeof input.description === "string") {
      await c.query("update roles set description = $2, updated_at = now() where id = $1", [id, input.description.trim().slice(0, 300)]);
    }
    return { ok: true as const };
  });
}

export async function deleteRole(admin: SessionUser, id: string): Promise<Failure | { ok: true }> {
  if (!UUID.test(id)) return { error: "Unknown role.", status: 404 };
  return withTenant(admin.tenantId, async (c) => {
    const role = (await c.query("select name, is_system from roles where id = $1 for update", [id])).rows[0];
    if (!role) return { error: "Unknown role.", status: 404 };
    if (role.is_system) return { error: "Built-in roles cannot be deleted.", status: 400 };
    const used = (await c.query("select count(*)::int as n from user_roles where role_id = $1", [id])).rows[0].n;
    if (used) return { error: `${used} user${used === 1 ? " has" : "s have"} this role. Give them another role first.`, status: 400 };
    await c.query("delete from roles where id = $1", [id]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "role.delete", entityType: "role", entityId: id, metadata: { name: role.name } });
    return { ok: true as const };
  });
}
