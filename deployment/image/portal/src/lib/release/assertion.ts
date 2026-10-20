import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type JsonWebKey } from "node:crypto";
import { b64u, fromB64u } from "./common";
import type { Jwk } from "./verify";

/**
 * Signed client assertions: how a customer stack proves who it is to the Release Service (decision 7 Oct: per-installation identity, no shared
 * API key). Each request carries a short-lived statement, signed with the installation's own private key, naming the exact method and path and a
 * one-time id. The platform checks it against the public key it registered at enrolment. This also works where a customer's outbound proxy
 * would break mutual TLS.
 *
 *   Authorization: Installation <installation_id>.<base64url(payload)>.<base64url(signature)>
 */
export const AUD = "digi-release";
export type AssertionPayload = { iat: number; exp: number; jti: string; aud: string; method: string; path: string };

export function makeAssertion(installationId: string, privateKeyPem: string, method: string, path: string, now = Date.now()): string {
  const payload: AssertionPayload = { iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 60, jti: randomBytes(16).toString("hex"), aud: AUD, method: method.toUpperCase(), path };
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = sign("sha256", Buffer.from(body), { key: createPrivateKey(privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `Installation ${installationId}.${body}.${b64u(sig)}`;
}

export function parseAssertionHeader(h: string | null): { installationId: string; body: string; sig: string } | null {
  const m = /^Installation ([a-z0-9-]{6,64})\.([A-Za-z0-9_-]{20,1000})\.([A-Za-z0-9_-]{80,200})$/.exec(h ?? "");
  return m ? { installationId: m[1]!, body: m[2]!, sig: m[3]! } : null;
}

/** Checks the signature and the statement; the caller must still make sure the jti was not seen before. */
export function checkAssertion(parts: { body: string; sig: string }, publicKey: Jwk, method: string, path: string, now = Date.now()): { ok: true; jti: string; exp: number } | { ok: false } {
  try {
    if (!verify("sha256", Buffer.from(parts.body), { key: createPublicKey({ key: publicKey as JsonWebKey, format: "jwk" }), dsaEncoding: "ieee-p1363" }, fromB64u(parts.sig))) return { ok: false };
    const p = JSON.parse(fromB64u(parts.body).toString("utf8")) as AssertionPayload;
    const t = Math.floor(now / 1000);
    if (p.aud !== AUD || p.method !== method.toUpperCase() || p.path !== path) return { ok: false };
    if (p.exp < t || p.iat > t + 30 || p.exp - p.iat > 120 || typeof p.jti !== "string" || p.jti.length < 16) return { ok: false };
    return { ok: true, jti: p.jti, exp: p.exp };
  } catch { return { ok: false }; }
}
