// Tenant isolation: tenant A can never read or change tenant B's rows, even by guessing ids, and the app role cannot bypass it.
// Run: DIGI_MIGRATE_URL=<owner url> DIGI_DATABASE_URL=<app url> node --test db/tests/
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const owner = new pg.Client({ connectionString: process.env.DIGI_MIGRATE_URL });
const app = new pg.Pool({ connectionString: process.env.DIGI_DATABASE_URL, max: 2 });
const sha = (s) => createHash("sha256").update(s).digest("hex");
const slugA = "isoa" + randomBytes(3).toString("hex"), slugB = "isob" + randomBytes(3).toString("hex");
let A, B, userA, userB, ctxHashB;

/** Runs sql as the app role with the tenant set the way the portal does it. */
async function as(tenantId, fn) {
  const c = await app.connect();
  try {
    await c.query("begin");
    if (tenantId) await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

async function ownerIn(tenantId, sql, params) {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const r = await owner.query(sql, params);
    await owner.query("commit");
    return r;
  } catch (e) { await owner.query("rollback"); throw e; }
}

before(async () => {
  await owner.connect();
  A = (await owner.query("insert into tenants (slug, name) values ($1, 'Iso A') returning id", [slugA])).rows[0].id;
  B = (await owner.query("insert into tenants (slug, name) values ($1, 'Iso B') returning id", [slugB])).rows[0].id;
  userA = (await ownerIn(A, "insert into users (tenant_id, email, name, password_hash) values ($1, 'a@iso.test', 'A', 'x') returning id", [A])).rows[0].id;
  userB = (await ownerIn(B, "insert into users (tenant_id, email, name, password_hash) values ($1, 'b@iso.test', 'B', 'x') returning id", [B])).rows[0].id;
  await ownerIn(B, "insert into sessions (token_hash, tenant_id, user_id, expires_at) values ('hashB', $1, $2, now() + interval '1 day')", [B, userB]);
  await ownerIn(B, "insert into audit_events (tenant_id, user_id, action) values ($1, $2, 'test')", [B, userB]);
  ctxHashB = sha("local:exec-b-" + randomBytes(8).toString("hex"));
  await ownerIn(B, "insert into execution_contexts (id_hash, tenant_id, user_id, expires_at) values ($1, $2, $3, now() + interval '5 minutes')", [ctxHashB, B, userB]);
});

after(async () => {
  for (const [t, u] of [[A, userA], [B, userB]]) {
    await ownerIn(t, "delete from execution_contexts where tenant_id = $1", [t]);
    await ownerIn(t, "delete from sessions where tenant_id = $1", [t]);
    await ownerIn(t, "delete from audit_events where tenant_id = $1", [t]).catch(() => undefined);
    await ownerIn(t, "delete from users where id = $1", [u]);
  }
  await owner.query("delete from tenants where id in ($1, $2)", [A, B]);
  await owner.end();
  await app.end();
});

describe("reading", () => {
  for (const table of ["users", "sessions", "audit_events", "execution_contexts", "user_identities", "roles", "role_permissions", "user_roles", "conversations", "messages", "user_favorites", "buildings", "rooms", "events", "event_occurrences", "bookings", "booking_events", "notifications", "tenant_capabilities", "ai_runs", "tool_calls", "pending_actions", "tenant_secrets", "service_identities", "jobs", "approvals", "mcp_servers", "mcp_tools", "user_memories", "tenant_app_capabilities"]) {
    it(`tenant A sees none of tenant B's ${table}`, async () => {
      const rows = await as(A, (c) => c.query(`select tenant_id from ${table}`));
      assert.ok(rows.rows.every((r) => r.tenant_id === A), `${table} leaked rows from another tenant`);
    });
  }
  it("tenant A cannot fetch tenant B's user by id", async () => {
    assert.equal((await as(A, (c) => c.query("select 1 from users where id = $1", [userB]))).rowCount, 0);
  });
  it("tenant A cannot fetch tenant B's session by token hash", async () => {
    assert.equal((await as(A, (c) => c.query("select 1 from sessions where token_hash = 'hashB'"))).rowCount, 0);
  });
  it("with no tenant set, nothing is visible", async () => {
    assert.equal((await as(null, (c) => c.query("select 1 from users"))).rowCount, 0);
    assert.equal((await as(null, (c) => c.query("select 1 from sessions"))).rowCount, 0);
  });
  it("a bad tenant value matches nothing", async () => {
    assert.equal((await as("00000000-0000-0000-0000-000000000000", (c) => c.query("select 1 from users"))).rowCount, 0);
  });
});

describe("roles", () => {
  it("tenant A cannot see, edit or use tenant B's roles", async () => {
    const roleB = (await ownerIn(B, "insert into roles (tenant_id, name) values ($1, 'B only') returning id", [B])).rows[0].id;
    await ownerIn(B, "insert into role_permissions (tenant_id, role_id, permission_code) values ($1, $2, 'chat.use')", [B, roleB]);
    assert.equal((await as(A, (c) => c.query("select 1 from roles where id = $1", [roleB]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("update roles set name = 'x' where id = $1", [roleB]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("delete from role_permissions where role_id = $1", [roleB]))).rowCount, 0);
    await assert.rejects(as(A, (c) => c.query("insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)", [A, userA, roleB])), /foreign key/);
    await assert.rejects(as(A, (c) => c.query("insert into role_permissions (tenant_id, role_id, permission_code) values ($1, $2, 'chat.use')", [B, roleB])), /row-level security/);
    await ownerIn(B, "delete from role_permissions where role_id = $1", [roleB]);
    await ownerIn(B, "delete from roles where id = $1", [roleB]);
  });
  it("the app role cannot change the permission catalog", async () => {
    await assert.rejects(app.query("insert into permissions (code, module, action, label) values ('x.y', 'X', 'y', 'Y')"), /permission denied/);
    await assert.rejects(app.query("update permissions set label = 'x'"), /permission denied/);
  });
});

describe("rooms and bookings", () => {
  it("tenant A cannot see or use tenant B's rooms, and cannot attach a building across tenants", async () => {
    const bld = (await ownerIn(B, "insert into buildings (tenant_id, name) values ($1, 'IsoB Hall') returning id", [B])).rows[0].id;
    const room = (await ownerIn(B, "insert into rooms (tenant_id, building_id, name, display_name, capacity) values ($1, $2, 'R1', 'IsoB R1', 10) returning id", [B, bld])).rows[0].id;
    assert.equal((await as(A, (c) => c.query("select 1 from rooms where id = $1", [room]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("update rooms set capacity = 99 where id = $1", [room]))).rowCount, 0);
    await assert.rejects(as(A, (c) => c.query("insert into rooms (tenant_id, building_id, name, display_name, capacity) values ($1, $2, 'X', 'X', 5)", [A, bld])), /foreign key/);
    await ownerIn(B, "delete from rooms where id = $1", [room]);
    await ownerIn(B, "delete from buildings where id = $1", [bld]);
  });
});

describe("conversations", () => {
  it("tenant A cannot see, edit or add to tenant B's conversations", async () => {
    const conv = (await ownerIn(B, "insert into conversations (tenant_id, user_id, agent_id) values ($1, $2, 'digi') returning id", [B, userB])).rows[0].id;
    await ownerIn(B, "insert into messages (tenant_id, conversation_id, user_id, role, content) values ($1, $2, $3, 'user', 'secret')", [B, conv, userB]);
    assert.equal((await as(A, (c) => c.query("select 1 from conversations where id = $1", [conv]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("select 1 from messages where conversation_id = $1", [conv]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("update messages set content = 'x' where conversation_id = $1", [conv]))).rowCount, 0);
    assert.equal((await as(A, (c) => c.query("delete from conversations where id = $1", [conv]))).rowCount, 0);
    // a tenant A user cannot attach a message to tenant B's conversation, even with tenant A's own ids
    await assert.rejects(as(A, (c) => c.query("insert into messages (tenant_id, conversation_id, user_id, role, content) values ($1, $2, $3, 'user', 'x')", [A, conv, userA])), /foreign key/);
    await assert.rejects(as(A, (c) => c.query("insert into conversations (tenant_id, user_id, agent_id) values ($1, $2, 'digi')", [A, userB])), /foreign key/);
    await ownerIn(B, "delete from conversations where id = $1", [conv]);
  });
});

describe("writing", () => {
  it("tenant A cannot update tenant B's user", async () => {
    const r = await as(A, (c) => c.query("update users set name = 'hacked' where id = $1", [userB]));
    assert.equal(r.rowCount, 0);
    assert.equal((await ownerIn(B, "select name from users where id = $1", [userB])).rows[0].name, "B");
  });
  it("tenant A cannot delete tenant B's user", async () => {
    assert.equal((await as(A, (c) => c.query("delete from users where id = $1", [userB]))).rowCount, 0);
  });
  it("tenant A cannot insert a row that belongs to tenant B", async () => {
    await assert.rejects(as(A, (c) => c.query("insert into users (tenant_id, email, name, password_hash) values ($1, 'x@iso.test', 'X', 'x')", [B])), /row-level security/);
  });
  it("tenant A cannot move its own user into tenant B", async () => {
    await assert.rejects(as(A, (c) => c.query("update users set tenant_id = $1 where id = $2", [B, userA])), /row-level security/);
  });
});

describe("the app role", () => {
  it("cannot bypass row-level security and is not a superuser", async () => {
    const r = (await app.query("select rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0];
    assert.deepEqual(r, { rolbypassrls: false, rolsuper: false });
  });
  it("cannot change tenants or hostnames", async () => {
    await assert.rejects(app.query("update tenants set name = 'x'"), /permission denied/);
    await assert.rejects(app.query("insert into tenant_hostnames (hostname, tenant_id) values ('evil.test', $1)", [A]), /permission denied/);
  });
  it("cannot edit or delete audit events", async () => {
    await assert.rejects(as(B, (c) => c.query("update audit_events set action = 'x'")), /permission denied/);
    await assert.rejects(as(B, (c) => c.query("delete from audit_events")), /permission denied/);
  });
  it("can resolve an execution context only with the exact secret handle", async () => {
    const ok = await app.query("select * from resolve_execution_context($1)", [ctxHashB]);
    assert.equal(ok.rows[0]?.user_id, userB);
    const bad = await app.query("select * from resolve_execution_context($1)", [sha("guess")]);
    assert.equal(bad.rowCount, 0);
  });
  it("expired execution contexts do not resolve", async () => {
    const h = sha("expired-" + randomBytes(4).toString("hex"));
    await ownerIn(B, "insert into execution_contexts (id_hash, tenant_id, user_id, expires_at) values ($1, $2, $3, now() - interval '1 minute')", [h, B, userB]);
    assert.equal((await app.query("select * from resolve_execution_context($1)", [h])).rowCount, 0);
  });
});
