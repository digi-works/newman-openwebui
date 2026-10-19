/**
 * Room catalog types and pure helpers (time parsing, search with relaxation). The data lives in Digi's database and is read through
 * booking-service.ts; nothing here touches it.
 */
export type Room = { id: string; name: string; building: string; capacity: number; features: string; tags: string[] };

export const NEEDS = ["Display", "Projector", "Moveable seating", "Whiteboard", "Accessible entry"] as const;

/** Feature flags like {"projector":true,"whiteboard":true} -> the tags the request form uses. */
export function tagsFrom(features: unknown): string[] {
  if (!features || typeof features !== "object") return [];
  const known: Record<string, string> = {
    display: "Display", projector: "Projector", whiteboard: "Whiteboard", accessible: "Accessible entry",
    accessible_entry: "Accessible entry", moveable_seating: "Moveable seating", movable_seating: "Moveable seating",
  };
  return Object.entries(features as Record<string, unknown>)
    .filter(([, v]) => v === true)
    .flatMap(([k]) => {
      const tag = known[k.toLowerCase()] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      return tag === "Projector" ? [tag, "Display"] : [tag]; // a projector counts as a display
    });
}

/** "9:00 AM" or "13:30" -> minutes after midnight. */
export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(t.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h > 23 || min > 59 ? null : h * 60 + min;
}

/** 24-hour "13:30" -> "1:30 PM". */
export function to12h(t: string): string {
  const mins = toMinutes(t);
  if (mins === null) return t;
  const h = Math.floor(mins / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

type Query = { people: number; building?: string; needs?: string[] };
type Loosen = { size: boolean; building: boolean; needs: boolean };

function filterRooms(rooms: Room[], q: Query, isBusy: (roomId: string) => boolean, o: Loosen): Room[] {
  const maxFit = Math.max(q.people * 4, q.people + 20); // do not offer the Quad to a study group
  return rooms
    .filter((r) => r.capacity >= q.people && (!o.size || r.capacity <= maxFit))
    .filter((r) => !o.building || !q.building || r.building === q.building)
    .filter((r) => !o.needs || (q.needs ?? []).every((n) => r.tags.includes(n)))
    .filter((r) => !isBusy(r.id))
    .sort((a, b) => a.capacity - b.capacity)
    .slice(0, 6);
}

/**
 * Free rooms that fit. If nothing matches every preference, loosen them one at a time (room size, then building, then equipment)
 * and say what was loosened, so the person always sees what is actually free.
 */
export function searchRooms(rooms: Room[], q: Query, isBusy: (roomId: string) => boolean): { rooms: Room[]; note: string } {
  const needs = q.needs ?? [];
  const steps: { o: Loosen; note: string }[] = [
    { o: { size: true, building: true, needs: true }, note: "" },
    { o: { size: false, building: true, needs: true }, note: "These rooms are larger than you need, but they are free." },
    { o: { size: false, building: false, needs: true }, note: q.building ? `Nothing free in ${q.building}, so these are in other buildings.` : "" },
    // by now both the building and the equipment were loosened, so name both (QA DEF-14)
    { o: { size: false, building: false, needs: false }, note: q.building
      ? `Nothing free in ${q.building} or any other building matches everything you asked for${needs.length ? ` (${needs.join(", ")})` : ""}. These are free and fit your group, but may be in other buildings, so check the equipment with staff.`
      : `Nothing free matches everything you asked for${needs.length ? ` (${needs.join(", ")})` : ""}. These are free and fit your group, so check the equipment with staff.` },
  ];
  for (const st of steps) {
    const found = filterRooms(rooms, q, isBusy, st.o);
    if (found.length) return { rooms: found, note: st.note };
  }
  const biggest = Math.max(0, ...rooms.map((r) => r.capacity));
  return { rooms: [], note: q.people > biggest ? `No room holds ${q.people} people. The largest holds ${biggest}.` : "" };
}
