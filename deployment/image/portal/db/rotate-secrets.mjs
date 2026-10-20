// Re-encrypts every saved secret under a new DIGI_SECRET_KEY.
//   1. Generate a new key:            openssl rand -base64 32
//   2. Put the OLD key in DIGI_SECRET_KEY_PREVIOUS and the NEW key in DIGI_SECRET_KEY, restart the portal (it can read both).
//   3. Run:  docker compose exec portal node db/rotate-secrets.mjs
//   4. Remove DIGI_SECRET_KEY_PREVIOUS and restart.
// Runs as the migration owner and prints counts only, never a secret.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import pg from "pg";

const key = (v) => { const b = Buffer.from(v || "", "base64"); return b.length === 32 ? b : null; };
const next = key(process.env.DIGI_SECRET_KEY), prev = key(process.env.DIGI_SECRET_KEY_PREVIOUS);
if (!next || !prev) { console.error("Both DIGI_SECRET_KEY (new) and DIGI_SECRET_KEY_PREVIOUS (old) must be set to 32-byte base64 keys."); process.exit(1); }
if (next.equals(prev)) { console.error("The new and previous keys are the same."); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.DIGI_MIGRATE_URL });
await c.connect();
let done = 0, already = 0, failed = 0;
try {
  await c.query("begin");
  // Row-level security is forced even for the owner, so go tenant by tenant.
  const rows = [];
  for (const t of (await c.query("select id from tenants")).rows) {
    await c.query("select set_config('app.tenant_id', $1, true)", [t.id]);
    rows.push(...(await c.query("select tenant_id, name, ciphertext, iv, tag from tenant_secrets for update")).rows);
  }
  for (const r of rows) {
    await c.query("select set_config('app.tenant_id', $1, true)", [r.tenant_id]);
    const open = (k) => { try { const d = createDecipheriv("aes-256-gcm", k, r.iv); d.setAuthTag(r.tag); return Buffer.concat([d.update(r.ciphertext), d.final()]); } catch { return null; } };
    if (open(next)) { already++; continue; }
    const plain = open(prev);
    if (!plain) { failed++; continue; }
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", next, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    await c.query("update tenant_secrets set ciphertext = $3, iv = $4, tag = $5, updated_at = now() where tenant_id = $1 and name = $2", [r.tenant_id, r.name, ciphertext, iv, cipher.getAuthTag()]);
    done++;
  }
  if (failed) throw new Error(`${failed} secret(s) could not be read with either key; nothing was changed.`);
  await c.query("commit");
  console.log(`re-encrypted ${done}, already on the new key ${already}`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
