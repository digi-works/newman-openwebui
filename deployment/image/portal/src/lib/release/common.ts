import { createHash } from "node:crypto";

/** Canonical JSON: object keys sorted at every level, so the same content always gives the same bytes. This is what is hashed and signed. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(o[k])).join(",") + "}";
}
export const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const b64u = (b: Buffer) => b.toString("base64url");
export const fromB64u = (s: string) => Buffer.from(s, "base64url");
