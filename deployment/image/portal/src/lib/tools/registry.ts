import {
  BookingError, cancelBooking, createBooking, describeOverride, getBuildings, getRooms, listBookings, overrideConflict, searchAvailable, type Actor,
} from "../booking-service";
import { P, type PermissionCode } from "../permissions";
import { EventSearchError, searchEvents } from "../campus-events";
import { checkInvite, InviteError, sendInvite } from "../event-invites";
import { MailError } from "../mail";
import { addMemory } from "../memory";
import { NEEDS } from "../rooms";

/**
 * The tool contract (architecture v0.4, M5.2). Every tool declares its name, what it may be given, the permission that guards it, its risk
 * and the Open WebUI module that carries it. A tool without a permission cannot be registered (the capabilities table enforces this too).
 *
 * Tools are business functions that call Digi services, never SQL. Approving and declining a booking are deliberately not tools: a model can
 * read the approval queue for someone allowed to see it, but a decision is only ever made by a person in the Digi UI.
 *
 * A "write" tool never commits. It prepares a pending action, which the person confirms with a click in the Digi UI (M5.4).
 */
export type Risk = "read" | "write" | "high_impact";
export type Args = Record<string, unknown>;

export type Prepared = { summary: string; args: Args };
export type ToolDef = {
  id: string;
  description: string;
  risk: Risk;
  permission: PermissionCode;
  owuiToolId: string;
  /** Read tools return data now. */
  run?: (actor: Actor, args: Args) => Promise<unknown>;
  /** Write tools check the request and describe it; nothing is changed yet. */
  prepare?: (actor: Actor, args: Args) => Promise<Prepared>;
  /** Called only after the person's confirm click. */
  commit?: (actor: Actor, args: Args) => Promise<unknown>;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === "string").slice(0, 8) : []);

