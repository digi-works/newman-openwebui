import { auditEvent } from "./audit";
import { hashPassword, temporaryPassword } from "./auth-password";
import { withTenant } from "./digi-db";
import { destroyUserSessions, type SessionUser } from "./session";

export type AdminUserRow = {
  id: string; name: string; email: string; role: string; status: "active" | "disabled";
  mustChangePassword: boolean; lastLogin: string | null; created: string;
};
export type RoleOption = { id: string; name: string; grantsAll: boolean };
type Failure = { error: string; status?: number };

export async function listRoleOptions(tenantId: string): Promise<RoleOption[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query("select id, name, grants_all from roles order by grants_all desc, is_system desc, lower(name)");
    return rows.map((r) => ({ id: r.id, name: r.name, grantsAll: r.grants_all }));
  });
}

export async function listUsers(tenantId: string): Promise<AdminUserRow[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `select u.id, u.name, u.email, u.status, u.must_change_password, u.last_login_at, u.created_at,
              coalesce((select string_agg(r.name, ', ' order by r.grants_all desc, r.name) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id), '') as role
         from users u order by lower(u.name)`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, mustChangePassword: r.must_change_password,
      lastLogin: r.last_login_at ? new Date(r.last_login_at).toISOString() : null, created: new Date(r.created_at).toISOString(),
    }));
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isAll = (u: SessionUser) => u.permissions.includes("*");

export async function createUser(admin: SessionUser, input: { name: string; email: string; role: string }): Promise<Failure | { id: string; temporaryPassword: string }> {
  const name = input.name.trim().slice(0, 120), email = input.email.trim().toLowerCase();
  if (!name) return { error: "Enter a name." };
  if (!EMAIL.test(email) || email.length > 320) return { error: "Enter a valid email address." };
  const temp = temporaryPassword();
  const hash = await hashPassword(temp);
  return withTenant(admin.tenantId, async (c) => {
    const role = (await c.query("select id, name, grants_all from roles where lower(name) = lower($1)", [input.role])).rows[0];
    if (!role) return { error: "Choose a role." };
    if (role.grants_all && !isAll(admin)) return { error: "Only an Admin can give the Admin role.", status: 403 };
    const dup = await c.query("select 1 from users where email = $1", [email]);
    if (dup.rows[0]) return { error: "A user with that email already exists." };
    const { rows } = await c.query(
      "insert into users (tenant_id, email, name, password_hash, must_change_password) values ($1, $2, $3, $4, true) returning id",
      [admin.tenantId, email, name, hash],
    );
    await c.query("insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)", [admin.tenantId, rows[0].id, role.id]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "user.create", entityType: "user", entityId: rows[0].id, metadata: { email, role: role.name } });
    return { id: rows[0].id as string, temporaryPassword: temp };
  });
}

/** Which permission each user-management action needs. */
export const ACTION_PERMISSION = {
  reset_password: "users.update", set_role: "users.update", disable: "users.disable", enable: "users.disable",
} as const;

export async function updateUser(admin: SessionUser, id: string, change: { action: string; role?: string }): Promise<Failure | { ok: true; temporaryPassword?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "Unknown user.", status: 404 };
  const self = id === admin.id;
  if (self && ["disable", "set_role"].includes(change.action)) return { error: "You cannot disable or change the role of your own account.", status: 400 };
  // A reset of your own account would lock you out (the new password is shown once): change it under Settings > Account (QA DEF-27).
  if (self && change.action === "reset_password") return { error: "Change your own password under Settings > Account.", status: 400 };

  // Only an Admin can touch an Admin account, so a delegated "update users" permission is not a way to take over.
  const target = await withTenant(admin.tenantId, async (c) =>
    (await c.query(
      `select exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.grants_all) as is_admin
         from users u where u.id = $1`, [id])).rows[0],
  );
  if (!target) return { error: "Unknown user.", status: 404 };
  if (target.is_admin && !isAll(admin)) return { error: "Only an Admin can change an Admin account.", status: 403 };

  if (change.action === "reset_password") {
    const temp = temporaryPassword();
    const hash = await hashPassword(temp);
    await withTenant(admin.tenantId, async (c) => {
      await c.query("update users set password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = null, updated_at = now() where id = $1", [id, hash]);
      await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "user.reset_password", entityType: "user", entityId: id });
    });
    await destroyUserSessions(admin.tenantId, id);
    return { ok: true, temporaryPassword: temp };
  }

  if (change.action === "disable" || change.action === "enable") {
    const status = change.action === "disable" ? "disabled" : "active";
    await withTenant(admin.tenantId, async (c) => {
      await c.query("update users set status = $2, updated_at = now() where id = $1", [id, status]);
      await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: `user.${change.action}`, entityType: "user", entityId: id });
    });
    if (status === "disabled") await destroyUserSessions(admin.tenantId, id);
    return { ok: true };
  }

  if (change.action === "set_role") {
    return withTenant(admin.tenantId, async (c) => {
      const role = (await c.query("select id, name, grants_all from roles where lower(name) = lower($1)", [change.role ?? ""])).rows[0];
      if (!role) return { error: "Choose a role.", status: 400 };
      if (role.grants_all && !isAll(admin)) return { error: "Only an Admin can give the Admin role.", status: 403 };
      if (target.is_admin && !role.grants_all) {
        const others = (await c.query(
          `select count(*)::int as n from users u where u.id <> $1 and u.status = 'active'
             and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.grants_all)`, [id])).rows[0].n;
        if (others < 1) return { error: "There must be at least one active Admin.", status: 400 };
      }
      await c.query("delete from user_roles where user_id = $1", [id]);
      await c.query("insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)", [admin.tenantId, id, role.id]);
      await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "user.set_role", entityType: "user", entityId: id, metadata: { role: role.name } });
      return { ok: true as const };
    });
  }
  return { error: "Unknown action.", status: 400 };
}

/**
 * Removes an account for good (QA DEF-33), with the same guard rails as disabling it. Their sessions, conversations, memories and roles go with
 * them (the foreign keys cascade); room bookings and the audit trail stay, no longer linked to a person. The audit event keeps who it was.
 */
export async function deleteUser(admin: SessionUser, id: string): Promise<Failure | { ok: true }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { error: "Unknown user.", status: 404 };
  if (id === admin.id) return { error: "You cannot delete your own account.", status: 400 };
  return withTenant(admin.tenantId, async (c) => {
    const target = (await c.query(
      `select u.email, u.name, exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.grants_all) as is_admin
         from users u where u.id = $1 for update`, [id])).rows[0];
    if (!target) return { error: "Unknown user.", status: 404 };
    if (target.is_admin && !isAll(admin)) return { error: "Only an Admin can delete an Admin account.", status: 403 };
    if (target.is_admin) {
      const others = (await c.query(
        `select count(*)::int as n from users u where u.id <> $1 and u.status = 'active'
           and exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id and r.grants_all)`, [id])).rows[0].n;
      if (others < 1) return { error: "There must be at least one active Admin.", status: 400 };
    }
    await c.query("delete from users where id = $1", [id]);
    await auditEvent(c, { tenantId: admin.tenantId, userId: admin.id, action: "user.delete", entityType: "user", entityId: id, metadata: { email: target.email, name: target.name } });
    return { ok: true as const };
  });
}
