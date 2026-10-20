/**
 * What each built-in tool looks like to a model and to Studio: a title, a plain description and the JSON Schema of its arguments. One place, used by the
 * Studio catalogue (ToolSpecs) and by runtimes that build their own tool definitions (the Strands adapter). Risk and permission here must match the
 * registry (registry.ts); the tests compare them so they cannot drift.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const str = (description: string) => ({ type: "string", description });

export type ToolView = { id: string; title: string; description: string; risk: "read" | "write" | "high_impact"; permission: string; input: Record<string, unknown> };
export const TOOL_VIEWS: ToolView[] = [
  { id: "rooms.list", title: "List rooms", description: "Bookable rooms with building, capacity and features.", risk: "read", permission: "bookings.view_own",
    input: obj({ building: str("Building name, or empty"), min_capacity: { type: "integer", minimum: 0 } }) },
  { id: "rooms.form", title: "Room request form", description: "Shows the room request form in the conversation.", risk: "read", permission: "bookings.create", input: obj({}) },
  { id: "rooms.search", title: "Find available rooms", description: "Rooms that are free for a date, time, size and needs.", risk: "read", permission: "bookings.create",
    input: obj({ date: str("YYYY-MM-DD"), start_time: str("HH:MM"), end_time: str("HH:MM"), people: { type: "integer", minimum: 1 }, building: str("Preferred building"), needs: { type: "array", items: { type: "string" } }, purpose: str("What the booking is for, if known") }, ["date", "start_time", "end_time", "people"]) },
  { id: "bookings.list", title: "List bookings", description: "The person's bookings (all bookings only if they may see them).", risk: "read", permission: "bookings.view_own",
    input: obj({ date: str("YYYY-MM-DD"), status: str("Tentative, Confirmed, Declined or Cancelled") }) },
  { id: "bookings.request", title: "Request a room", description: "Prepares a room request; the person confirms it in Digi.", risk: "write", permission: "bookings.create",
    input: obj({ room: str("Exact room name"), date: str("YYYY-MM-DD"), start_time: str("HH:MM"), end_time: str("HH:MM"), purpose: str("What it is for"), people: { type: "integer", minimum: 1 }, needs: { type: "array", items: { type: "string" } } }, ["room", "date", "start_time", "end_time", "purpose", "people"]) },
  { id: "bookings.cancel", title: "Cancel a booking", description: "Prepares the cancellation of the person's own booking; they confirm it.", risk: "write", permission: "bookings.delete",
    input: obj({ ref: str("Booking reference, for example BK-7K2QX") }, ["ref"]) },
  { id: "bookings.override_conflict", title: "Override a conflicting request", description: "Asks to take a room that is held by someone else's waiting request. Another person must approve it first.", risk: "high_impact", permission: "bookings.create",
    input: obj({ room: str("Exact room name"), date: str("YYYY-MM-DD"), start_time: str("HH:MM"), end_time: str("HH:MM"), purpose: str("What it is for"), people: { type: "integer", minimum: 1 }, reason: str("Why this should take priority") }, ["room", "date", "start_time", "end_time", "purpose", "people", "reason"]) },
  { id: "approvals.queue", title: "Approval queue (read only)", description: "Requests waiting for a decision. Deciding is done by a person in the UI.", risk: "read", permission: "bookings.approve", input: obj({}) },
  { id: "memory.remember", title: "Remember this", description: "Prepares a note Digi keeps for the person when they ask; they confirm it.", risk: "write", permission: "chat.use", input: obj({ text: str("The note") }, ["text"]) },
];

