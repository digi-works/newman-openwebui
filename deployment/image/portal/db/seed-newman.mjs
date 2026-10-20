// Seeds the Newman tenant, its hostnames and the first users. Safe to re-run: existing rows are left alone.
// New accounts get random passwords, written to .seed-credentials.txt (never printed). Delete that file after use.
// Usage: node db/seed-newman.mjs   (reads DIGI_MIGRATE_URL; run where the database is reachable)
import fs from "node:fs";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import pg from "pg";

const N = 131072, R = 8, P = 1, KEYLEN = 64;
const hash = (pw) => new Promise((resolve, reject) => {
  const salt = randomBytes(16);
  scryptCb(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 256 * N * R }, (e, key) =>
    e ? reject(e) : resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`));
});
const password = () => randomBytes(15).toString("base64url");

const HOSTS = ["localhost", "127.0.0.1", "digi.simplihire.ai", "newman.digiworks.ai"];
const USERS = [
  { email: "koneru.sridhar@gmail.com", name: "Sridhar Koneru", role: "Admin", mustChange: true },
  { email: "admin.test@newmanu.edu", name: "Test Admin", role: "Admin", mustChange: false },
  { email: "student.test@newmanu.edu", name: "Test Student", role: "Student", mustChange: false },
  { email: "faculty.test@newmanu.edu", name: "Test Faculty", role: "Faculty", mustChange: false },
  { email: "staff.test@newmanu.edu", name: "Test Staff", role: "Staff", mustChange: false },
];

const c = new pg.Client({ connectionString: process.env.DIGI_MIGRATE_URL });
await c.connect();
const lines = [];
try {
  await c.query("begin");
  let t = (await c.query("select id from tenants where slug = 'newman'")).rows[0];
  if (!t) t = (await c.query("insert into tenants (slug, name) values ('newman', 'Newman University') returning id")).rows[0];
  await c.query("select set_config('app.tenant_id', $1, true)", [t.id]); // row-level security applies to the owner too
  await c.query("select ensure_default_roles($1)", [t.id]); // Student, Faculty, Staff, Admin with their default permissions
  for (const h of HOSTS) await c.query("insert into tenant_hostnames (hostname, tenant_id) values ($1, $2) on conflict do nothing", [h, t.id]);
  for (const u of USERS) {
    if ((await c.query("select 1 from users where tenant_id = $1 and email = $2", [t.id, u.email])).rows[0]) continue;
    const pw = password();
    const id = (await c.query(
      "insert into users (tenant_id, email, name, password_hash, must_change_password) values ($1, $2, $3, $4, $5) returning id",
      [t.id, u.email, u.name, await hash(pw), u.mustChange],
    )).rows[0].id;
    await c.query("insert into user_roles (tenant_id, user_id, role_id) select $1, $2, id from roles where lower(name) = lower($3)", [t.id, id, u.role]);
    lines.push(`${u.role.padEnd(8)} ${u.email.padEnd(30)} ${pw}${u.mustChange ? "   (temporary, must be changed at first sign-in)" : ""}`);
  }
  await c.query("commit");
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}
if (lines.length) {
  fs.writeFileSync(".seed-credentials.txt", "Newman test accounts. Delete this file after you have used it.\n\n" + lines.join("\n") + "\n");
  console.log(`seed: created ${lines.length} user(s); passwords written to .seed-credentials.txt`);
} else {
  console.log("seed: nothing to create");
}
