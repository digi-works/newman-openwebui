import { cookies } from "next/headers";
import { auditEvent } from "@/lib/audit";
import { dummyHash, verifyPassword } from "@/lib/auth-password";
import { withTenant } from "@/lib/digi-db";
import { blockedFor, clear, clientIp, recordFailure } from "@/lib/ratelimit";
import { authLive, COOKIE, createSession, MAX_AGE } from "@/lib/session";
import { getTenant } from "@/lib/tenant";

const fail = (error: string, status: number, headers?: HeadersInit) => Response.json({ error }, { status, headers });

const PER_ACCOUNT = 5;   // wrong passwords per email per 15 minutes (in memory, per process)
const PER_ADDRESS = 30;  // failed attempts per address per 15 minutes
const LOCK_AFTER = 5;    // consecutive failures that lock the account (stored, survives restarts)
const LOCK_MINUTES = 15;

const setCookie = async (token: string) =>
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true", // set true behind HTTPS
    path: "/",
    maxAge: MAX_AGE,
  });

/** Signs the user in with their Digi account. The session token goes in an httpOnly cookie; only its hash is stored. */
export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return fail("Invalid request.", 400); }
  const { email, password } = body;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password || email.length > 320 || password.length > 1024) {
    return fail("Enter your email and password.", 400);
  }
  const address = email.trim().toLowerCase();

  const acct = `acct:${address}`;
  const addr = `ip:${clientIp(req)}`;
  const wait = Math.max(blockedFor(acct, PER_ACCOUNT), blockedFor(addr, PER_ADDRESS));
  if (wait > 0) {
    return fail(`Too many sign-in attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`, 429, { "Retry-After": String(wait) });
  }

  if (!authLive()) {
    await setCookie("mock");
    return Response.json({ ok: true, mustChangePassword: false });
  }

  const tenant = await getTenant();
  if (!tenant) return fail("This address is not set up for sign-in.", 404);

  const GENERIC = "Incorrect email or password.";
  try {
    const result = await withTenant(tenant.id, async (c) => {
      const { rows } = await c.query(
        "select id, password_hash, status, must_change_password, failed_attempts, locked_until, (locked_until > now()) as locked from users where email = $1",
        [address],
      );
      const u = rows[0];
      if (!u) {
        await verifyPassword(password, await dummyHash()); // same cost as a real check
        await auditEvent(c, { tenantId: tenant.id, action: "auth.login", result: "failed", metadata: { reason: "unknown_user" } });
        return { ok: false as const, why: "bad" as const };
      }
      if (u.locked) return { ok: false as const, why: "locked" as const };
      const good = await verifyPassword(password, u.password_hash);
      if (!good || u.status !== "active") {
        const n = u.failed_attempts + 1;
        await c.query(
          `update users set failed_attempts = $2::int, locked_until = case when $2::int >= $3::int then now() + make_interval(mins => $4::int) else locked_until end where id = $1`,
          [u.id, n, LOCK_AFTER, LOCK_MINUTES],
        );
        await auditEvent(c, { tenantId: tenant.id, userId: u.id, action: "auth.login", result: "failed", metadata: { reason: good ? "disabled" : "bad_password", attempts: n } });
        return { ok: false as const, why: "bad" as const };
      }
      await c.query("update users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = $1", [u.id]);
      await auditEvent(c, { tenantId: tenant.id, userId: u.id, action: "auth.login" });
      return { ok: true as const, userId: u.id as string, mustChange: u.must_change_password as boolean };
    });

    if (!result.ok) {
      recordFailure(acct);
      recordFailure(addr);
      if (result.why === "locked") return fail(`This account is locked for ${LOCK_MINUTES} minutes after too many attempts.`, 429);
      return fail(GENERIC, 401);
    }

    clear(acct);
    const token = await createSession(tenant.id, result.userId, { ip: clientIp(req), userAgent: req.headers.get("user-agent") ?? "" });
    await setCookie(token);
    return Response.json({ ok: true, mustChangePassword: result.mustChange });
  } catch (e) {
    console.error("login failed", e);
    return fail("Sign-in failed. Try again in a moment.", 502);
  }
}
