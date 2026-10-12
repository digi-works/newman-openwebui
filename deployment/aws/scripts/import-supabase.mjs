// Copies the university's buildings, rooms, events, class schedule and room bookings from the Supabase pilot database into Digi.
// Runs inside the portal container (it uses the portal's own pg module and DIGI_MIGRATE_URL), from the aws folder:
//   docker compose run --rm -v "$PWD/scripts:/import:ro" -e SUPABASE_DB_URL='postgresql://...' portal node /import/import-supabase.mjs --dry-run
// --dry-run does everything and prints the report, then rolls back. Without it the copy is committed, all or nothing.
// Safe to re-run: a row already copied (matched on its Supabase id) is left alone. Supabase is only read, never written.
// Env: SUPABASE_DB_URL (source), SOURCE_SCHEMA (default newmann), TENANT_SLUG (default newman), DIGI_MIGRATE_URL (target, set in the container).
import { createRequire } from "node:module";

const pg = createRequire((process.env.APP_DIR || "/app") + "/package.json")("pg");
pg.types.setTypeParser(1082, (v) => v); // dates stay "2026-10-12", never shifted by the container's time zone

const dryRun = process.argv.includes("--dry-run");
const need = (k) => { const v = (process.env[k] || "").trim(); if (!v) { console.error(`import: ${k} is not set`); process.exit(1); } return v; };
const schema = '"' + (process.env.SOURCE_SCHEMA || "newmann").replace(/"/g, '""') + '"';
const slug = process.env.TENANT_SLUG || "newman";

// sslmode in the URL would make pg verify Supabase's certificate against the system CAs, which fails for its own CA; encrypt without that check
const srcUrl = new URL(need("SUPABASE_DB_URL"));
for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) srcUrl.searchParams.delete(k);
const src = new pg.Client({ connectionString: srcUrl.toString(), ssl: process.env.SUPABASE_SSL === "off" ? false : { rejectUnauthorized: false } });
const dst = new pg.Client({ connectionString: need("DIGI_MIGRATE_URL") });

const report = {}, skips = [];
const bump = (k, n = 1) => (report[k] = (report[k] ?? 0) + n);
const skip = (k, why) => { bump(k); if (skips.length < 40) skips.push(`${k}: ${why}`); };
const lower = (v) => String(v ?? "").trim().toLowerCase();
const emailOf = (...vals) => vals.map(lower).find((v) => v.includes("@")) ?? null;

// start/end of a row as SQL expressions over its local date/time columns, in its own time zone (all-day rows run midnight to midnight)
const span = (r, tz) => {
  const day = r.start_date_local ?? r.date, endDay = r.end_date_local ?? day;
  if (r.starts_at_utc && r.ends_at_utc) return { sql: "$S::timestamptz, $E::timestamptz", args: [r.starts_at_utc, r.ends_at_utc] };
  if (!day) return null;
  if (r.all_day) return { sql: "($S::date)::timestamp at time zone $Z, ($E::date + 1)::timestamp at time zone $Z", args: [day, endDay], tz };
  const st = r.start_time_local ?? r.start_time, et = r.end_time_local ?? r.end_time;
  if (!st || !et) return null;
  return { sql: "($S::date + $ST::time) at time zone $Z, ($E::date + $ET::time) at time zone $Z", args: [day, endDay], times: [st, et], tz };
};

// insert one row inside a savepoint, so a bad row is reported and skipped instead of failing the whole copy
async function tryInsert(sql, args) {
  await dst.query("savepoint row");
  try { const r = await dst.query(sql, args); await dst.query("release savepoint row"); return { row: r.rows[0] }; }
  catch (e) { await dst.query("rollback to savepoint row"); return { error: e }; }
}

// builds "insert ... values (..., <span>)" with numbered placeholders for the span's pieces
function withSpan(prefix, cols, vals, s) {
  const args = [...vals];
  const at = (v) => { args.push(v); return "$" + args.length; };
  let expr = s.sql.replace("$S", at(s.args[0])).replace("$E", at(s.args[1]));
  if (s.times) expr = expr.replace("$ST", at(s.times[0])).replace("$ET", at(s.times[1]));
  if (s.tz) { const z = at(s.tz); expr = expr.replaceAll("$Z", z); }
  return { sql: `${prefix} (${cols.join(", ")}) values (${vals.map((_, i) => "$" + (i + 1)).join(", ")}, ${expr}) returning id`, args };
}

