import { createCipheriv, createDecipheriv, createPrivateKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { assertOutboundUrl } from "../mcp/client";
import { systemQuery } from "../digi-db";
import { makeAssertion } from "../release/assertion";
import { canonicalJson, sha256Hex } from "../release/common";
import { trustedRoots } from "../release/trust";
import { verifyCert, type Cert, type Jwk } from "../release/verify";
import { verify as nodeVerify, createPublicKey, type JsonWebKey } from "node:crypto";

/**
 * This stack's own cryptographic identity (decision 7 Oct). The keypair is generated here; the private key never leaves, and is stored encrypted
 * with this stack's secret key. To enrol, the stack sends only its public key and a single-use token, and receives an installation id and a credential
 * signed by the platform, which it verifies against the trusted root before believing it. After that, every request to the Release Service is a
 * short-lived signed assertion. There is no shared API key.
 */
export const DIGI_VERSION = () => process.env.DIGI_VERSION || "0.1.0";
export const STACK_ID = () => process.env.STACK_ID || "newman";

export class StackError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type Identity = {
  installationId: string | null; publicKey: Jwk | null; releaseUrl: string | null; channel: "stable" | "preview"; updateMode: "approval" | "auto" | "pin";
  pinnedRelease: string | null; minAllowedSeq: number; activeRelease: string | null; previousRelease: string | null; enrolledAt: string | null;
  lastCheckAt: string | null; lastCheckError: string | null;
};

const key = () => {
  const k = Buffer.from(process.env.DIGI_SECRET_KEY || "", "base64");
  if (k.length !== 32) throw new StackError("This stack has no secret key configured.", 503);
  return k;
};
const seal = (plain: string) => { const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv), ct = Buffer.concat([c.update(plain, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); };
const open = (b: Buffer) => { const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); };

export async function getIdentity(): Promise<Identity> {
  const r = (await systemQuery("select * from stack_identity where singleton")).rows[0];
  return {
    installationId: r.installation_id, publicKey: r.public_key, releaseUrl: r.release_url, channel: r.channel, updateMode: r.update_mode, pinnedRelease: r.pinned_release,
    minAllowedSeq: Number(r.min_allowed_seq), activeRelease: r.active_release, previousRelease: r.previous_release, enrolledAt: r.enrolled_at ? new Date(r.enrolled_at).toISOString() : null,
    lastCheckAt: r.last_check_at ? new Date(r.last_check_at).toISOString() : null, lastCheckError: r.last_check_error,
  };
}

const releaseHosts = () => (process.env.DIGI_RELEASE_ALLOW_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

/** Redeems an enrollment token with the Release Service at releaseUrl and stores the resulting identity. */
export async function enrollStack(releaseUrl: string, token: string, runtimeCapabilities: Record<string, boolean>): Promise<{ installationId: string }> {
  const id = await getIdentity();
  if (id.installationId) throw new StackError("This stack is already enrolled. Ask the platform to revoke the old installation before enrolling again.", 409);
  const base = (await assertOutboundUrl(releaseUrl, releaseHosts())).origin;
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const jwk: Jwk = { kty: "EC", crv: "P-256", x: j.x!, y: j.y! };
  let res: Response;
  try {
    res = await fetch(`${base}/api/release/enroll`, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(20_000), cache: "no-store",
      body: JSON.stringify({ token, public_key: jwk, digi_version: DIGI_VERSION(), runtime_capabilities: runtimeCapabilities }),
    });
  } catch { throw new StackError("Could not reach the platform's release service.", 502); }
  if (res.status === 401) throw new StackError("That enrollment token was not accepted. It may have been used already or have expired.", 401);
  if (!res.ok) throw new StackError(`The release service refused enrolment (${res.status}).`, 502);
  const out = (await res.json()) as { installation_id: string; credential: { installation_id: string; key_fingerprint: string; issued_at: string; signature: { key_id: string; signature: string; cert: Cert } } };

  // believe the credential only if the platform's release key (chained to the trusted root) signed it, and it names this stack's key
  const { signature, ...body } = out.credential;
  const certProblem = verifyCert(signature.cert, trustedRoots());
  const okSig = !certProblem && nodeVerify("sha256", Buffer.from(canonicalJson(body)), { key: createPublicKey({ key: signature.cert.public_key as JsonWebKey, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature.signature, "base64"));
  if (!okSig || body.installation_id !== out.installation_id || body.key_fingerprint !== sha256Hex(canonicalJson(jwk))) throw new StackError("The platform's credential could not be verified, so enrolment was not completed.", 502);

  await systemQuery(
    "update stack_identity set installation_id = $1, public_key = $2, private_key_enc = $3, release_url = $4, enrolled_at = now() where singleton and installation_id is null",
    [out.installation_id, JSON.stringify(jwk), seal(privateKey.export({ type: "pkcs8", format: "pem" }) as string), base],
  );
  await systemQuery("insert into stack_events (kind, detail) values ('enrolled', $1)", [JSON.stringify({ installation_id: out.installation_id })]);
  return { installationId: out.installation_id };
}

/** A GET to the Release Service with a fresh signed assertion. */
export async function signedGet(path: string, extra: Record<string, string> = {}): Promise<Response> {
  const row = (await systemQuery("select installation_id, private_key_enc, release_url from stack_identity where singleton")).rows[0];
  if (!row?.installation_id || !row.private_key_enc || !row.release_url) throw new StackError("This stack is not enrolled with the platform.", 409);
  const base = (await assertOutboundUrl(row.release_url, releaseHosts())).origin;
  const pem = open(row.private_key_enc);
  void createPrivateKey; // parsed (and so validated) when the assertion is made
  return fetch(`${base}${path}`, {
    headers: { Authorization: makeAssertion(row.installation_id, pem, "GET", path), ...extra }, redirect: "error", signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
}
