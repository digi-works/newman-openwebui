// Creates a platform operator with a random password and writes "email  password" to STDOUT (redirect it to a file; it is never logged).
// Usage: docker compose exec -T studio node db/studio-seed-operator.mjs <email> "<name>" <operator|platform_admin> > .studio-credentials.txt
// The operator is asked to set up two-factor sign-in the first time they sign in.
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import pg from "pg";

const [email, name, role] = process.argv.slice(2);
if (!email || !name || !["operator", "platform_admin"].includes(role)) { console.error("usage: <email> <name> <operator|platform_admin>"); process.exit(1); }
const N = 131072, R = 8, P = 1;
const hash = (pw) => new Promise((resolve, reject) => {
  const salt = randomBytes(16);
  scryptCb(pw, salt, 64, { N, r: R, p: P, maxmem: 256 * N * R }, (e, key) => (e ? reject(e) : resolve(`scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`)));
});
const password = randomBytes(15).toString("base64url");
const c = new pg.Client({ connectionString: process.env.STUDIO_MIGRATE_URL });
await c.connect();
try {
  const r = await c.query("insert into platform_operators (email, name, role, password_hash) values ($1, $2, $3, $4) on conflict (email) do nothing returning id", [email.toLowerCase(), name, role, await hash(password)]);
  if (!r.rows[0]) { console.error("an operator with that email already exists"); process.exit(2); }
  await c.query("insert into studio_audit_events (actor, action, entity_type, entity_id, metadata) values ('system', 'platform.operator.create', 'operator', $1, $2)", [r.rows[0].id, JSON.stringify({ email, role, via: "seed script" })]);
  console.log(`${email.toLowerCase()}  ${password}`);
} finally {
  await c.end();
}
