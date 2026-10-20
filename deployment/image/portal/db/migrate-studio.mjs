// Applies db/studio-migrations/*.sql to the platform realm's database, once each, as studio_owner. Safe to run on every start.
// Usage: node db/migrate-studio.mjs   (reads STUDIO_MIGRATE_URL; a customer stack does not set it, so this does nothing there)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.STUDIO_MIGRATE_URL;
if (!url) {
  console.log("migrate-studio: STUDIO_MIGRATE_URL not set, skipping");
  process.exit(0);
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "studio-migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

async function connect() {
  for (let i = 0; i < 30; i++) {
    const c = new pg.Client({ connectionString: url });
    try { await c.connect(); return c; } catch (e) {
      if (i === 29) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const client = await connect();
try {
  await client.query("select pg_advisory_lock(727002)");
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    await client.query("begin");
    try {
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log("migrate-studio: applied", f);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`studio migration ${f} failed: ${e.message}`);
    }
  }
  console.log("migrate-studio: up to date");
} finally {
  await client.query("select pg_advisory_unlock(727002)").catch(() => undefined);
  await client.end();
}
