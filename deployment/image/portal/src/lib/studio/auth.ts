import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { dummyHash, hashPassword, verifyPassword } from "../auth-password";
import { blockedFor, clear, recordFailure } from "../ratelimit";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "./crypto";
import { sq, stx, studioAudit } from "./db";

/**
 * The platform identity realm (ST.1). Operators are not customer users: they live in a different database, sign in at /platform/login,
 * must prove a second factor (TOTP) before any Studio page or API will answer, and have platform roles that no customer Permissions page can
 * grant. The session cookie has its own name; only a hash of its token is stored.
 */
export const COOKIE = "studio_session";
export const SESSION_HOURS = 8;
const LOCK_AFTER = 5, LOCK_MINUTES = 15;

export type OperatorRole = "operator" | "platform_admin";
export type Operator = { id: string; email: string; name: string; role: OperatorRole; mfaEnrolled: boolean; mfaVerified: boolean };

export const mfaRequired = () => process.env.STUDIO_REQUIRE_MFA !== "false";
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

async function setCookie(token: string) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.COOKIE_SECURE === "true", path: "/", maxAge: SESSION_HOURS * 3600,
  });
}

export async function loginOperator(email: string, password: string, ip: string): Promise<{ ok: true; next: "enroll" | "verify" | "done" } | { ok: false; error: string; status: number }> {
  const address = email.trim().toLowerCase();
  const acct = `op:${address}`, addr = `opip:${ip}`;
  const wait = Math.max(blockedFor(acct, 10), blockedFor(addr, 30));
  if (wait > 0) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, status: 429 };

  const op = (await sq<{ id: string; password_hash: string; status: string; mfa_enrolled: boolean; failed_attempts: number; locked: boolean }>(
    "select id, password_hash, status, mfa_enrolled, failed_attempts, (locked_until > now()) as locked from platform_operators where email = $1", [address],
  ))[0];
  const bad = async (id?: string) => {
    recordFailure(acct); recordFailure(addr);
    if (id) await sq("update platform_operators set failed_attempts = failed_attempts + 1, locked_until = case when failed_attempts + 1 >= $2 then now() + make_interval(mins => $3) else locked_until end where id = $1", [id, LOCK_AFTER, LOCK_MINUTES]);
    await studioAudit({ operatorId: id ?? null, action: "platform.login", result: "failed", metadata: { reason: id ? "bad_password" : "unknown" } });
    return { ok: false as const, error: "Incorrect email or password.", status: 401 };
  };
  if (!op) { await verifyPassword(password, await dummyHash()); return bad(); }
  if (op.locked) return { ok: false, error: `This account is locked for ${LOCK_MINUTES} minutes after too many attempts.`, status: 429 };
  if (!(await verifyPassword(password, op.password_hash)) || op.status !== "active") return bad(op.id);

  clear(acct);
  await sq("update platform_operators set failed_attempts = 0, locked_until = null where id = $1", [op.id]);
  const token = randomBytes(32).toString("base64url");
  // Two-factor sign-in is required unless the platform instance is explicitly run with STUDIO_REQUIRE_MFA=false (a pilot-only setting; every sign-in is audited either way).
  const skipMfa = !mfaRequired();
  await sq("insert into platform_sessions (token_hash, operator_id, mfa_verified, expires_at) values ($1, $2, $4, now() + make_interval(hours => $3))", [tokenHash(token), op.id, SESSION_HOURS, skipMfa]);
  await setCookie(token);
  await studioAudit({ operatorId: op.id, action: "platform.login", metadata: { stage: "password", mfa: skipMfa ? "disabled by configuration" : "required" } });
  return { ok: true, next: skipMfa ? "done" : op.mfa_enrolled ? "verify" : "enroll" };
}

