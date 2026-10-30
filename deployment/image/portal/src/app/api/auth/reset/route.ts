import { resetPassword } from "@/lib/password-reset";
import { blockedFor, clientIp, recordFailure } from "@/lib/ratelimit";
import { authLive } from "@/lib/session";
import { getTenant } from "@/lib/tenant";

const fail = (error: string, status: number, headers?: HeadersInit) => Response.json({ error }, { status, headers });

const PER_ADDRESS = 20;  // failed resets per address per 15 minutes

/** Sets a new password with the token from a reset link (QA DEF-30). Every session of the person ends; they sign in with the new one. */
export async function POST(req: Request) {
  let body: { token?: unknown; next?: unknown };
  try { body = await req.json(); } catch { return fail("Invalid request.", 400); }
  const { token, next } = body;
  if (typeof token !== "string" || !token || token.length > 200) return fail("This link is not complete. Open it again from the email.", 400);
  if (typeof next !== "string" || !next) return fail("Enter a new password.", 400);

  const addr = `reset-ip:${clientIp(req)}`;
  const wait = blockedFor(addr, PER_ADDRESS);
  if (wait > 0) return fail(`Too many attempts. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`, 429, { "Retry-After": String(wait) });
  if (!authLive()) return fail("Not available in mock mode.", 400);
  const tenant = await getTenant();
  if (!tenant) return fail("This address is not set up for sign-in.", 404);

  try {
    const r = await resetPassword(tenant.id, token, next);
    if (!r.ok) { recordFailure(addr); return fail(r.error, 400); }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("password reset failed", e);
    return fail("Could not change the password. Try again in a moment.", 502);
  }
}
