import type { PoolClient } from "pg";
import { auditEvent } from "./audit";
import { queueBookingEmail, queueExpiryEmails } from "./booking-emails";
import { isOwnBooking, type Booking, type BookingStatus } from "./bookings";
import { withTenant } from "./digi-db";
import { hasPermission, P } from "./permissions";
import { hhmm, searchRooms, tagsFrom, to12h, toMinutes, type Room } from "./rooms";

/**
 * Room booking rules, in one place (architecture v0.3 section 5). One person requests, another decides.
 * - A pending request holds its slot (the database refuses overlaps) until it is decided or expires after the tenant's number of days (7).
 * - Approving rechecks that no event took the room, in the same transaction, and a version number stops two approvers deciding at once.
 * - Nobody decides their own request. Every change writes a booking_events row and an audit row, and tells the requester in the app
 *   (and by email when the organisation has switched room booking emails on, see booking-emails.ts).
 * Callers pass the person acting with permissions read live from the database; this module still checks them.
 */
export type Actor = { id: string; tenantId: string; email: string; name: string; permissions: string[] };

export class BookingError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const STATUS: Record<string, BookingStatus> = { pending: "Tentative", approved: "Confirmed", declined: "Declined", cancelled: "Cancelled", expired: "Expired" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;
type Settings = { tz: string; expiryDays: number };

async function settings(c: PoolClient, tenantId: string): Promise<Settings> {
  const { rows } = await c.query("select configuration from tenants where id = $1", [tenantId]);
  const cfg = (rows[0]?.configuration ?? {}) as { timezone?: string; booking_pending_expiry_days?: number };
  return { tz: cfg.timezone || "America/Chicago", expiryDays: Number(cfg.booking_pending_expiry_days) > 0 ? Number(cfg.booking_pending_expiry_days) : 7 };
}

const SELECT = `
  select b.id, b.ref, b.requester_user_id, b.requester_name, b.requester_email, b.purpose, b.description, b.attendees, b.needs, b.status, b.version,
         b.decision_reason, b.expires_at, r.display_name as room, r.capacity, r.features, r.type as room_type, bl.name as building,
         to_char(b.starts_at at time zone $1, 'YYYY-MM-DD') as day, to_char(b.starts_at at time zone $1, 'HH24:MI') as st,
         to_char(b.ends_at at time zone $1, 'HH24:MI') as et, to_char(b.created_at at time zone $1, 'YYYY-MM-DD') as submitted
    from bookings b join rooms r on r.id = b.room_id join buildings bl on bl.id = r.building_id`;

function toBooking(r: Row): Booking {
  const tags = tagsFrom(r.features);
  return {
    id: r.id as string, ref: r.ref as string, room: r.room as string, building: r.building as string, capacity: Number(r.capacity),
    features: [r.room_type, ...tags].filter(Boolean).join(", ") || "Standard setup",
    requestedBy: r.requester_name as string, role: "", email: r.requester_email as string, phone: "—", personId: "—",
    date: r.day as string, start: to12h(r.st as string), end: to12h(r.et as string), purpose: r.purpose as string, description: (r.description as string) || (r.purpose as string),
    attendees: Number(r.attendees), needs: Array.isArray(r.needs) ? (r.needs as string[]) : [], status: STATUS[r.status as string] ?? "Tentative",
    submitted: r.submitted as string, decisionNote: (r.decision_reason as string) || undefined, version: Number(r.version),
    requesterUserId: (r.requester_user_id as string) || undefined,
    expiresAt: r.status === "pending" && r.expires_at ? new Date(r.expires_at as string).toISOString() : undefined,
  };
}

async function logEvent(c: PoolClient, tenantId: string, bookingId: string, actorId: string | null, action: string, from: string | null, to: string | null, note?: string) {
  await c.query(
    "insert into booking_events (tenant_id, booking_id, actor_user_id, action, from_status, to_status, note) values ($1, $2, $3, $4, $5, $6, $7)",
    [tenantId, bookingId, actorId, action, from, to, note ?? null],
  );
}

async function notify(c: PoolClient, tenantId: string, userId: string | null, title: string, body: string) {
  if (!userId) return;
  await c.query("insert into notifications (tenant_id, user_id, kind, title, body, href) values ($1, $2, 'booking', $3, $4, '/bookings')", [tenantId, userId, title, body]);
}

/** Requests nobody decided in time are closed as expired and release their slot. Cheap enough to run before every read. */
async function expireStale(c: PoolClient, tenantId: string) {
  const expired = await c.query(
    `with x as (update bookings set status = 'expired', version = version + 1, updated_at = now() where status = 'pending' and expires_at < now() returning id, requester_user_id, ref)
     insert into booking_events (tenant_id, booking_id, action, from_status, to_status, note) select $1, id, 'expired', 'pending', 'expired', 'No one decided in time.' from x`,
    [tenantId],
  );
  await c.query(
    `insert into notifications (tenant_id, user_id, kind, title, body, href)
     select $1, b.requester_user_id, 'booking', 'A room request expired', b.ref || ' was not decided in time. You can request the room again.', '/bookings'
       from bookings b join booking_events e on e.booking_id = b.id and e.action = 'expired' and e.created_at > now() - interval '5 seconds'
      where b.requester_user_id is not null and b.status = 'expired'`,
    [tenantId],
  );
  if (expired.rowCount) await queueExpiryEmails(c, tenantId);
}

const slotSql = `tstzrange(($1::date + $2::time) at time zone $4, ($1::date + $3::time) at time zone $4)`;

/* ------------------------------------------------------------------ rooms */
const roomCache = new Map<string, { at: number; rooms: Room[] }>();

export async function getRooms(tenantId: string): Promise<Room[]> {
  const hit = roomCache.get(tenantId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rooms;
  const rooms = await withTenant(tenantId, async (c) => {
    const { rows } = await c.query(
      `select r.id, r.display_name, bl.name as building, r.type, r.capacity, r.features
         from rooms r join buildings bl on bl.id = r.building_id
        where r.reservable and r.searchable order by r.capacity, r.display_name`,
    );
    return rows.map((r): Room => {
      const tags = tagsFrom(r.features);
      return { id: r.id, name: r.display_name, building: r.building, capacity: r.capacity, features: [r.type, ...tags].filter(Boolean).join(", "), tags };
    });
  });
  roomCache.set(tenantId, { at: Date.now(), rooms });
  return rooms;
}

export async function getBuildings(tenantId: string): Promise<string[]> {
  return [...new Set((await getRooms(tenantId)).map((r) => r.building))].sort();
}

function checkSlot(date: string, start: string, end: string) {
  const s = toMinutes(start), e = toMinutes(end);
  if (!DATE.test(date) || s === null || e === null || e <= s) throw new BookingError("Choose a date and a start time before the end time.");
  return { s: hhmm(s), e: hhmm(e) };
}

async function busyRoomIds(c: PoolClient, tz: string, date: string, s: string, e: string): Promise<Set<string>> {
  const { rows } = await c.query(
    `select room_id from bookings where status in ('pending', 'approved') and tstzrange(starts_at, ends_at) && ${slotSql}
     union
     select room_id from event_occurrences where status = 'confirmed' and room_id is not null and tstzrange(starts_at, ends_at) && ${slotSql}`,
    [date, s, e, tz],
  );
  return new Set(rows.map((r) => r.room_id as string));
}

/** Free rooms that fit, with a note if preferences had to be loosened. Events and pending or approved bookings count as busy. */
export async function searchAvailable(tenantId: string, q: { date: string; start: string; end: string; people: number; building?: string; needs?: string[] }) {
  const { s, e } = checkSlot(q.date, q.start, q.end);
  const rooms = await getRooms(tenantId);
  const busy = await withTenant(tenantId, async (c) => {
    const { tz } = await settings(c, tenantId);
    await expireStale(c, tenantId);
    return busyRoomIds(c, tz, q.date, s, e);
  });
  return searchRooms(rooms, { people: q.people, building: q.building, needs: q.needs }, (id) => busy.has(id));
}

/* ------------------------------------------------------------------ requesting */
type BookingInput = { roomId?: string; roomName?: string; date: string; start: string; end: string; purpose: string; people: number; needs?: string[] };
/** Runs inside the booking transaction after the room and time have been checked, before the row is added (used by the approved override). */
type BeforeInsert = (c: PoolClient, room: { id: string; display_name: string }, tz: string) => Promise<void>;

export async function createBooking(actor: Actor, input: BookingInput, beforeInsert?: BeforeInsert): Promise<Booking> {
  if (!hasPermission(actor.permissions, P.bookingsCreate)) throw new BookingError("Your role cannot request rooms.", 403);
  const { s, e } = checkSlot(input.date, input.start, input.end);
  const purpose = input.purpose.trim().slice(0, 200);
  if (!purpose) throw new BookingError("Say what the booking is for.");
  if (!Number.isInteger(input.people) || input.people < 1 || input.people > 1000) throw new BookingError("Enter how many people are coming.");
  const needs = (input.needs ?? []).filter((n) => typeof n === "string").slice(0, 8);

  return withTenant(actor.tenantId, async (c) => {
    const st = await settings(c, actor.tenantId);
    const room = (await c.query(
      "select id, display_name, capacity from rooms where reservable and (id::text = $1 or display_name = $2) limit 1",
      [input.roomId ?? "", input.roomName ?? ""],
    )).rows[0];
    if (!room) throw new BookingError("That room does not exist or cannot be reserved.", 404);
    if (input.people > room.capacity) throw new BookingError(`${room.display_name} holds ${room.capacity} people.`);
    const past = (await c.query(`select (($1::date + $2::time) at time zone $3) < now() as past`, [input.date, s, st.tz])).rows[0].past;
    if (past) throw new BookingError("That time has already passed.");
    const ev = await c.query(
      `select 1 from event_occurrences where room_id = $5 and status = 'confirmed' and tstzrange(starts_at, ends_at) && tstzrange(($1::date + $2::time) at time zone $4, ($1::date + $3::time) at time zone $4) limit 1`,
      [input.date, s, e, st.tz, room.id],
    );
    if (ev.rows[0]) throw new BookingError("An event is using that room at that time.", 409);
    if (beforeInsert) await beforeInsert(c, { id: room.id as string, display_name: room.display_name as string }, st.tz);

    for (let attempt = 0; attempt < 6; attempt++) {
      const ref = "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, "X");
      await c.query("savepoint ins");
      try {
        const { rows } = await c.query(
          `insert into bookings (tenant_id, ref, room_id, requester_user_id, requester_name, requester_email, purpose, description, attendees, needs, starts_at, ends_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9::jsonb, ($10::date + $11::time) at time zone $13, ($10::date + $12::time) at time zone $13, now() + make_interval(days => $14::int))
           returning id`,
          [actor.tenantId, ref, room.id, actor.id, actor.name, actor.email.toLowerCase(), purpose, input.people, JSON.stringify(needs), input.date, s, e, st.tz, st.expiryDays],
        );
        await c.query("release savepoint ins");
        const id = rows[0].id as string;
        await logEvent(c, actor.tenantId, id, actor.id, "created", null, "pending");
        await queueBookingEmail(c, actor.tenantId, actor.id, id, "created");
        await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: "booking.create", entityType: "booking", entityId: id, metadata: { room: room.display_name, date: input.date } });
        return toBooking((await c.query(`${SELECT} where b.id = $2`, [st.tz, id])).rows[0]);
      } catch (err) {
        await c.query("rollback to savepoint ins");
        const code = (err as { code?: string }).code;
        if (code === "23P01") throw new BookingError("That room is no longer free for that time.", 409); // the no-double-booking guard
        if (code === "23505" && String((err as { constraint?: string }).constraint).includes("ref")) continue;
        throw err;
      }
    }
    throw new BookingError("Could not create the request. Try again.", 500);
  });
}