await src.connect();
await dst.connect();
try {
  await src.query("begin isolation level repeatable read read only"); // one consistent snapshot of Supabase, and no writes possible
  await dst.query("begin");
  const tenant = (await dst.query("select id, configuration->>'timezone' as tz from tenants where slug = $1", [slug])).rows[0];
  if (!tenant) throw new Error(`organisation "${slug}" not found; run step 4 (bootstrap-tenant) first, or set TENANT_SLUG`);
  const T = tenant.id, TZ = tenant.tz || "America/Chicago";
  await dst.query("select set_config('app.tenant_id', $1, true)", [T]);
  const existing = async (table, legacy) => (await dst.query(`select id from ${table} where tenant_id = $1 and legacy_id = $2`, [T, legacy])).rows[0]?.id;

  // buildings: a building whose name already exists in Digi is reused rather than duplicated
  const bMap = new Map();
  for (const b of (await src.query(`select id, name, abbreviation from ${schema}.buildings order by name`)).rows) {
    let id = await existing("buildings", b.id);
    if (id) bump("buildings_already_there");
    else {
      const r = await tryInsert("insert into buildings (tenant_id, legacy_id, name, abbreviation) values ($1, $2, $3, $4) returning id", [T, b.id, b.name || b.abbreviation || b.id, b.abbreviation ?? ""]);
      id = r.row?.id ?? (await dst.query("select id from buildings where tenant_id = $1 and name = $2", [T, b.name])).rows[0]?.id;
      if (r.row) bump("buildings");
      else if (id) bump("buildings_matched_by_name");
      else skip("buildings_skipped", `${b.id} ${r.error.message}`);
    }
    if (id) bMap.set(b.id, id);
  }

  // rooms (every Digi room belongs to a building)
  const rMap = new Map();
  for (const r of (await src.query(`select id, name, display_name, type, capacity, features, building_id, reservable, availability_searchable, access_notes from ${schema}.rooms order by display_name`)).rows) {
    let id = await existing("rooms", r.id);
    if (id) bump("rooms_already_there");
    else {
      const bid = bMap.get(r.building_id);
      if (!bid) { skip("rooms_skipped", `${r.id} (${r.display_name}) has no known building`); continue; }
      const ins = await tryInsert(
        `insert into rooms (tenant_id, legacy_id, building_id, name, display_name, type, capacity, features, reservable, searchable, access_notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) returning id`,
        [T, r.id, bid, r.name || r.display_name, r.display_name || r.name, r.type || "room", Math.max(1, r.capacity || 1),
         JSON.stringify(r.features ?? {}), r.reservable !== false, r.availability_searchable !== false, r.access_notes]);
      if (!ins.row) { skip("rooms_skipped", `${r.id} (${r.display_name}) ${ins.error.message}`); continue; }
      id = ins.row.id; bump("rooms");
    }
    rMap.set(r.id, id);
  }

  // events and courses both become Digi events; their dated occurrences hold rooms, so room search treats those times as busy
  const eMap = new Map();
  const addEvent = async (legacy, name, type) => {
    let id = await existing("events", legacy);
    if (id) bump("events_already_there");
    else {
      const ins = await tryInsert("insert into events (tenant_id, legacy_id, name, type) values ($1, $2, $3, $4) returning id", [T, legacy, name, type]);
      if (!ins.row) return skip("events_skipped", `${legacy} ${ins.error.message}`);
      id = ins.row.id; bump(type === "course" ? "courses" : "events");
    }
    eMap.set(legacy, id);
  };
  for (const e of (await src.query(`select id, title, category, kind::text as kind, archived_at from ${schema}.events`)).rows) {
    if (e.archived_at) { bump("events_skipped_archived"); continue; }
    await addEvent(e.id, e.title || "Untitled event", e.category || e.kind || "event");
  }
  for (const c of (await src.query(`select id, department, course_number, section, title from ${schema}.courses`)).rows) {
    const code = [c.department, c.course_number].filter(Boolean).join(" ") + (c.section ? `-${c.section}` : "");
    await addEvent("course:" + c.id, [code, c.title].filter(Boolean).join(": ") || "Class", "course");
  }

  const addOccurrence = async (legacy, eventLegacy, o, status, location) => {
    if (await existing("event_occurrences", legacy)) return bump("occurrences_already_there");
    const eid = eMap.get(eventLegacy);
    if (!eid) return bump("occurrences_skipped_no_event"); // its event was archived or not copied
    const s = span(o, o.timezone || TZ);
    if (!s) return skip("occurrences_skipped", `${legacy} has no date or times`);
    const q = withSpan("insert into event_occurrences", ["tenant_id", "legacy_id", "event_id", "room_id", "status", "location_text", "starts_at", "ends_at"],
      [T, legacy, eid, rMap.get(o.room_id) ?? null, status, location], s);
    const ins = await tryInsert(q.sql, q.args);
    if (ins.row) bump("occurrences"); else skip("occurrences_skipped", `${legacy} ${ins.error.message}`);
  };
  for (const o of (await src.query(`select *, status::text as status from ${schema}.event_occurrences`)).rows)
    await addOccurrence(o.id, o.event_id, o, o.cancelled_at || ["cancelled", "canceled"].includes(lower(o.status)) ? "cancelled" : "confirmed", o.location_text);
  for (const o of (await src.query(`select * from ${schema}.course_occurrences`)).rows)
    await addOccurrence("course:" + o.id, "course:" + o.course_id, o, "confirmed", o.location);

  // bookings: approved ones first, so when two overlap the approved one keeps the room and the other is reported
  const users = new Map((await dst.query("select id, email from users where tenant_id = $1", [T])).rows.map((u) => [u.email, u.id]));
  const STATUS = { approved: "approved", confirmed: "approved", booked: "approved", declined: "declined", rejected: "declined", denied: "declined",
                   cancelled: "cancelled", canceled: "cancelled", expired: "expired", pending: "pending", requested: "pending", "": "pending" };
  const bookings = (await src.query(`select * from ${schema}.room_booking_details
    order by case lower(coalesce(status, '')) when 'approved' then 0 when 'confirmed' then 0 when 'booked' then 0 else 1 end, created_at`)).rows;
  for (const b of bookings) {
    if (await existing("bookings", b.id)) { bump("bookings_already_there"); continue; }
    const rid = rMap.get(b.room_id);
    if (!rid) { skip("bookings_skipped", `${b.id} room ${b.room_id} was not copied`); continue; }
    const s = span(b, b.timezone || TZ);
    if (!s) { skip("bookings_skipped", `${b.id} has no date or times`); continue; }
    let status = STATUS[lower(b.status)];
    if (!status) { status = "pending"; bump(`bookings_unknown_status_${lower(b.status)}_as_pending`); }
    let notes = {};
    try { notes = JSON.parse(b.notes ?? "{}") || {}; } catch { notes = { decisionNote: b.notes }; }
    const email = emailOf(b.booked_by_id, b.booked_by_user_id);
    const alnum = String(b.id).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    let ref = "BK-" + alnum.slice(-8);
    if ((await dst.query("select 1 from bookings where tenant_id = $1 and ref = $2", [T, ref])).rows[0]) ref = "BK-" + alnum.slice(-20);
    const decided = status === "approved" || status === "declined";
    const q = withSpan("insert into bookings",
      ["tenant_id", "legacy_id", "ref", "room_id", "requester_user_id", "requester_name", "requester_email", "purpose", "description", "attendees", "needs",
       "status", "expires_at", "decided_at", "decided_by_user_id", "decision_reason", "created_at", "starts_at", "ends_at"],
      [T, b.id, ref, rid, users.get(email) ?? null, b.booked_by_name || email || "Unknown", email || "unknown",
       b.title || b.purpose || "Room booking", [b.description, b.title && b.purpose ? `Purpose: ${b.purpose}` : ""].filter(Boolean).join("\n"),
       Math.max(1, b.attendee_count || 1), JSON.stringify(Array.isArray(notes.needs) ? notes.needs : []), status,
       status === "pending" ? new Date(Date.now() + 7 * 864e5) : null, decided ? b.approval_date : null,
       decided ? users.get(emailOf(b.approved_by)) ?? null : null, notes.decisionNote ?? null, b.created_at ?? new Date()], s);
    const ins = await tryInsert(q.sql, q.args);
    if (ins.row) bump("bookings");
    else if (ins.error.code === "23P01") skip("bookings_skipped_overlap", `${b.id} (${b.title || b.purpose}) overlaps a booking already in that room`);
    else skip("bookings_skipped", `${b.id} ${ins.error.message}`);
  }

  if (dryRun) { await dst.query("rollback"); console.log("DRY RUN: nothing was written. This is what a real run would do:"); }
  else { await dst.query("commit"); console.log("import finished:"); }
  console.log(JSON.stringify(report, null, 1));
  if (skips.length) console.log("skipped rows (first 40):\n  " + skips.join("\n  "));
} catch (e) {
  await dst.query("rollback").catch(() => undefined);
  console.error("import failed, nothing was written:", e.message);
  process.exitCode = 1;
} finally {
  await src.query("rollback").catch(() => undefined);
  await src.end();
  await dst.end();
}
