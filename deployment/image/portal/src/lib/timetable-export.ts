/**
 * Course scheduling: a timetable as a CSV file that opens in Excel, one row per section. For a draft, each row also says whether it
 * differs from the timetable it was made from, and what changed. Pure (no database), so it can be tested on its own.
 */
import { sectionName } from "./scheduling-issues";
import { DAY_NAME, type Meeting, time12 } from "./timetable";

export const COLUMNS = [
  "Section", "Course", "Title", "Days", "Start", "End", "Room", "Instructor", "Enrolled", "Delivery", "Part of term",
  "Changed", "What changed", "Problems",
] as const;

const DELIVERY: Record<string, string> = { IN_PERSON: "In person", ONLINE_LIVE: "Online, live", ONLINE_ASYNC: "Online, own time", ARRANGED: "Arranged" };

/** One cell. Quoted when needed; a leading = + - @ is neutralised so Excel never runs a cell as a formula. */
export function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Base = Map<string, { days: string | null; start: string | null; room: string | null; instructor: string | null }>;

function changed(m: Meeting, base: Base | null): [string, string] {
  if (!base) return ["", ""];
  const b = base.get(m.id);
  if (!b) return ["New", "Not in the timetable it was made from"];
  const what: string[] = [];
  if ((b.days ?? "") !== (m.days ?? "") || (b.start ?? "") !== (m.start ?? "")) what.push("time");
  if ((b.room ?? "") !== (m.room ?? "")) what.push("room");
  if ((b.instructor ?? "") !== (m.instructor ?? "")) what.push("instructor");
  return what.length ? ["Yes", m.reason ?? `New ${what.join(" and ")}`] : ["", ""];
}

/** The whole file: a byte-order mark (so Excel reads accents right), the header, then one row per section in section order. */
export function toCsv(rows: Meeting[], base: Base | null, ruleTitle: (rule: string) => string): string {
  const lines = [COLUMNS.join(",")];
  for (const m of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const [isChanged, what] = changed(m, base);
    const real = m.problems.filter((p) => p.basis === "real").map((p) => ruleTitle(p.rule));
    lines.push([
      sectionName(m.id), m.course, m.title,
      m.days ? m.days.split("").map((d) => DAY_NAME[d]).join(" ") : "", m.start ? time12(m.start) : "", m.end ? time12(m.end) : "",
      m.room, m.instructor, m.enrolled, DELIVERY[m.mode] ?? m.mode,
      m.half === "first" ? "First 8 weeks" : m.half === "second" ? "Second 8 weeks" : "Whole term",
      isChanged, what, [...new Set(real)].join("; "),
    ].map(cell).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** "2026FA" -> "Fall 2026" */
export function termName(term: string): string {
  const m = /^(\d{4})(FA|SP|SU|WI)$/.exec(term);
  return m ? `${{ FA: "Fall", SP: "Spring", SU: "Summer", WI: "Winter" }[m[2]]} ${m[1]}` : term;
}

/**
 * Plain names for a term's timetables: the university's own is "Newman's original (Fall 2026)"; drafts are numbered 1, 2, 3 per term in
 * the order they were made: "Fixed draft 1 (Fall 2026)" from the solver, "Edited draft 2 (Fall 2026)" from a change by hand.
 */
export function runLabels(runs: { id: number; term: string; kind: string }[]): Map<number, { label: string; number: number | null }> {
  const out = new Map<number, { label: string; number: number | null }>();
  const seen = new Map<string, number>();
  for (const r of [...runs].sort((a, b) => a.id - b.id)) {
    const term = termName(r.term);
    if (r.kind === "actual-timetable") { out.set(r.id, { label: `Newman's original (${term})`, number: null }); continue; }
    const n = (seen.get(r.term) ?? 0) + 1;
    seen.set(r.term, n);
    out.set(r.id, { label: `${r.kind === "edit" ? "Edited" : "Fixed"} draft ${n} (${term})`, number: n });
  }
  return out;
}

/** "Newman's original (Fall 2026)" -> "Newmans-original-Fall-2026.csv"; "Fixed draft 1 (Fall 2026)" -> "Fixed-draft-1-Fall-2026.csv" */
export const fileName = (label: string) => `${label.replace(/[^\w ]/g, "").trim().replace(/\s+/g, "-")}.csv`;