/* ------------------------------------------------------------------ reading */
export async function listBookings(actor: Actor, all: boolean): Promise<Booking[]> {
  return withTenant(actor.tenantId, async (c) => {
    const { tz } = await settings(c, actor.tenantId);
    await expireStale(c, actor.tenantId);
    const { rows } = await c.query(
      `${SELECT} where ($2::boolean or b.requester_user_id = $3 or lower(b.requester_email) = lower($4)) order by b.starts_at desc, b.created_at desc limit 500`,
      [tz, all, actor.id, actor.email],
    );
    return rows.map(toBooking);
  });
}

export async function getBooking(actor: Actor, id: string): Promise<Booking | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(actor.tenantId, async (c) => {
    const { tz } = await settings(c, actor.tenantId);
    await expireStale(c, actor.tenantId);
    const r = (await c.query(`${SELECT} where b.id = $2`, [tz, id])).rows[0];
    if (!r) return null;
    const b = toBooking(r);
    // without "view all bookings" only your own exist
    return hasPermission(actor.permissions, P.bookingsViewAll) || isOwnBooking(b, actor) ? b : null;
  });
}

/** One booking by id for server-side work that has already been authorised (sending its emails, the email decision page). */
export async function bookingById(tenantId: string, id: string): Promise<Booking | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withTenant(tenantId, async (c) => {
    const { tz } = await settings(c, tenantId);
    await expireStale(c, tenantId);
    const r = (await c.query(`${SELECT} where b.id = $2`, [tz, id])).rows[0];
    return r ? toBooking(r) : null;
  });
}