/** The signed-in operator, or null. A session that has not passed the second factor is returned with mfaVerified false. */
export const currentOperator = cache(async (): Promise<Operator | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const r = (await sq<{ id: string; email: string; name: string; role: OperatorRole; mfa_enrolled: boolean; mfa_verified: boolean }>(
    `select o.id, o.email, o.name, o.role, o.mfa_enrolled, s.mfa_verified
       from platform_sessions s join platform_operators o on o.id = s.operator_id
      where s.token_hash = $1 and s.expires_at > now() and o.status = 'active'`, [tokenHash(token)],
  ))[0];
  return r ? { id: r.id, email: r.email, name: r.name, role: r.role, mfaEnrolled: r.mfa_enrolled, mfaVerified: r.mfa_verified } : null;
});

/** For Studio pages and APIs: the operator only if they are signed in AND have passed MFA (and hold the role, when one is asked for). */
export async function requireOperator(role?: OperatorRole): Promise<Operator | null> {
  const op = await currentOperator();
  if (!op || !op.mfaVerified) return null;
  if (role === "platform_admin" && op.role !== "platform_admin") return null;
  return op;
}

export async function mfaEnrollStart(op: Operator): Promise<{ secret: string; uri: string } | { error: string }> {
  if (op.mfaEnrolled) return { error: "Two-factor sign-in is already set up for this account." };
  // The same pending secret is returned every time until enrolment completes, so a page that asks twice (or a reload) never shows a key that is not the stored one.
  const existing = (await sq<{ totp_secret_enc: Buffer | null }>("select totp_secret_enc from platform_operators where id = $1", [op.id]))[0]?.totp_secret_enc;
  let secret = existing ? decryptSecret(existing) : "";
  if (!secret) {
    secret = newTotpSecret();
    await sq("update platform_operators set totp_secret_enc = $2 where id = $1 and not mfa_enrolled and totp_secret_enc is null", [op.id, encryptSecret(secret)]);
    secret = decryptSecret((await sq<{ totp_secret_enc: Buffer }>("select totp_secret_enc from platform_operators where id = $1", [op.id]))[0]!.totp_secret_enc);
  }
  return { secret, uri: otpauthUri(secret, op.email) };
}

/** Checks a code. The first successful code also completes enrolment. A code can only be used once. */
export async function mfaVerify(op: Operator, code: string): Promise<boolean> {
  const acct = `opmfa:${op.id}`;
  if (blockedFor(acct, 8) > 0) return false;
  const row = (await sq<{ totp_secret_enc: Buffer | null; last_totp_step: string | null }>("select totp_secret_enc, last_totp_step from platform_operators where id = $1", [op.id]))[0];
  if (!row?.totp_secret_enc) return false;
  const step = verifyTotp(decryptSecret(row.totp_secret_enc), code.trim());
  if (step === null || (row.last_totp_step !== null && step <= Number(row.last_totp_step))) {
    recordFailure(acct);
    await studioAudit({ operatorId: op.id, action: "platform.mfa", result: "failed" });
    return false;
  }
  clear(acct);
  const token = (await cookies()).get(COOKIE)?.value ?? "";
  await stx(async (c) => {
    await c.query("update platform_operators set mfa_enrolled = true, last_totp_step = $2, last_login_at = now() where id = $1", [op.id, step]);
    await c.query("update platform_sessions set mfa_verified = true where token_hash = $1", [tokenHash(token)]);
    await studioAudit({ operatorId: op.id, action: "platform.mfa", metadata: { enrolled: !op.mfaEnrolled } }, c);
  });
  return true;
}

export async function logoutOperator() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await sq("delete from platform_sessions where token_hash = $1", [tokenHash(token)]);
  jar.delete(COOKIE);
}

export async function createOperator(input: { email: string; name: string; role: OperatorRole; password: string }, by?: string) {
  const email = input.email.trim().toLowerCase();
  const id = (await sq<{ id: string }>("insert into platform_operators (email, name, role, password_hash) values ($1, $2, $3, $4) returning id", [email, input.name.trim(), input.role, await hashPassword(input.password)]))[0]!.id;
  await studioAudit({ operatorId: by ?? null, action: "platform.operator.create", entityType: "operator", entityId: id, metadata: { email, role: input.role } });
  return id;
}
