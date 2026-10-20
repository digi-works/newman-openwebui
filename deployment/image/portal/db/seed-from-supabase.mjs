// One-off, repeatable: copies the pilot rooms, buildings, events and bookings from the Supabase project into Digi's Postgres under the
// Newman tenant. Safe to re-run: rows are matched on legacy_id and left alone if already copied.
// Usage: node db/seed-from-supabase.mjs   (reads SUPABASE_DB_URL for the source and DIGI_MIGRATE_URL for the target)
import pg from "pg";

const src = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const dst = new pg.Client({ connectionString: process.env.DIGI_MIGRATE_URL });
await src.connect();
await dst.connect();

const TZ = "America/Chicago";
const report = {};
const bump = (k, n = 1) => (report[k] = (report[k] ?? 0) + n);

try {
  await dst.query("begin");
  const tenant = (await dst.query("select id from tenants where slug = 'newman'")).rows[0];
  if (!tenant) throw new Error("tenant newman not found; run db/seed-newman.mjs first");
  const T = tenant.id;
  await dst.query("select set_config('app.tenant_id', $1, true)", [T]);

  // buildings
  const buildings = (await src.query("select id, name, abbreviation from buildings order by name")).rows;
  const bMap = new Map();
  for (const b of buildings) {
    await dst.query("insert into buildings (tenant_id, legacy_id, name, abbreviation) values ($1, $2, $3, $4) on conflict do nothing", [T, b.id, b.name, b.abbreviation ?? ""]);
    const id = (await dst.query("select id from buildings where tenant_id = $1 and legacy_id = $2", [T, b.id])).rows[0]?.id;
    if (id) { bMap.set(b.id, id); bump("buildings"); }
  }

  // rooms
  const rooms = (await src.query("select id, name, display_name, type, capacity, features, building_id, reservable, availability_searchable, access_notes from rooms order by display_name")).rows;
  const rMap = new Map();
  for (const r of rooms) {
    const bid = bMap.get(r.building_id);
    if (!bid) { bump("rooms_skipped_no_building"); continue; }
    await dst.query(
      `insert into rooms (tenant_id, legacy_id, building_id, name, display_name, type, capacity, features, reservable, searchable, access_notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11) on conflict do nothing`,
      [T, r.id, bid, r.name, r.display_name, r.type, r.capacity ?? 1, JSON.stringify(r.features ?? {}), r.reservable !== false, r.availability_searchable !== false, r.access_notes],
    );
    const id = (await dst.query("select id from rooms where tenant_id = $1 and legacy_id = $2", [T, r.id])).rows[0]?.id;
    if (id) { rMap.set(r.id, id); bump("rooms"); }
  }

  // events and their occurrences (they hold rooms)
  const events = (await src.query("select id, name, type, capacity, building_id from events")).rows;
  const eMap = new Map();
  for (const e of events) {
    await dst.query("insert into events (tenant_id, legacy_id, building_id, name, type, capacity) values ($1, $2, $3, $4, $5, $6) on conflict do nothing", [T, e.id, bMap.get(e.building_id) ?? null, e.name, e.type, e.capacity]);
    const id = (await dst.query("select id from events where tenant_id = $1 and legacy_id = $2", [T, e.id])).rows[0]?.id;
    if (id) { eMap.set(e.id, id); bump("events"); }
  }
  const occ = (await src.query("select id, event_id, room_id, start_date_local, start_time_local, end_time_local, status, location_text from event_occurences")).rows;
  for (const o of occ) {
    const eid = eMap.get(o.event_id);
    if (!eid || !o.start_time_local || !o.end_time_local) { bump("occurrences_skipped"); continue; }
    const day = new Date(o.start_date_local).toISOString().slice(0, 10);
    await dst.query(
      `insert into event_occurrences (tenant_id, legacy_id, event_id, room_id, starts_at, ends_at, status, location_text)
       values ($1, $2, $3, $4, ($5::date + $6::time) at time zone $8, ($5::date + $7::time) at time zone $8, $9, $10) on conflict do nothing`,
      [T, o.id, eid, rMap.get(o.room_id) ?? null, day, o.start_time_local, o.end_time_local, TZ, o.status === "cancelled" ? "cancelled" : "confirmed", o.location_text],
    );
    bump("occurrences");
  }

  // bookings
  const users = new Map((await dst.query("select id, lower(email) as email from users")).rows.map((u) => [u.email, u.id]));
  const bookings = (await src.query(
    `select id, room_id, booked_by_name, booked_by_id, purpose, title, description, attendee_count, notes, status,
            start_date_local, start_time_local, end_time_local, approved_by, approval_date, created_at
       from room_booking_details order by created_at`,
  )).rows;
  for (const b of bookings) {
    const rid = rMap.get(b.room_id);
    if (!rid || !b.start_time_local || !b.end_time_local) { bump("bookings_skipped"); continue; }
    let notes = {};
    try { notes = JSON.parse(b.notes ?? "{}") || {}; } catch { notes = { decisionNote: b.notes }; }
    const status = ["pending", "approved", "declined", "cancelled", "expired"].includes(String(b.status).toLowerCase()) ? String(b.status).toLowerCase() : "pending";
    const day = new Date(b.start_date_local).toISOString().slice(0, 10);
    const ref = "BK-" + String(b.id).replace(/-/g, "").slice(-5).toUpperCase();
    const email = String(b.booked_by_id ?? "").toLowerCase();
    try {
      await dst.query("savepoint sp");
      const r = await dst.query(
        `insert into bookings (tenant_id, legacy_id, ref, room_id, requester_user_id, requester_name, requester_email, purpose, description, attendees, needs,
                               starts_at, ends_at, status, expires_at, decided_at, decision_reason, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, ($12::date + $13::time) at time zone $15, ($12::date + $14::time) at time zone $15,
                 $16, case when $16 = 'pending' then now() + interval '7 days' end, $17, $18, $19)
         on conflict do nothing`,
        [T, b.id, ref, rid, users.get(email) ?? null, b.booked_by_name || "Unknown", email || "unknown", b.purpose || b.title || "Room booking", b.description || "", b.attendee_count || 1,
         JSON.stringify(notes.needs ?? []), day, b.start_time_local, b.end_time_local, TZ, status, b.approval_date, notes.decisionNote ?? null, b.created_at],
      );
      await dst.query("release savepoint sp");
      if (r.rowCount) bump("bookings");
    } catch (e) {
      await dst.query("rollback to savepoint sp");
      bump("bookings_skipped_conflict");
      console.log("skipped booking", b.id, "-", e.message.slice(0, 90));
    }
  }
  await dst.query("commit");
  console.log("copied:", JSON.stringify(report));
} catch (e) {
  await dst.query("rollback").catch(() => undefined);
  throw e;
} finally {
  await src.end();
  await dst.end();
}
