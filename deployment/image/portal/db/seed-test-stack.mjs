// Seeds the platform test stack (database digitest): one synthetic tenant, role personas, and a small set of invented rooms.
// Nothing here is real or copied from a customer. Safe to re-run. Only runs where DIGI_ROLE=platform.
// Personas have no usable password: the Test Lab signs them in server-side for a test run, nobody types one.
import { randomBytes } from "node:crypto";
import pg from "pg";

if (process.env.DIGI_ROLE !== "platform" || !process.env.DIGI_MIGRATE_URL) {
  console.log("seed-test-stack: not the platform instance, skipping");
  process.exit(0);
}

const HOSTS = ["localhost", "127.0.0.1", "studio.localhost"];
const PERSONAS = [
  { email: "test.student@platform.test", name: "Test Student", role: "Student" },
  { email: "test.faculty@platform.test", name: "Test Faculty", role: "Faculty" },
  { email: "test.registrar@platform.test", name: "Test Registrar", role: "Staff" },
  { email: "test.admin@platform.test", name: "Test Department Admin", role: "Admin" },
];
const BUILDINGS = [["Test Library", "TLIB"], ["Test Science Hall", "TSCI"]];
const ROOMS = [
  ["TLIB", "Study Room A", "TLIB 101", 6, ["Display", "Whiteboard"]],
  ["TLIB", "Study Room B", "TLIB 102", 8, ["Display", "Moveable seating"]],
  ["TLIB", "Seminar Room", "TLIB 210", 24, ["Projector", "Whiteboard", "Accessible entry"]],
  ["TSCI", "Lecture Hall", "TSCI 100", 80, ["Projector", "Accessible entry"]],
  ["TSCI", "Project Lab", "TSCI 210", 16, ["Display", "Moveable seating", "Whiteboard"]],
];

const c = new pg.Client({ connectionString: process.env.DIGI_MIGRATE_URL });
await c.connect();
try {
  await c.query("begin");
  let t = (await c.query("select id from tenants where slug = 'platform-test'")).rows[0];
  if (!t) t = (await c.query("insert into tenants (slug, name) values ('platform-test', 'Platform Test University') returning id")).rows[0];
  await c.query("select set_config('app.tenant_id', $1, true)", [t.id]);
  await c.query("select ensure_default_roles($1)", [t.id]);
  for (const h of HOSTS) await c.query("insert into tenant_hostnames (hostname, tenant_id) values ($1, $2) on conflict do nothing", [h, t.id]);
  for (const u of PERSONAS) {
    if ((await c.query("select 1 from users where tenant_id = $1 and email = $2", [t.id, u.email])).rows[0]) continue;
    const id = (await c.query(
      "insert into users (tenant_id, email, name, password_hash, must_change_password) values ($1, $2, $3, $4, false) returning id",
      [t.id, u.email, u.name, "disabled$" + randomBytes(24).toString("base64url")],
    )).rows[0].id;
    await c.query("insert into user_roles (tenant_id, user_id, role_id) select $1, $2, id from roles where lower(name) = lower($3)", [t.id, id, u.role]);
  }
  const bids = {};
  for (const [name, abbr] of BUILDINGS) {
    await c.query("insert into buildings (tenant_id, name, abbreviation) values ($1, $2, $3) on conflict do nothing", [t.id, name, abbr]);
    bids[abbr] = (await c.query("select id from buildings where tenant_id = $1 and name = $2", [t.id, name])).rows[0].id;
  }
  for (const [abbr, name, display, cap, tags] of ROOMS) {
    if ((await c.query("select 1 from rooms where tenant_id = $1 and display_name = $2", [t.id, display])).rows[0]) continue;
    await c.query(
      "insert into rooms (tenant_id, building_id, name, display_name, type, capacity, features) values ($1, $2, $3, $4, 'room', $5, $6::jsonb)",
      [t.id, bids[abbr], name, display, cap, JSON.stringify({ tags })],
    );
  }
  await c.query("commit");
  console.log("seed-test-stack: ok");
} catch (e) {
  await c.query("rollback");
  throw e;
} finally {
  await c.end();
}