export async function pendingCount(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (c) => {
    await expireStale(c, tenantId);
    return (await c.query("select count(*)::int as n from bookings where status = 'pending'")).rows[0].n as number;
  });
}

/* ------------------------------------------------------------------ deciding, editing, cancelling */
async function loadForChange(c: PoolClient, actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BookingError("That request no longer exists.", 404);
  const { tz } = await settings(c, actor.tenantId);
  await expireStale(c, actor.tenantId);
  const row = (await c.query(`${SELECT} where b.id = $2 for update of b`, [tz, id])).rows[0];
  if (!row) throw new BookingError("That request no longer exists.", 404);
  return { tz, row, booking: toBooking(row) };
}

export async function decideBooking(actor: Actor, id: string, decision: "approve" | "decline", reason: string, expectedVersion?: number): Promise<Booking> {
  if (!hasPermission(actor.permissions, P.bookingsApprove)) throw new BookingError("You do not have permission to approve or decline requests.", 403);
  const note = reason.trim().slice(0, 1000);
  if (!note) throw new BookingError("Add a short reason for this decision.");
  return withTenant(actor.tenantId, async (c) => {
    const { tz, booking } = await loadForChange(c, actor, id);
    if (isOwnBooking(booking, actor)) throw new BookingError("You cannot decide your own request. Another approver needs to.", 403);
    if (booking.status !== "Tentative") throw new BookingError(`This request is already ${booking.status.toLowerCase()}.`, 409);
    if (expectedVersion !== undefined && expectedVersion !== booking.version) throw new BookingError("Someone changed this request while you had it open. Refresh and try again.", 409);

    if (decision === "approve") {
      // the room must still be free of events; other bookings cannot overlap because the database refuses it
      const ev = await c.query(
        `select 1 from event_occurrences e join bookings b on b.id = $1
          where e.room_id = b.room_id and e.status = 'confirmed' and tstzrange(e.starts_at, e.ends_at) && tstzrange(b.starts_at, b.ends_at) limit 1`,
        [id],
      );
      if (ev.rows[0]) throw new BookingError("An event now holds this room at that time, so it cannot be approved. Decline it instead.", 409);
    }
    const to = decision === "approve" ? "approved" : "declined";
    await c.query(
      "update bookings set status = $2, version = version + 1, decided_by_user_id = $3, decided_at = now(), decision_reason = $4, updated_at = now() where id = $1",
      [id, to, actor.id, note],
    );
    await logEvent(c, actor.tenantId, id, actor.id, decision === "approve" ? "approved" : "declined", "pending", to, note);
    await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: `booking.${to}`, entityType: "booking", entityId: id, metadata: { ref: booking.ref } });
    await notify(c, actor.tenantId, booking.requesterUserId ?? null, `Your room request was ${to}`, `${booking.room} on ${booking.date}, ${booking.start} to ${booking.end}. ${note}`);
    await queueBookingEmail(c, actor.tenantId, actor.id, id, to);
    return toBooking((await c.query(`${SELECT} where b.id = $2`, [tz, id])).rows[0]);
  });
}

