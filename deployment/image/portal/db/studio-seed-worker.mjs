// Puts a Worker spec into Studio as a DRAFT (version 1), written by the system, not by a person. Nothing is reviewed or published: an operator still has to
// read it, review it and publish it. Used to leave the pilot with the Room Booking Worker ready to be reviewed.
// Usage: docker compose exec -T studio sh -c 'node db/studio-seed-worker.mjs' < studio/workers/room-booking.json
import { createHash } from "node:crypto";
import pg from "pg";

const canonical = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
  : "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const spec = JSON.parse(raw);
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(spec.id || "")) { console.error("the spec needs a valid id"); process.exit(1); }
const hash = createHash("sha256").update(canonical(spec)).digest("hex");

const c = new pg.Client({ connectionString: process.env.STUDIO_MIGRATE_URL });
await c.connect();
try {
  await c.query("begin");
  if ((await c.query("select 1 from studio_workers where id = $1", [spec.id])).rows[0]) { console.log(`${spec.id} already exists; nothing changed`); await c.query("rollback"); process.exit(0); }
  await c.query("insert into studio_workers (id, name) values ($1, $2)", [spec.id, spec.name]);
  await c.query("insert into studio_worker_versions (worker_id, version, spec, spec_hash, source) values ($1, 1, $2, $3, 'manual')", [spec.id, JSON.stringify(spec), hash]);
  await c.query("insert into studio_audit_events (actor, action, entity_type, entity_id, metadata) values ('system', 'worker.draft.save', 'worker', $1, $2)", [`${spec.id}@1`, JSON.stringify({ via: "seed script" })]);
  await c.query("commit");
  console.log(`${spec.id} saved as a draft (version 1). Review and publish it in Studio.`);
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error(e.message); process.exitCode = 1;
} finally {
  await c.end();
}
