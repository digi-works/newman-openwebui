import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { canonicalJson, sha256Hex } from "./common";

/**
 * Release verification, shared by Studio (to check its own output) and by every customer stack (before it will even look at a bundle).
 *
 * The chain of trust: a customer stack ships with the root PUBLIC key only (trust/root.pub.json). A bundle carries the release key's certificate,
 * signed by the root, and its own signature made with that release key. So a bundle is accepted only if
 *   root signed the certificate  ->  the certificate is in date and not revoked  ->  the release key signed the bundle  ->  the content hashes to the digest.
 * Rotating the release key therefore needs no change on any stack.
 */
export type Jwk = { kty: string; crv: string; x: string; y: string };
export type TrustAnchor = { key_id: string; alg: "ES256"; public_key: Jwk };
export type Cert = { key_id: string; alg: "ES256"; public_key: Jwk; not_before: string; not_after: string; root_key_id: string; root_signature: string };
export type Signature = { alg: "ES256"; key_id: string; digest: string; signature: string; signed_at: string; cert: Cert };
export type Bundle = { format: 1; manifest: Record<string, unknown>; files: Record<string, unknown>; lock: unknown; signature: Signature };
export type KeyRevocation = { key_id: string; reason: string; revoked_at: string; root_key_id: string; root_signature: string };

const pub = (j: Jwk) => createPublicKey({ key: j as JsonWebKey, format: "jwk" });
const ok = (key: Jwk, data: string, sigB64: string) => {
  try { return verify("sha256", Buffer.from(data), { key: pub(key), dsaEncoding: "ieee-p1363" }, Buffer.from(sigB64, "base64")); } catch { return false; }
};

/** The part of a certificate the root signed (everything except the signature itself). */
export const certBody = (c: Cert) => canonicalJson({ key_id: c.key_id, alg: c.alg, public_key: c.public_key, not_before: c.not_before, not_after: c.not_after, root_key_id: c.root_key_id });
export const revocationBody = (r: KeyRevocation) => canonicalJson({ key_id: r.key_id, reason: r.reason, revoked_at: r.revoked_at, root_key_id: r.root_key_id });
/** What the release key signs for a bundle. */
export const bundleBody = (b: Pick<Bundle, "format" | "manifest" | "files" | "lock">) => canonicalJson({ format: b.format, manifest: b.manifest, files: b.files, lock: b.lock });

export function verifyCert(cert: Cert, roots: TrustAnchor[], now = new Date()): string | null {
  if (cert.alg !== "ES256") return "unsupported signature algorithm";
  const root = roots.find((r) => r.key_id === cert.root_key_id);
  if (!root) return "the certificate was issued by a root this stack does not trust";
  if (!ok(root.public_key, certBody(cert), cert.root_signature)) return "the release key's certificate is not signed by the root";
  if (now < new Date(cert.not_before)) return "the release key is not valid yet";
  if (now > new Date(cert.not_after)) return "the release key has expired";
  return null;
}

/** Returns the key ids that are validly revoked by a root signature (an entry that does not verify is ignored, never trusted). */
export function validRevokedKeys(list: KeyRevocation[], roots: TrustAnchor[]): Set<string> {
  const out = new Set<string>();
  for (const r of list) {
    const root = roots.find((x) => x.key_id === r.root_key_id);
    if (root && ok(root.public_key, revocationBody(r), r.root_signature)) out.add(r.key_id);
  }
  return out;
}

export type VerifyOptions = { roots: TrustAnchor[]; revokedKeys?: Set<string>; revokedReleases?: Set<string>; now?: Date };

export function verifyBundle(bundle: Bundle, o: VerifyOptions): { ok: true } | { ok: false; reason: string } {
  const fail = (reason: string) => ({ ok: false as const, reason });
  try {
    if (!bundle || bundle.format !== 1 || !bundle.signature || !bundle.manifest || !bundle.files) return fail("this is not a Digi release bundle");
    const sig = bundle.signature;
    if (sig.alg !== "ES256") return fail("unsupported signature algorithm");
    const certProblem = verifyCert(sig.cert, o.roots, o.now);
    if (certProblem) return fail(certProblem);
    if (sig.cert.key_id !== sig.key_id) return fail("the signature names a different key than the certificate");
    if (o.revokedKeys?.has(sig.key_id)) return fail("the release key has been revoked");
    const body = bundleBody(bundle);
    if (sha256Hex(body) !== sig.digest) return fail("the bundle's content does not match its digest (it was changed)");
    if (!ok(sig.cert.public_key, body, sig.signature)) return fail("the bundle's signature is not valid");
    const id = String(bundle.manifest.release_id ?? "");
    if (o.revokedReleases?.has(id)) return fail("this release has been revoked");
    return { ok: true };
  } catch {
    return fail("the bundle could not be checked");
  }
}

/** A signed revocation list from the platform: signed by a release key whose certificate chains to the root. */
export type RevocationList = {
  issued_at: string; releases: { release_id: string; reason: string; revoked_at: string }[]; keys: KeyRevocation[]; installations?: never;
  signature: { key_id: string; signature: string; cert: Cert };
};
export const revocationListBody = (l: Omit<RevocationList, "signature">) => canonicalJson({ issued_at: l.issued_at, releases: l.releases, keys: l.keys });

export function verifyRevocationList(l: RevocationList, roots: TrustAnchor[], now = new Date()): { ok: true; releases: Set<string>; keys: Set<string> } | { ok: false; reason: string } {
  const problem = verifyCert(l.signature.cert, roots, now);
  if (problem) return { ok: false, reason: problem };
  const keys = validRevokedKeys(l.keys, roots);
  // the list is only believed if its signing key has not itself been revoked by the root
  if (keys.has(l.signature.key_id)) return { ok: false, reason: "the revocation list was signed by a revoked key" };
  if (!ok(l.signature.cert.public_key, revocationListBody(l), l.signature.signature)) return { ok: false, reason: "the revocation list's signature is not valid" };
  return { ok: true, releases: new Set(l.releases.map((r) => r.release_id)), keys };
}
