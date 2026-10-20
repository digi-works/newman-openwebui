import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { withTenant } from "./digi-db";

/**
 * Tenant secrets (the customer's LLM key, M5.6). Encrypted at rest with AES-256-GCM using DIGI_SECRET_KEY (32 bytes, base64) from the
 * server environment. A secret is write-only from the browser's point of view: it is never returned, logged, put in an audit row, sent
 * to the model or shown again; only its last four characters are kept so an admin can tell which key is in use.
 * In production the key belongs in a KMS or secret manager (M6); this module is the one place that would change.
 */
const key = () => {
  const k = Buffer.from(process.env.DIGI_SECRET_KEY || "", "base64");
  if (k.length !== 32) throw new Error("DIGI_SECRET_KEY must be 32 bytes, base64 encoded.");
  return k;
};
const previousKey = () => {
  const k = Buffer.from(process.env.DIGI_SECRET_KEY_PREVIOUS || "", "base64");
  return k.length === 32 ? k : null;
};
export const secretsEnabled = () => Buffer.from(process.env.DIGI_SECRET_KEY || "", "base64").length === 32;

export async function putSecret(tenantId: string, name: string, value: string, updatedBy: string, meta: Record<string, unknown> = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  await withTenant(tenantId, async (c) => {
    await c.query(
      `insert into tenant_secrets (tenant_id, name, ciphertext, iv, tag, last4, meta, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant_id, name) do update set ciphertext = $3, iv = $4, tag = $5, last4 = $6, meta = $7, updated_by = $8, updated_at = now()`,
      [tenantId, name, ciphertext, iv, cipher.getAuthTag(), value.slice(-4), JSON.stringify(meta), updatedBy],
    );
  });
}

/** Server code only. The plaintext never leaves the process: it goes to the provider or to the runtime, never to a browser. */
export async function readSecret(tenantId: string, name: string): Promise<string | null> {
  const r = await withTenant(tenantId, async (c) => (await c.query("select ciphertext, iv, tag from tenant_secrets where name = $1", [name])).rows[0]);
  if (!r) return null;
  // During a key rotation a secret may still be under the previous key until db/rotate-secrets.mjs has re-encrypted it.
  for (const k of [key(), previousKey()]) {
    if (!k) continue;
    try {
      const d = createDecipheriv("aes-256-gcm", k, r.iv);
      d.setAuthTag(r.tag);
      return Buffer.concat([d.update(r.ciphertext), d.final()]).toString("utf8");
    } catch { /* try the previous key */ }
  }
  throw new Error("A saved secret could not be decrypted. Check DIGI_SECRET_KEY.");
}

export type SecretInfo = { exists: boolean; last4: string; meta: Record<string, unknown>; updatedAt?: string };
export async function secretInfo(tenantId: string, name: string): Promise<SecretInfo> {
  const r = await withTenant(tenantId, async (c) => (await c.query("select last4, meta, updated_at from tenant_secrets where name = $1", [name])).rows[0]);
  return r ? { exists: true, last4: r.last4, meta: r.meta ?? {}, updatedAt: new Date(r.updated_at).toISOString() } : { exists: false, last4: "", meta: {} };
}

export async function patchSecretMeta(tenantId: string, name: string, patch: Record<string, unknown>) {
  await withTenant(tenantId, async (c) => {
    await c.query("update tenant_secrets set meta = meta || $2::jsonb where name = $1", [name, JSON.stringify(patch)]);
  });
}