export class ToolError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const TOOLS: ToolDef[] = [
  {
    id: "rooms.list", description: "List bookable rooms", risk: "read", permission: P.bookingsViewOwn, owuiToolId: "digi_rooms",
    async run(actor, a) {
      const b = str(a.building, 120).toLowerCase(), min = Number(a.min_capacity) || 0;
      return { items: (await getRooms(actor.tenantId)).filter((r) => (!b || r.building.toLowerCase() === b) && r.capacity >= min).slice(0, 60) };
    },
  },
  {
    id: "rooms.form", description: "Room request form", risk: "read", permission: P.bookingsCreate, owuiToolId: "digi_rooms",
    async run(actor) { return { buildings: await getBuildings(actor.tenantId), needs: [...NEEDS] }; },
  },
  {
    id: "rooms.search", description: "Find available rooms", risk: "read", permission: P.bookingsCreate, owuiToolId: "digi_rooms",
    async run(actor, a) {
      const people = Number(a.people);
      if (!Number.isInteger(people) || people < 1 || people > 1000) throw new ToolError("Invalid number of people.");
      return searchAvailable(actor.tenantId, { date: str(a.date, 10), start: str(a.start_time, 8), end: str(a.end_time, 8), people, building: str(a.building, 120), needs: list(a.needs) });
    },
  },
  {
    // Without view-all a person gets only their own; the service decides, not the tool.
    id: "bookings.list", description: "List bookings", risk: "read", permission: P.bookingsViewOwn, owuiToolId: "digi_bookings",
    async run(actor, a) {
      const viewAll = actor.permissions.includes("*") || actor.permissions.includes(P.bookingsViewAll);
      const date = str(a.date, 10), status = str(a.status, 20).toLowerCase(), today = new Date().toISOString().slice(0, 10);
      const items = (await listBookings(actor, viewAll))
        .filter((b) => (date ? b.date === date : b.date >= today))
        .filter((b) => !status || b.status.toLowerCase() === status)
        .map(({ ref, date: d, start, end, room, building, purpose, status: s }) => ({ ref, date: d, start, end, room, building, purpose, status: s }));
      return { items: items.slice(0, 40) };
    },
  },
  {
    id: "bookings.request", description: "Request a room (needs the person's confirmation)", risk: "write", permission: P.bookingsCreate, owuiToolId: "digi_bookings",
    async prepare(actor, a) {
      const room = str(a.room, 120), date = str(a.date, 10), start = str(a.start_time, 8), end = str(a.end_time, 8), purpose = str(a.purpose, 200), people = Number(a.people);
      if (!room || !purpose) throw new ToolError("Say which room and what it is for.");
      if (!Number.isInteger(people) || people < 1) throw new ToolError("Say how many people are coming.");
      // Check it is still free right now, so the card is honest. The database re-checks when the person confirms.
      const free = await searchAvailable(actor.tenantId, { date, start, end, people, needs: list(a.needs) });
      if (!free.rooms.some((r) => r.name === room)) throw new ToolError(`${room} is not free for that time. Ask for rooms again.`, 409);
      return { summary: `Request ${room} on ${date}, ${start} to ${end}, for ${people} people: ${purpose}`, args: { room, date, start_time: start, end_time: end, purpose, people, needs: list(a.needs) } };
    },
    async commit(actor, a) {
      const b = await createBooking(actor, { roomName: str(a.room, 120), date: str(a.date, 10), start: str(a.start_time, 8), end: str(a.end_time, 8), purpose: str(a.purpose, 200), people: Number(a.people), needs: list(a.needs) });
      return { ref: b.ref, id: b.id, status: b.status };
    },
  },
  {
    // High impact: always needs another person's approval (Authority returns ASK; the job engine waits, then runs commit as the requester).
    id: "bookings.override_conflict", description: "Take a room held by someone else's waiting request (needs another person's approval)", risk: "high_impact", permission: P.bookingsCreate, owuiToolId: "digi_bookings",
    async prepare(actor, a) {
      const input = { room: str(a.room, 120), date: str(a.date, 10), start_time: str(a.start_time, 8), end_time: str(a.end_time, 8), purpose: str(a.purpose, 200), people: Number(a.people), reason: str(a.reason, 300) };
      if (!input.room || !input.purpose || !input.reason) throw new ToolError("Say which room, what it is for, and why it should take priority.");
      if (!Number.isInteger(input.people) || input.people < 1) throw new ToolError("Say how many people are coming.");
      const d = await describeOverride(actor, { room: input.room, date: input.date, start: input.start_time, end: input.end_time });
      if (!d.conflicts.length) throw new ToolError("Nothing is holding that room at that time, so an override is not needed. Request it normally.", 409);
      if (d.conflicts.some((x) => x.status === "Confirmed")) throw new ToolError("An approved booking holds that room, so it cannot be overridden.", 409);
      const who = d.conflicts.map((x) => `${x.ref} (${x.purpose})`).join(", ");
      return { summary: `Priority request for ${d.room} on ${input.date}, ${input.start_time} to ${input.end_time}: ${input.purpose}. Reason: ${input.reason}. This would replace the waiting request(s) ${who}.`, args: input };
    },
    async commit(actor, a) {
      const b = await overrideConflict(actor, { roomName: str(a.room, 120), date: str(a.date, 10), start: str(a.start_time, 8), end: str(a.end_time, 8), purpose: str(a.purpose, 200), people: Number(a.people) }, str(a.reason, 300));
      return { ref: b.ref, id: b.id, status: b.status };
    },
  },
  {
    id: "bookings.cancel", description: "Cancel one of the person's bookings (needs their confirmation)", risk: "write", permission: P.bookingsDelete, owuiToolId: "digi_bookings",
    async prepare(actor, a) {
      const ref = str(a.ref, 20).toUpperCase();
      const mine = (await listBookings(actor, false)).find((b) => b.ref === ref);
      if (!mine) throw new ToolError("I could not find one of your bookings with that reference.", 404);
      if (mine.status !== "Tentative" && mine.status !== "Confirmed") throw new ToolError(`That booking is already ${mine.status.toLowerCase()}.`, 409);
      return { summary: `Cancel ${mine.ref}: ${mine.room} on ${mine.date}, ${mine.start} to ${mine.end}`, args: { ref: mine.ref, id: mine.id } };
    },
    async commit(actor, a) {
      const b = await cancelBooking(actor, str(a.id, 40));
      return { ref: b.ref, status: b.status };
    },
  },
  {
    // What is on around campus: anyone who can use Digi may ask, the same as reading the public events calendar.
    id: "events.search", description: "Find campus events", risk: "read", permission: P.chatUse, owuiToolId: "digi_events",
    async run(actor, a) {
      try {
        return await searchEvents(actor.tenantId, { from: str(a.from_date, 10), to: str(a.to_date, 10), text: str(a.query, 100), includeClasses: a.include_classes === true });
      } catch (e) {
        if (e instanceof EventSearchError) throw new ToolError(e.message);
        throw e;
      }
    },
  },
  {
    // A calendar invite from the organisation's mailbox. The person confirms the card; only then is it emailed (Settings > Notifications).
    id: "events.invite", description: "Send a calendar invite for an event (needs the person's confirmation)", risk: "write", permission: P.bookingsCreate, owuiToolId: "digi_events",
    async prepare(actor, a) {
      try {
        const i = await checkInvite(actor.tenantId, { title: str(a.title, 150), date: str(a.date, 10), start: str(a.start_time, 8), end: str(a.end_time, 8), attendees: str(a.attendees, 2000), location: str(a.location, 200), description: str(a.description, 1000) });
        const where = i.location ? ` at ${i.location}` : "";
        return { summary: `Send a calendar invite for "${i.title}" on ${i.date}, ${i.start} to ${i.end}${where}, to ${i.attendees.join(", ")}`, args: { ...i, attendees: i.attendees.join(",") } };
      } catch (e) {
        if (e instanceof InviteError) throw new ToolError(e.message, 409);
        throw e;
      }
    },
    async commit(actor, a) {
      try {
        // checked again: the switch may have been turned off, or the time passed, while the card was open
        const i = await checkInvite(actor.tenantId, { title: str(a.title, 150), date: str(a.date, 10), start: str(a.start, 8), end: str(a.end, 8), attendees: str(a.attendees, 2000), location: str(a.location, 200), description: str(a.description, 1000) });
        return await sendInvite(actor, i);
      } catch (e) {
        if (e instanceof InviteError) throw new ToolError(e.message, 409);
        // the Microsoft detail is for the administrator (server log, Settings > Notifications test), not for the person in the chat
        if (e instanceof MailError) { console.error("calendar invite failed:", e.message); throw new ToolError("The invite could not be sent because email is not working right now. Please tell your Digi administrator.", 502); }
        throw e;
      }
    },
  },
  {
    // Explicit memory (M6.1): only when the person asks. They confirm the note on a card; nothing is extracted automatically.
    id: "memory.remember", description: "Remember something for the person (needs their confirmation)", risk: "write", permission: P.chatUse, owuiToolId: "digi_memory",
    async prepare(_actor, a) {
      const text = str(a.text, 500);
      if (!text) throw new ToolError("Say what to remember.");
      return { summary: `Remember: ${text}`, args: { text } };
    },
    async commit(actor, a) {
      const m = await addMemory(actor.tenantId, actor.id, str(a.text, 500));
      return { id: m.id };
    },
  },
  {
    // The connected tool servers (MCP proxy, M5.9): only the tools this person may use, with their input schemas.
    id: "mcp.list", description: "List connected tools", risk: "read", permission: P.chatUse, owuiToolId: "digi_mcp",
    async run(actor) { const { mcpCatalogFor } = await import("./rules"); return { items: await mcpCatalogFor(actor) }; },
  },
  {
    // Read only. Approve and decline are never tools.
    id: "approvals.queue", description: "Requests waiting for a decision", risk: "read", permission: P.bookingsApprove, owuiToolId: "digi_approvals",
    async run(actor) {
      const items = (await listBookings(actor, true)).filter((b) => b.status === "Tentative")
        .map((b) => ({ ref: b.ref, requestedBy: b.requestedBy, room: b.room, date: b.date, start: b.start, end: b.end, people: b.attendees, purpose: b.purpose }));
      return { items: items.slice(0, 40), note: "Decisions are made on the Bookings page, not in chat." };
    },
  },
];

// A tool without a permission cannot be registered.
for (const t of TOOLS) {
  if (!t.permission || !t.owuiToolId) throw new Error(`tool ${t.id} must declare a permission and a tool module`);
  if (t.risk === "read" ? !t.run : !(t.prepare && t.commit)) throw new Error(`tool ${t.id} does not match its risk`);
}

const byId = new Map(TOOLS.map((t) => [t.id, t]));
export const getTool = (id: string) => byId.get(id);
export const allTools = () => TOOLS;
export { BookingError };
