import { auditEvent } from "@/lib/audit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth-password";
import { withTenant } from "@/lib/digi-db";
import { authLive, destroyUserSessions, getSessionToken, getSessionUser } from "@/lib/session";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** The signed-in user changes their own password. Other sessions are ended. */
export async function POST(req: Request) {
  if (!authLive()) return fail("Not available in mock mode.", 400);
  const user = await getSessionUser();
  if (!user) return fail("Please sign in again.", 401);
  let body: { current?: unknown; next?: unknown };
  try { body = await req.json(); } catch { return fail("Invalid request.", 400); }
  const { current, next } = body;
  if (typeof current !== "string" || typeof next !== "string") return fail("Enter your current and new password.", 400);
  const problem = passwordProblem(next, user.email);
  if (problem) return fail(problem, 400);
  if (next === current) return fail("Choose a different password from the current one.", 400);

  const ok = await withTenant(user.tenantId, async (c) => {
    const { rows } = await c.query("select password_hash from users where id = $1", [user.id]);
    if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
      await auditEvent(c, { tenantId: user.tenantId, userId: user.id, action: "auth.password_change", result: "failed" });
      return false;
    }
    await c.query("update users set password_hash = $2, must_change_password = false, updated_at = now() where id = $1", [user.id, await hashPassword(next)]);
    await auditEvent(c, { tenantId: user.tenantId, userId: user.id, action: "auth.password_change" });
    return true;
  });
  if (!ok) return fail("Your current password is not correct.", 400);
  await destroyUserSessions(user.tenantId, user.id, await getSessionToken());
  return Response.json({ ok: true });
}