/** The requester changes the purpose, size or needs of their own request while it is still waiting. */
export async function updateBooking(actor: Actor, id: string, patch: { purpose?: string; attendees?: number; needs?: string[] }): Promise<Booking> {
  if (!hasPermission(actor.permissions, P.bookingsUpdate)) throw new BookingError("Your role cannot edit requests.", 403);
  return withTenant(actor.tenantId, async (c) => {
    const { tz, booking } = await loadForChange(c, actor, id);
    if (!isOwnBooking(booking, actor)) throw new BookingError("That request no longer exists.", 404);
    if (booking.status !== "Tentative") throw new BookingError("Only a request that is still waiting can be edited.", 409);
    const purpose = patch.purpose !== undefined ? patch.purpose.trim().slice(0, 200) : booking.purpose;
    if (!purpose) throw new BookingError("Say what the booking is for.");
    const attendees = patch.attendees ?? booking.attendees;
    if (!Number.isInteger(attendees) || attendees < 1) throw new BookingError("Enter how many people are coming.");
    if (attendees > booking.capacity) throw new BookingError(`${booking.room} holds ${booking.capacity} people.`);
    const needs = (patch.needs ?? booking.needs).filter((n) => typeof n === "string").slice(0, 8);
    await c.query("update bookings set purpose = $2, description = $2, attendees = $3, needs = $4::jsonb, version = version + 1, updated_at = now() where id = $1", [id, purpose, attendees, JSON.stringify(needs)]);
    await logEvent(c, actor.tenantId, id, actor.id, "updated", "pending", "pending");
    await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: "booking.update", entityType: "booking", entityId: id });
    return toBooking((await c.query(`${SELECT} where b.id = $2`, [tz, id])).rows[0]);
  });
}

