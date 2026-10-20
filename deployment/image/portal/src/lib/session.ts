import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { digiDbEnabled, withTenant } from "./digi-db";
import { hasPermission, type PermissionCode } from "./permissions";
import { getTenant } from "./tenant";

/**
 * Digi sessions. The browser holds a random token in an httpOnly cookie; the database holds only its SHA-256 hash.
 * Tenant and role are always read from the database on the server, never from the cookie.
 * With no DIGI_DATABASE_URL the portal runs in mock mode (cookie value "mock") so the UI still works on its own.
 */
export const COOKIE = "digi_session";
export const MAX_AGE = 60 * 60 * 24 * 7;

export type SessionUser = {
  id: string; name: string; email: string; initials: string;
  /** Display name of the main role (Admin if they hold it). */
  role: string;
  roles: string[];
  /** Permission codes from all their roles, or ["*"] when a role grants everything. Read from the database on every request. */
  permissions: string[];
  tenantId: string; mustChangePassword: boolean;
};

export const MOCK_USER: SessionUser = {
  id: "mock", name: "Newman User", email: "user@newmanu.edu", initials: "NU", role: "Admin", roles: ["Admin"], permissions: ["*"],
  tenantId: "mock", mustChangePassword: false,
};

export const can = (u: Pick<SessionUser, "permissions"> | null | undefined, code: PermissionCode) => !!u && hasPermission(u.permissions, code);

export type Access = { roles: string[]; permissions: string[] };

/** Roles and effective permissions for a user, inside an open tenant transaction. */
export async function loadAccess(c: import("pg").PoolClient, userId: string): Promise<Access> {
  const { rows } = await c.query(
    `select r.name, r.grants_all,
            coalesce(array_agg(rp.permission_code) filter (where rp.permission_code is not null), '{}') as perms
       from user_roles ur
       join roles r on r.id = ur.role_id
       left join role_permissions rp on rp.role_id = r.id
      where ur.user_id = $1
      group by r.id, r.name, r.grants_all`,
    [userId],
  );
  const roles = rows.map((r) => r.name as string).sort((a, b) => (a === "Admin" ? -1 : b === "Admin" ? 1 : a.localeCompare(b)));
  const permissions = rows.some((r) => r.grants_all) ? ["*"] : [...new Set(rows.flatMap((r) => r.perms as string[]))];
  return { roles, permissions };
}

/** For callers that only have ids (tool gateway): the user's roles and permissions, read live. */
export async function accessFor(tenantId: string, userId: string): Promise<Access> {
  return withTenant(tenantId, (c) => loadAccess(c, userId));
}

/** The signed-in user if they hold the permission and are not mid-way through a forced password change. */
export async function requirePermission(code: PermissionCode): Promise<SessionUser | null> {
  const u = await getSessionUser();
  return u && !u.mustChangePassword && can(u, code) ? u : null;
}

export const authLive = digiDbEnabled;

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "U";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(tenantId: string, userId: string, meta: { ip?: string; userAgent?: string }): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await withTenant(tenantId, (c) =>
    c.query(
      `insert into sessions (token_hash, tenant_id, user_id, expires_at, ip, user_agent)
       values ($1, $2, $3, now() + make_interval(secs => $4), $5, $6)`,
      [hashToken(token), tenantId, userId, MAX_AGE, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300)],
    ),
  );
  return token;
}

export async function destroySession(tenantId: string, token: string) {
  await withTenant(tenantId, (c) => c.query("delete from sessions where token_hash = $1", [hashToken(token)]));
}

/** Ends every session of a user (password change, disabled account). */
export async function destroyUserSessions(tenantId: string, userId: string, exceptToken?: string) {
  await withTenant(tenantId, (c) =>
    c.query("delete from sessions where user_id = $1 and ($2::text is null or token_hash <> $2)", [userId, exceptToken ? hashToken(exceptToken) : null]),
  );
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

/** Validates the session cookie against the database for this request's tenant. Deduplicated per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  if (!authLive()) return token === "mock" ? MOCK_USER : null;
  try {
    const tenant = await getTenant();
    if (!tenant) return null;
    return await withTenant(tenant.id, async (c) => {
      const { rows } = await c.query(
        `select u.id, u.name, u.email, u.must_change_password, s.last_seen_at < now() - interval '5 minutes' as stale
           from sessions s join users u on u.id = s.user_id
          where s.token_hash = $1 and s.expires_at > now() and u.status = 'active'`,
        [hashToken(token)],
      );
      const u = rows[0];
      if (!u) return null;
      if (u.stale) await c.query("update sessions set last_seen_at = now() where token_hash = $1", [hashToken(token)]);
      const access = await loadAccess(c, u.id);
      return {
        id: u.id, name: u.name, email: u.email, initials: initialsOf(u.name), role: access.roles[0] ?? "No role", roles: access.roles,
        permissions: access.permissions, tenantId: tenant.id, mustChangePassword: u.must_change_password,
      };
    });
  } catch (e) {
    console.error("getSessionUser failed", e);
    return null;
  }
});

