import { createHash, randomBytes } from "node:crypto";
import { canonicalJson, sha256Hex } from "../release/common";
import { checkAssertion, parseAssertionHeader } from "../release/assertion";
import type { Jwk } from "../release/verify";
import type { Operator } from "./auth";
import { sq, stx, studioAudit } from "./db";
import { getSigner } from "./signer";
import { StudioError } from "./store";

/**
 * Installation identity (ST.7). A customer stack has its own keypair. To enrol it, an operator mints a single-use, expiring token and gives it to
 * the customer's Admin; the stack generates its keypair locally, sends only the PUBLIC key, and gets back an installation id and a credential signed
 * by the platform. Every later request is a signed client assertion (see release/assertion.ts). Installations can be revoked, and a stack that lost
 * its key re-enrols with a new token. Nothing here stores anything about a customer's people or data.
 */
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createEnrollmentToken(op: Operator, label: string, hours = 24): Promise<{ token: string; expires_at: string }> {
  const name = label.trim().slice(0, 80);
  if (!name) throw new StudioError("Give the customer or stack a label.");
  const h = Math.min(Math.max(Math.floor(hours), 1), 24 * 7);
  const token = "enr_" + randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + h * 3600_000).toISOString();
  await stx(async (c) => {
    await c.query("insert into studio_enrollment_tokens (token_hash, label, created_by, expires_at) values ($1, $2, $3, $4)", [hashToken(token), name, op.id, expires]);
    await studioAudit({ operatorId: op.id, action: "enrollment.token.create", entityType: "enrollment", entityId: name, metadata: { expires_at: expires } }, c);
  });
  return { token, expires_at: expires };
}

const isJwk = (k: unknown): k is Jwk => !!k && typeof k === "object" && (k as Jwk).kty === "EC" && (k as Jwk).crv === "P-256" && typeof (k as Jwk).x === "string" && typeof (k as Jwk).y === "string";

export async function enroll(input: { token: string; publicKey: unknown; digiVersion?: string; runtimeCapabilities?: unknown }) {
  if (!isJwk(input.publicKey)) throw new StudioError("Send the stack's public key (EC P-256).");
  const jwk: Jwk = { kty: "EC", crv: "P-256", x: input.publicKey.x, y: input.publicKey.y };
  return stx(async (c) => {
    // a single-use claim: only one request can ever turn this token into an installation
    const t = (await c.query("update studio_enrollment_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning label", [hashToken(input.token ?? "")])).rows[0];
    if (!t) { await studioAudit({ actor: "installation", action: "enrollment.refused", result: "denied" }, c); throw new StudioError("That enrollment token is not valid.", 401); }
    const id = "inst-" + randomBytes(9).toString("hex");
    await c.query("update studio_enrollment_tokens set installation_id = $2 where token_hash = $1", [hashToken(input.token), id]);
    await c.query("insert into studio_installations (id, label, public_key, digi_version, runtime_capabilities) values ($1, $2, $3, $4, $5)", [id, t.label, JSON.stringify(jwk), String(input.digiVersion ?? "").slice(0, 30), JSON.stringify(input.runtimeCapabilities ?? {})]);
    await studioAudit({ actor: "installation", action: "installation.enroll", entityType: "installation", entityId: id, metadata: { label: t.label } }, c);
    const signer = getSigner();
    const credential = { installation_id: id, key_fingerprint: sha256Hex(canonicalJson(jwk)), issued_at: new Date().toISOString() };
    const sig = await signer.sign(Buffer.from(canonicalJson(credential)));
    return { installation_id: id, credential: { ...credential, signature: { key_id: signer.keyId, signature: sig.toString("base64"), cert: signer.cert } } };
  });
}

export async function listInstallations() {
  return sq<{ id: string; label: string; status: string; enrolled_at: string; last_pull_at: string | null; digi_version: string | null; current_release: string | null; runtime_capabilities: Record<string, unknown> }>(
    "select id, label, status, enrolled_at, last_pull_at, digi_version, current_release, runtime_capabilities from studio_installations order by enrolled_at desc");
}
export async function listTokens() {
  return sq<{ label: string; expires_at: string; used_at: string | null; installation_id: string | null }>("select label, expires_at, used_at, installation_id from studio_enrollment_tokens order by expires_at desc limit 50");
}

export async function revokeInstallation(op: Operator, id: string, reason: string) {
  await stx(async (c) => {
    const r = await c.query("update studio_installations set status = 'revoked' where id = $1 and status = 'active'", [id]);
    if (!r.rowCount) throw new StudioError("That installation does not exist or is already revoked.", 404);
    await c.query("insert into studio_revocations (kind, ref, reason, revoked_by) values ('installation', $1, $2, $3) on conflict do nothing", [id, reason.slice(0, 500), op.id]);
    await studioAudit({ operatorId: op.id, action: "installation.revoke", entityType: "installation", entityId: id, metadata: { reason } }, c);
  });
}

/**
 * Authenticates a Release Service request. Unknown installation, revoked installation, bad signature, stale or reused assertion: all the same
 * answer (null), so a caller learns nothing about which part failed. The stack's self-reported facts are recorded; no customer data is accepted.
 */
export async function authenticateInstallation(req: Request, path: string): Promise<{ id: string } | null> {
  const parts = parseAssertionHeader(req.headers.get("authorization"));
  if (!parts) return null;
  const inst = (await sq<{ id: string; status: string; public_key: Jwk }>("select id, status, public_key from studio_installations where id = $1", [parts.installationId]))[0];
  const ok = inst && inst.status === "active" ? checkAssertion(parts, inst.public_key, req.method, path) : ({ ok: false } as const);
  if (!ok.ok) { await sq("insert into studio_pull_log (installation_id, what, status) values ($1, $2, 401)", [parts.installationId, path]).catch(() => undefined); return null; }
  // each assertion can be used once
  const fresh = await sq("insert into studio_assertion_replays (jti, expires_at) values ($1, to_timestamp($2)) on conflict do nothing returning jti", [ok.jti, ok.exp + 60]);
  await sq("delete from studio_assertion_replays where expires_at < now()").catch(() => undefined);
  if (!fresh.length) return null;
  let caps: unknown;
  try { caps = JSON.parse(req.headers.get("x-runtime-capabilities") ?? "null"); } catch { caps = null; }
  await sq(
    "update studio_installations set last_pull_at = now(), digi_version = coalesce($2, digi_version), current_release = coalesce($3, current_release), runtime_capabilities = coalesce($4::jsonb, runtime_capabilities) where id = $1",
    [inst!.id, (req.headers.get("x-digi-version") ?? "").slice(0, 30) || null, (req.headers.get("x-current-release") ?? "").slice(0, 30) || null, caps ? JSON.stringify(caps) : null],
  );
  await sq("insert into studio_pull_log (installation_id, what, status) values ($1, $2, 200)", [inst!.id, path]).catch(() => undefined);
  return { id: inst!.id };
}
