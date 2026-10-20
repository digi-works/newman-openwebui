// Clean first-time setup for a new deployment: ONE organisation, its hostnames, the default roles and ONE Admin. No pilot users, rooms or bookings.
// Safe to re-run: anything that exists is left alone. The Admin's temporary password is written to $DATA_DIR/first-admin.txt (never printed); read it once, then delete it.
// Env: DIGI_MIGRATE_URL, TENANT_SLUG, TENANT_NAME, TENANT_HOSTNAMES (comma separated), ADMIN_EMAIL, ADMIN_NAME
import fs from "node:fs";
import path from "node:path";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import pg from "pg";

const N = 131072, R = 8, P = 1, KEYLEN = 64;
const hash = (pw) => new Promise((resolve, reject) => {
  const salt = randomBytes(16);
  scryptCb(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R }, (e, key) =>
    e ? reject(e) : resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`));
});
const need = (k) => { const v = (process.env[k] || "").trim(); if (!v) { console.error(`bootstrap: ${k} is not set`); process.exit(1); } return v; };
const slug = need("TENANT_SLUG"), name = need("TENANT_NAME"), email = need("ADMIN_EMAIL").toLowerCase(), adminName = process.env.ADMIN_NAME?.trim() || "Administrator";
const hosts = need("TENANT_HOSTNAMES").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

const c = new pg.Client({ connectionString: need("DIGI_MIGRATE_URL") });
await c.connect();
let line = "";
try {
  await c.query("begin");
  let t = (await c.query("select id from tenants where slug = $1", [slug])).rows[0];
  if (!t) t = (await c.query("insert into tenants (slug, name) values ($1, $2) returning id", [slug, name])).rows[0];
  await c.query("select set_config('app.tenant_id', $1, true)", [t.id]);
  await c.query("select ensure_default_roles($1)", [t.id]);
  for (const h of hosts) await c.query("insert into tenant_hostnames (hostname, tenant_id) values ($1, $2) on conflict do nothing", [h, t.id]);
  if (!(await c.query("select 1 from users where tenant_id = $1 and email = $2", [t.id, email])).rows[0]) {
    const pw = randomBytes(15).toString("base64url");
    const id = (await c.query("insert into users (tenant_id, email, name, password_hash, must_change_password) values ($1, $2, $3, $4, true) returning id", [t.id, email, adminName, await hash(pw)])).rows[0].id;
    await c.query("insert into user_roles (tenant_id, user_id, role_id) select $1, $2, id from roles where lower(name) = 'admin'", [t.id, id]);
    line = `Admin ${email}  ${pw}   (temporary; you must change it at first sign-in)\n`;
  }
  await c.query("commit");
} catch (e) { await c.query("rollback"); throw e; } finally { await c.end(); }
if (line) {
  const file = path.join(process.env.DATA_DIR || "/data", "first-admin.txt");
  fs.writeFileSync(file, line, { mode: 0o600 });
  console.log(`bootstrap: organisation "${name}" ready; first Admin created. Password is in ${file} (read it once, then delete it).`);
} else console.log(`bootstrap: organisation "${name}" ready; Admin ${email} already exists, nothing created.`);
