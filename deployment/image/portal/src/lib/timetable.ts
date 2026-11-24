/**
 * Course scheduling, Timetable page: pure helpers (no database). One row per section in a timetable; the page filters them by room,
 * instructor, subject or student group and lays them out on a week.
 */

export type Meeting = {
  id: string;            // section id, e.g. 2026FA-ACCT2113-B
  course: string;        // ACCT2113
  title: string;
  days: string | null;   // MTWRF..., null = no set time
  start: string | null;  // "09:25"
  end: string | null;
  room: string | null;
  roomType: string | null;
  instructor: string | null;
  enrolled: number | null;
  seats: number;
  mode: string;          // IN_PERSON, ONLINE_LIVE, ONLINE_ASYNC, ARRANGED
  needsTime: boolean;    // meets at a set time (false: online on its own time, arranged)
  half: "first" | "second" | null;   // first or second 8 weeks; null = the whole term
  together: string | null;           // combine group: taught together as one class
  reason: string | null;             // what the solver did with it, in a draft
  problems: { rule: string; basis: string }[];   // hard findings on this section
};

export type View = "room" | "instructor" | "subject" | "group";

export const DAYS = ["M", "T", "W", "R", "F", "S", "U"] as const;
export const DAY_NAME: Record<string, string> = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat", U: "Sun" };

export const subjectOf = (course: string) => /^[A-Z]+/.exec(course)?.[0] ?? course;

export const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The choices for a view, with how many sections each has, busiest first then by name. */
export function options(rows: Meeting[], view: View, groups: Record<string, { label: string; courses: string[] }>) {
  const count = new Map<string, number>();
  const add = (k: string | null) => { if (k) count.set(k, (count.get(k) ?? 0) + 1); };
  if (view === "group") {
    for (const [id, g] of Object.entries(groups)) count.set(id, rows.filter((r) => g.courses.includes(r.course)).length);
  } else {
    for (const r of rows) add(view === "room" ? r.room : view === "instructor" ? r.instructor : subjectOf(r.course));
  }
  const label = (k: string) => (view === "group" ? groups[k]?.label ?? k : k);
  return [...count.entries()].filter(([, n]) => n > 0).map(([value, n]) => ({ value, label: label(value), count: n }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The sections a choice shows. */
export function pick(rows: Meeting[], view: View, key: string, groups: Record<string, { label: string; courses: string[] }>) {
  if (view === "group") return rows.filter((r) => groups[key]?.courses.includes(r.course));
  return rows.filter((r) => (view === "room" ? r.room : view === "instructor" ? r.instructor : subjectOf(r.course)) === key);
}

export type Block = { key: string; members: Meeting[]; day: string; start: number; end: number; lane: number; lanes: number };

/**
 * Lays the sections out on the week. Sections taught together at the same time become one block. Blocks that overlap on a day
 * sit side by side (lanes), so nothing hides another.
 */
export function layout(rows: Meeting[]): Block[] {
  const blocks = new Map<string, Block>();
  for (const r of rows) {
    if (!r.days || !r.start || !r.end) continue;
    for (const day of r.days) {
      const key = `${day}|${r.together && `${r.together}|${r.start}|${r.instructor}` || r.id}`;
      const b = blocks.get(key);
      if (b) b.members.push(r);
      else blocks.set(key, { key, members: [r], day, start: minutes(r.start), end: minutes(r.end), lane: 0, lanes: 1 });
    }
  }
  const out: Block[] = [];
  for (const day of DAYS) {
    const list = [...blocks.values()].filter((b) => b.day === day).sort((a, b) => a.start - b.start || a.end - b.end || a.key.localeCompare(b.key));
    // clusters of blocks that overlap one another share the width
    let cluster: Block[] = [], laneEnds: number[] = [], clusterEnd = -1;
    const close = () => { for (const b of cluster) b.lanes = laneEnds.length; out.push(...cluster); cluster = []; laneEnds = []; };
    for (const b of list) {
      if (b.start >= clusterEnd && cluster.length) close();
      let lane = laneEnds.findIndex((e) => e <= b.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(b.end); } else laneEnds[lane] = b.end;
      b.lane = lane; cluster.push(b); clusterEnd = Math.max(clusterEnd, b.end);
    }
    if (cluster.length) close();
  }
  return out;
}

/** The hours the grid shows: 8 am to 6 pm at least, widened to fit every block, on whole hours. */
export function hours(blocks: Block[]): [number, number] {
  const lo = Math.min(8 * 60, ...blocks.map((b) => b.start));
  const hi = Math.max(18 * 60, ...blocks.map((b) => b.end));
  return [Math.floor(lo / 60) * 60, Math.ceil(hi / 60) * 60];
}

const GAPS = new Set(["NOT_PLACED", "MISSING_FACULTY", "MISSING_ROOM", "MISSING_SLOT"]);

/** A real clash on this section: a hard finding on real data that isn't just missing information. */
export const hasClash = (m: Meeting) => m.problems.some((p) => p.basis === "real" && !GAPS.has(p.rule));

export const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
