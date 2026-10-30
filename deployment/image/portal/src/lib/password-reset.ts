import { randomBytes } from "node:crypto";
import { auditEvent } from "./audit";
import { hashPassword, passwordProblem } from "./auth-password";
import { publicUrl } from "./booking-emails";
import { withTenant } from "./digi-db";
import { passwordResetEmail } from "./email-templates";
import { sendMail } from "./mail";
import { hashToken } from "./session";

/**
 * Forgot password (QA DEF-30). A person asks for a link by email; Digi emails one that works once, for LINK_MINUTES.
 * Whether the address has an account is never revealed: the answer and its timing are the same either way, and the email goes out in the
 * background. Only a hash of the token is stored. The link is built from PUBLIC_URL (or the brand host), never from the request's Host header.
 */
export const LINK_MINUTES = 30;

export const resetUrl = (token: string) => `${publicUrl()}/reset-password?token=${encodeURIComponent(token)}`;

/** Emails a reset link to the active account with this address, if there is one. */
export async function requestPasswordReset(tenantId: string, email: string, ip: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const user = await withTenant(tenantId, async (c) => {
    const { rows } = await c.query("select id, name, email from users where email = $1 and status = 'active'", [email]);
    const u = rows[0] as { id: string; name: string; email: string } | undefined;
    if (!u) {
      await auditEvent(c, { tenantId, action: "auth.password_reset_request", result: "failed", metadata: { reason: "unknown_user", ip } });
      return null;
    }
    // a newer link replaces any earlier one
    await c.query("delete from password_resets where user_id = $1", [u.id]);
    await c.query(
      "insert into password_resets (token_hash, tenant_id, user_id, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))",
      [hashToken(token), tenantId, u.id, LINK_MINUTES],
    );
    await auditEvent(c, { tenantId, userId: u.id, action: "auth.password_reset_request", metadata: { ip } });
    return u;
  });
  if (!user) return;
  const { subject, html } = passwordResetEmail(user.name, resetUrl(token), LINK_MINUTES);
  void sendMail({ to: [user.email], subject, html }).catch((e) => console.error("password reset email failed:", e instanceof Error ? e.message : e));
}

export type ResetResult = { ok: true } | { ok: false; error: string };

/** Sets a new password with a reset link's token. The token is used up, any lock is lifted and every session of the person ends. */
export async function resetPassword(tenantId: string, token: string, next: string): Promise<ResetResult> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `select r.user_id, u.email from password_resets r join users u on u.id = r.user_id
        where r.token_hash = $1 and r.expires_at > now() and u.status = 'active' for update of r`,
      [hashToken(token)],
    );
    const r = rows[0] as { user_id: string; email: string } | undefined;
    if (!r) return { ok: false as const, error: "This link has expired or was already used. Ask for a new one." };
    const problem = passwordProblem(next, r.email);
    if (problem) return { ok: false as const, error: problem };
    await c.query(
      "update users set password_hash = $2, must_change_password = false, failed_attempts = 0, locked_until = null, updated_at = now() where id = $1",
      [r.user_id, await hashPassword(next)],
    );
    await c.query("delete from password_resets where user_id = $1", [r.user_id]);
    await c.query("delete from sessions where user_id = $1", [r.user_id]);
    await auditEvent(c, { tenantId, userId: r.user_id, action: "auth.password_reset" });
    return { ok: true as const };
  });
}
