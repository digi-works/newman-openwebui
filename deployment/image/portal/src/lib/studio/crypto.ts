import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** Small crypto helpers for the platform realm: TOTP (RFC 6238), secret encryption at rest, canonical JSON and hashing. */

export { canonicalJson, sha256Hex } from "../release/common";
import { canonicalJson, sha256Hex } from "../release/common";
export const hashSpec = (spec: unknown) => sha256Hex(canonicalJson(spec));

/* ---------------------------------------------------------------- encryption at rest (operators' MFA secrets) */
const key = () => {
  const k = Buffer.from(process.env.STUDIO_SECRET_KEY || "", "base64");
  if (k.length !== 32) throw new Error("STUDIO_SECRET_KEY must be 32 bytes, base64 encoded.");
  return k;
};
/** iv (12) || tag (16) || ciphertext */
export function encryptSecret(plain: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decryptSecret(blob: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}

/* ---------------------------------------------------------------- TOTP: 6 digits, 30 seconds, HMAC-SHA1 (what authenticator apps use) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = "", out = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) { const i = B32.indexOf(ch); if (i < 0) throw new Error("bad base32"); bits += i.toString(2).padStart(5, "0"); }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
export const totpStep = (now = Date.now()) => Math.floor(now / 30_000);

/** Returns the matching step (so the caller can refuse a replay), or null. Accepts one step either side for clock drift. */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = totpStep(now);
  for (const s of [cur, cur - 1, cur + 1]) if (totpAt(secretB32, s) === code) return s;
  return null;
}
export const otpauthUri = (secretB32: string, account: string) =>
  `otpauth://totp/${encodeURIComponent("Digi Studio")}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent("Digi Studio")}&digits=6&period=30`;