/** Cancel a request. A requester cancels their own; an approver can also cancel any waiting or approved booking, with a reason. */
export async function cancelBooking(actor: Actor, id: string, reason?: string): Promise<Booking> {
  return withTenant(actor.tenantId, async (c) => {
    const { tz, booking } = await loadForChange(c, actor, id);
    const own = isOwnBooking(booking, actor);
    const approver = hasPermission(actor.permissions, P.bookingsApprove);
    if (own && !hasPermission(actor.permissions, P.bookingsDelete) && !approver) throw new BookingError("Your role cannot cancel bookings.", 403);
    if (!own && !approver) throw new BookingError("That request no longer exists.", 404);
    if (booking.status !== "Tentative" && booking.status !== "Confirmed") throw new BookingError(`This booking is already ${booking.status.toLowerCase()}.`, 409);
    const note = (reason ?? "").trim().slice(0, 1000);
    if (!own && !note) throw new BookingError("Add a short reason for cancelling someone else's booking.");
    const from = booking.status === "Confirmed" ? "approved" : "pending";
    await c.query("update bookings set status = 'cancelled', version = version + 1, decision_reason = coalesce(nullif($2, ''), decision_reason), updated_at = now() where id = $1", [id, note]);
    await logEvent(c, actor.tenantId, id, actor.id, "cancelled", from, "cancelled", note || undefined);
    await auditEvent(c, { tenantId: actor.tenantId, userId: actor.id, action: "booking.cancel", entityType: "booking", entityId: id, metadata: { ref: booking.ref } });
    if (!own) {
      await notify(c, actor.tenantId, booking.requesterUserId ?? null, "Your booking was cancelled", `${booking.room} on ${booking.date}, ${booking.start} to ${booking.end}. ${note}`);
      await queueBookingEmail(c, actor.tenantId, actor.id, id, "cancelled");
    }
    return toBooking((await c.query(`${SELECT} where b.id = $2`, [tz, id])).rows[0]);
  });
}

