import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MAIL_FROM"]) delete process.env[k];
const { getTool, allTools, ToolError } = await import("@/lib/tools/registry");
const { authorize } = await import("@/lib/authority");

const repo = new URL("../../../", import.meta.url); // deployment/
const read = (p: string) => readFileSync(new URL(p, repo), "utf8");
const actor = { id: "u1", tenantId: "t1", email: "sam@x.edu", name: "Sam", permissions: ["bookings.create"] };

describe("the events.invite tool", () => {
  const tool = getTool("events.invite");

  test("is registered as a write tool (confirm card), guarded by bookings.create, carried by digi_events", () => {
    assert.ok(tool);
    assert.equal(tool.risk, "write");
    assert.equal(tool.permission, "bookings.create");
    assert.equal(tool.owuiToolId, "digi_events");
    assert.equal(typeof tool.prepare, "function");
    assert.equal(typeof tool.commit, "function");
  });

  test("with email not set up, preparing it is refused with a message the person can act on", async () => {
    await assert.rejects(tool!.prepare!(actor, { title: "Review", date: "2030-01-01", start_time: "14:00", end_time: "15:00", attendees: "a@x.edu" }),
      (e: unknown) => e instanceof ToolError && e.status === 409 && /email is not set up/.test(e.message));
  });

  test("every tool still declares a permission and a module (the registry's own check ran at import)", () => {
    for (const t of allTools()) assert.ok(t.permission && t.owuiToolId, t.id);
  });
});

describe("the events.search tool", () => {
  const tool = getTool("events.search");
  // The Faculty role as ensure_default_roles creates it (0006_rooms_bookings.sql).
  const faculty = { kind: "user" as const, id: "f1", permissions: ["chat.use", "bookings.view_own", "bookings.create", "bookings.update", "bookings.delete"] };
  const allowed = (id: string) => {
    const t = getTool(id)!;
    return authorize(faculty, { name: t.id, permission: t.permission, risk: t.risk, policy: "allow", enabled: true }).decision !== "DENY";
  };

  test("is a read tool guarded by chat.use, carried by digi_events", () => {
    assert.ok(tool);
    assert.equal(tool.risk, "read");
    assert.equal(tool.permission, "chat.use");
    assert.equal(tool.owuiToolId, "digi_events");
    assert.equal(typeof tool.run, "function");
  });

  test("a bad date is refused with a message the person can act on", async () => {
    await assert.rejects(tool!.run!(actor, { from_date: "next week" }), (e: unknown) => e instanceof ToolError && /YYYY-MM-DD/.test(e.message));
  });

  test("Faculty can look up events and request rooms, but not see the approval queue", () => {
    for (const id of ["events.search", "rooms.form", "rooms.search", "bookings.request", "bookings.list", "bookings.cancel"]) assert.ok(allowed(id), id);
    assert.equal(allowed("approvals.queue"), false);
  });
});

describe("the pieces that must agree with each other", () => {
  test("the migration registers events.invite exactly as the code declares it", () => {
    const sql = read("image/portal/db/migrations/0014_booking_emails.sql");
    assert.match(sql, /\('events\.invite', 'tool', '[^']+', '[^']+', 'write', 'bookings\.create', 'digi_events'\)/);
  });
  test("the migration creates notification_settings with row-level security for the app role", () => {
    const sql = read("image/portal/db/migrations/0014_booking_emails.sql");
    for (const s of ["create table notification_settings", "enable row level security", "force row level security", "create policy tenant_isolation on notification_settings", "grant select, insert, update, delete on notification_settings to digi_app"]) assert.ok(sql.includes(s), s);
  });
  test("the migration registers events.search exactly as the code declares it", () => {
    const sql = read("image/portal/db/migrations/0016_events_search.sql");
    assert.match(sql, /\('events\.search', 'tool', '[^']+', '[^']+', 'read', 'chat\.use', 'digi_events'\)/);
  });
  test("the Open WebUI module calls events.search with the argument names the tool reads", () => {
    const py = read("aws/owui-tools/digi_events.py");
    assert.match(py, /\/api\/internal\/tools\/events\.search/);
    for (const k of ["from_date", "to_date", "query", "include_classes"]) assert.match(py, new RegExp(`"${k}": ${k}`), k);
  });
  test("the Open WebUI module calls events.invite with the argument names the tool reads", () => {
    const py = read("aws/owui-tools/digi_events.py");
    assert.match(py, /\/api\/internal\/tools\/events\.invite/);
    for (const k of ["title", "date", "start_time", "end_time", "attendees", "location", "description"]) assert.match(py, new RegExp(`"${k}": ${k}`), k);
  });
  test("the installer knows digi_events, and new Digi models get it", () => {
    assert.match(read("aws/scripts/install-digi-tools.py"), /\("digi_events", "Digi Events", "digi_events\.py"/);
    assert.match(read("aws/scripts/create-digi.py"), /"toolIds": \[[^\]]*"digi_events"/);
  });
  test("the portal sends the same HSTS and CSP as the Caddyfile (QA DEF-06)", () => {
    const caddy = read("aws/Caddyfile"), next = read("image/portal/next.config.ts");
    const fromCaddy = (k: string) => caddy.match(new RegExp(`${k} "([^"]+)"`))?.[1];
    assert.equal(next.match(/const HSTS = "([^"]+)"/)?.[1], fromCaddy("Strict-Transport-Security"));
    assert.equal(next.match(/const CSP = `([^`]+)`/)?.[1].replace(/\$\{[^}]+\}/, ""), fromCaddy("Content-Security-Policy"));
  });
  test("docker-compose passes every email setting the portal reads", () => {
    const compose = read("aws/docker-compose.yml");
    for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MAIL_FROM", "BOOKING_MANAGER_EMAIL"]) assert.match(compose, new RegExp(`${k}: "\\$\\{${k}:-\\}"`), k);
  });
});
