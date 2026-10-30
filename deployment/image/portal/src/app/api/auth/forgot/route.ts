import { mailConfigured } from "@/lib/mail";
import { requestPasswordReset } from "@/lib/password-reset";
import { blockedFor, clientIp, recordFailure } from "@/lib/ratelimit";
import { authLive } from "@/lib/session";
import { getTenant } from "@/lib/tenant";

const fail = (error: string, status: number, headers?: HeadersInit) => Response.json({ error }, { status, headers });

const PER_ACCOUNT = 3;   // links per email per 15 minutes
const PER_ADDRESS = 10;  // requests per address per 15 minutes

/** Forgot password (QA DEF-30): emails a reset link. The answer is the same whether or not the address has an account. */
export async function POST(req: Request) {
  let body: { email?: unknown };
  try { body = await req.json(); } catch { return fail("Invalid request.", 400); }
  const { email } = body;
  if (typeof email !== "string" || !email.trim() || email.length > 320 || !email.includes("@")) return fail("Enter your email address.", 400);
  const address = email.trim().toLowerCase();

  const acct = `reset:${address}`;
  const addr = `reset-ip:${clientIp(req)}`;
  const wait = Math.max(blockedFor(acct, PER_ACCOUNT), blockedFor(addr, PER_ADDRESS));
  if (wait > 0) {
    return fail(`Too many requests. Try again in ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}.`, 429, { "Retry-After": String(wait) });
  }
  if (!authLive() || !mailConfigured()) return fail("Digi cannot send email here. Ask an Admin to reset your password under Settings > Users.", 503);
  const tenant = await getTenant();
  if (!tenant) return fail("This address is not set up for sign-in.", 404);

  recordFailure(acct);
  recordFailure(addr);
  try {
    await requestPasswordReset(tenant.id, address, clientIp(req));
  } catch (e) {
    console.error("password reset request failed", e);
    return fail("Could not send the link. Try again in a moment.", 502);
  }
  return Response.json({ ok: true });
}
