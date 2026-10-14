// Resets an account's portal password from the server, for when nobody can sign in to reset it (e.g. the only Admin is locked out).
// Runs inside the portal container (it uses the portal's own pg module and DIGI_MIGRATE_URL), from the aws folder.
// Set a chosen password (single quotes, so the shell leaves characters like $ alone):
//   docker compose run --rm -v "$PWD/scripts:/import:ro" -e EMAIL=someone@example.edu -e PASSWORD='chosen password' portal node /import/reset-password.mjs
// Or leave PASSWORD out to get a random temporary one, written to $DATA_DIR/reset-password.txt (never printed) and changed at first sign-in:
//   docker compose run --rm -v "$PWD/scripts:/import:ro" -e EMAIL=someone@example.edu portal node /import/reset-password.mjs
//   docker compose run --rm portal sh -c 'cat /data/reset-password.txt && rm /data/reset-password.txt'
// Also clears a sign-in lockout, signs the account out everywhere and records the reset in the audit log.
// Env: EMAIL (comma separated for several accounts; one only with PASSWORD), PASSWORD (optional), TENANT_SLUG (default newman), DIGI_MIGRATE_URL (set in the container).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomBytes, scrypt as scryptCb } from "node:crypto";

const pg = createRequire((process.env.APP_DIR || "/app") + "/package.json")("pg");

// same hash format as the portal (src/lib/auth-password.ts)
const N = 131072, R = 8, P = 1, KEYLEN = 64;
const hash = (pw) => new Promise((resolve, reject) => {
  const salt = randomBytes(16);
  scryptCb(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R }, (e, key) =>
    e ? reject(e) : resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`));
});
const need = (k) => { const v = (process.env[k] || "").trim(); if (!v) { console.error(`reset-password: ${k} is not set`); process.exit(1); } return v; };
const emails = need("EMAIL").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const slug = process.env.TENANT_SLUG || "newman";
const chosen = process.env.PASSWORD || "";
if (chosen && emails.length !== 1) { console.error("reset-password: PASSWORD can only be used with one EMAIL"); process.exit(1); }
if (chosen && (chosen.length < 12 || chosen.length > 200)) { console.error("reset-password: PASSWORD must be 12 to 200 characters (the portal's rule)"); process.exit(1); }

const c = new pg.Client({ connectionString: need("DIGI_MIGRATE_URL") });
await c.connect();
const lines = [];
try {
  await c.query("begin");
  const t = (await c.query("select id from tenants where slug = $1", [slug])).rows[0];
  if (!t) throw new Error(`no organisation with slug "${slug}" (set TENANT_SLUG)`);
  await c.query("select set_config('app.tenant_id', $1, true)", [t.id]);
  for (const email of emails) {
    const u = (await c.query("select id, status from users where tenant_id = $1 and lower(email) = $2", [t.id, email])).rows[0];
    if (!u) throw new Error(`no account ${email}; nothing was changed`);
    const pw = chosen || randomBytes(15).toString("base64url");
    await c.query("update users set password_hash = $2, must_change_password = $3, failed_attempts = 0, locked_until = null, updated_at = now() where id = $1", [u.id, await hash(pw), !chosen]);
    await c.query("delete from sessions where user_id = $1", [u.id]);
    await c.query("insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, source, result, metadata) values ($1, null, 'user.reset_password', 'user', $2, 'server-script', 'ok', '{}'::jsonb)", [t.id, u.id]);
    lines.push(`${email}  ${pw}   (temporary; must be changed at first sign-in)${u.status === "active" ? "" : `  NOTE: account is ${u.status}`}`);
  }
  await c.query("commit");
} catch (e) {
  await c.query("rollback");
  console.error("reset-password:", e.message);
  process.exit(1);
} finally { await c.end(); }

if (chosen) {
  console.log(`reset-password: ${emails[0]} now signs in with the password you set.${lines[0].includes("NOTE:") ? lines[0].slice(lines[0].indexOf("  NOTE:")) : ""}`);
  process.exit(0);
}
const file = path.join(process.env.DATA_DIR || "/data", "reset-password.txt");
fs.writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
console.log(`reset-password: ${lines.length} account(s) reset. Temporary password(s) are in ${file} (read once, then delete it).`);