/* ------------------------------------------------------------------ notifications */
export type AppNotification = { id: string; title: string; body: string; href: string; read: boolean };

export async function notificationsFor(actor: Actor): Promise<AppNotification[]> {
  return withTenant(actor.tenantId, async (c) => {
    const { rows } = await c.query("select id, title, body, href, read_at from notifications where user_id = $1 order by created_at desc limit 20", [actor.id]);
    return rows.map((r) => ({ id: `n-${r.id}`, title: r.title, body: r.body, href: r.href, read: !!r.read_at }));
  });
}

export async function markNotificationsRead(actor: Actor) {
  await withTenant(actor.tenantId, (c) => c.query("update notifications set read_at = now() where user_id = $1 and read_at is null", [actor.id]));
}

/* ------------------------------------------------------------------ overriding a conflict (needs another person's approval, see the tool contract) */
export type Conflict = { id: string; ref: string; purpose: string; status: string; requester: string };

async function conflictsIn(c: PoolClient, tz: string, roomId: string, date: string, s: string, e: string): Promise<Conflict[]> {
  const { rows } = await c.query(
    `select id, ref, purpose, status, requester_name from bookings where room_id = $5 and status in ('pending', 'approved') and tstzrange(starts_at, ends_at) && ${slotSql}`,
    [date, s, e, tz, roomId],
  );
  return rows.map((r) => ({ id: r.id, ref: r.ref, purpose: r.purpose, status: r.status === "approved" ? "Confirmed" : "Tentative", requester: r.requester_name }));
}

/** What an override would displace. Only waiting requests can be displaced; an approved booking never can. */
export async function describeOverride(actor: Actor, input: { room: string; date: string; start: string; end: string }): Promise<{ room: string; conflicts: Conflict[] }> {
  const { s, e } = checkSlot(input.date, input.start, input.end);
  return withTenant(actor.tenantId, async (c) => {
    const st = await settings(c, actor.tenantId);
    const room = (await c.query("select id, display_name from rooms where reservable and display_name = $1", [input.room])).rows[0];
    if (!room) throw new BookingError("That room does not exist or cannot be reserved.", 404);
    return { room: room.display_name as string, conflicts: await conflictsIn(c, st.tz, room.id, input.date, s, e) };
  });
}

/** Takes a room that waiting requests are holding: those requests are cancelled and their people told, and the new request is made, all in one transaction. */
export async function overrideConflict(actor: Actor, input: BookingInput, reason: string): Promise<Booking> {
  const { s, e } = checkSlot(input.date, input.start, input.end);
  return createBooking(actor, input, async (c, room, tz) => {
    const conflicts = await conflictsIn(c, tz, room.id, input.date, s, e);
    if (conflicts.some((x) => x.status === "Confirmed")) throw new BookingError("An approved booking holds that room, so it cannot be overridden.", 409);
    if (!conflicts.length) throw new BookingError("Nothing is holding that room, so no override is needed.", 409);
    for (const x of conflicts) {
      await c.query("update bookings set status = 'cancelled', version = version + 1, decision_reason = $2, updated_at = now() where id = $1", [x.id, `Replaced by a priority request: ${reason}`.slice(0, 1000)]);
      await logEvent(c, actor.tenantId, x.id, actor.id, "cancelled", "pending", "cancelled", `Overridden: ${reason}`.slice(0, 500));
      const who = (await c.query("select requester_user_id from bookings where id = $1", [x.id])).rows[0]?.requester_user_id as string | null;
      await notify(c, actor.tenantId, who, "Your room request was replaced", `${room.display_name} on ${input.date} was given to a priority request. ${reason}`.slice(0, 500));
      await queueBookingEmail(c, actor.tenantId, actor.id, x.id, "replaced");
    }
  });
}
