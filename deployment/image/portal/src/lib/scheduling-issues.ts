/**
 * Course scheduling, Issues page: pure helpers (no database). The findings come from the course scheduler's checker
 * (course-scheduler/scheduler/checker.py), saved in course_scheduling.rule_violations with `python -m scheduler.check --run N --save`.
 */

export type Fix = { text: string; changes: { section_id: string; slot_id: string | null; room_id: string | null; faculty_id: string | null }[] };

export type Finding = {
  rule: string;
  severity: "hard" | "soft" | "note";
  basis: "real" | "estimated";
  sections: string[];
  detail: string;
  fixes: Fix[];
};

/** Where a finding goes on the page. */
export type Category = "clash" | "missing" | "guessed" | "wish" | "practice";

const MISSING = new Set(["NOT_PLACED", "MISSING_FACULTY", "MISSING_ROOM"]);

export function category(f: Pick<Finding, "rule" | "severity" | "basis">): Category {
  if (f.severity === "note") return "practice";
  if (MISSING.has(f.rule)) return "missing";
  if (f.basis === "estimated") return "guessed";
  return f.severity === "hard" ? "clash" : "wish";
}

export const CATEGORIES: { value: Category; label: string; blurb: string }[] = [
  { value: "clash", label: "Real clashes", blurb: "Two classes in one room, or one instructor in two places. These need fixing before a timetable is approved." },
  { value: "missing", label: "Missing information", blurb: "Sections with no instructor yet, or a set time but no room. Only a person can fill these in." },
  { value: "guessed", label: "Guessed data", blurb: "These rest on estimates (student groups from program requirements, room sizes). They can't be confirmed until Newman sends real data." },
  { value: "wish", label: "Wishes", blurb: "Preferences, not rules." },
  { value: "practice", label: "Newman practices", blurb: "How Newman works, recognised by the checker and not counted as problems." },
];

/** A short plain name for each rule. */
export const RULE_TITLE: Record<string, string> = {
  ROOM_DOUBLE_BOOKED: "Room double-booked",
  FACULTY_DOUBLE_BOOKED: "Instructor in two places",
  MISSING_FACULTY: "No instructor",
  NOT_PLACED: "No time, room or instructor",
  MISSING_ROOM: "No room",
  ROOM_TOO_SMALL: "Room too small",
  ROOM_TYPE_MISMATCH: "Wrong kind of room",
  LAB_LECTURE_OVERLAP: "Lab over its own lecture",
  FACULTY_UNAVAILABLE: "Instructor can't teach then",
  FACULTY_OVERLOADED: "Instructor over maximum load",
  GROUP_OVERLAP: "Students can't take both courses",
  GROUP_NO_COMBINATION: "No clash-free week for a student group",
  REQUIRED_IN_EVENING: "Required course in the evening",
  PREFERENCE_MISSED: "Outside preferred times",
  TAUGHT_TOGETHER: "Taught together",
  CLINICAL_SUPERVISION: "Clinical supervision",
};

export const ruleTitle = (rule: string) => RULE_TITLE[rule] ?? rule.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** "2026FA-MUS4083-A" -> "MUS 4083 A" */
export function sectionName(id: string): string {
  const m = /^\d{4}[A-Z]{2}-([A-Z]+)(\d+)-(\w+)$/.exec(id);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : id;
}

/** "TR-0925-1040" style slot ids are shown with their real days and times instead, when the page knows them. */
export function slotLabel(days: string, start: string, end: string): string {
  const t = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
  };
  return `${days} ${t(start)} to ${t(end)}`;
}

/** One plain sentence per finding. Where the sections listed already say it all, a fixed sentence; otherwise the checker's own words, tidied. */
const SAYS: Record<string, string> = {
  ROOM_DOUBLE_BOOKED: "Both are in the same room at overlapping times.",
  FACULTY_DOUBLE_BOOKED: "The same instructor teaches both at overlapping times.",
  MISSING_FACULTY: "No instructor named yet (Staff TBD).",
  NOT_PLACED: "No time, room or instructor named yet. Most of these only need an instructor.",
  MISSING_ROOM: "Meets at a set time, but no room is named.",
  TAUGHT_TOGETHER: "One instructor teaches these at one time as one class: not a clash.",
  CLINICAL_SUPERVISION: "The instructor of record for a hospital clinical also teaches then. Students are with hospital staff, so it isn't a clash.",
};

export function describe(f: Pick<Finding, "rule" | "detail">): string {
  return SAYS[f.rule] ?? f.detail.replace(/\b\d{4}[A-Z]{2}-[A-Z]+\d+-\w+\b/g, sectionName).replace(/\b([A-Z]{2,5})(\d{3,4})\b/g, "$1 $2");
}

/** Findings grouped for the page: by category, then by rule, hard rules first. */
export function group(findings: Finding[]) {
  const by = new Map<Category, Map<string, Finding[]>>();
  for (const f of findings) {
    const c = category(f);
    if (!by.has(c)) by.set(c, new Map());
    const rules = by.get(c)!;
    rules.set(f.rule, [...(rules.get(f.rule) ?? []), f]);
  }
  return CATEGORIES.map((c) => ({
    ...c,
    count: [...(by.get(c.value)?.values() ?? [])].reduce((n, xs) => n + xs.length, 0),
    rules: [...(by.get(c.value)?.entries() ?? [])].sort((a, b) => b[1].length - a[1].length).map(([rule, items]) => ({ rule, title: ruleTitle(rule), items })),
  }));
}
