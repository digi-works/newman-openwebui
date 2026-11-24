import { Pool } from "pg";
import type { Finding } from "./scheduling-issues";
import type { Meeting } from "./timetable";

/**
 * The course scheduler's database (schema course_scheduling, filled by course-scheduler/real/load_real.py and the checker).
 * It is a separate database from Digi's own, set with COURSE_SCHEDULING_DATABASE_URL. Read only: the portal never changes a timetable here yet.
 */
export const schedulingEnabled = () => !!process.env.COURSE_SCHEDULING_DATABASE_URL;

const g = globalThis as { __schedPool?: Pool };

/**
 * Neon gives addresses with sslmode=require. The pg driver already treats that as verify-full (certificate and host checked), but warns
 * that the meaning will change; saying verify-full outright keeps today's strict check and the warning away.
 */
export function strictTls(url: string): string {
  try {
    const u = new URL(url);
    if (["prefer", "require", "verify-ca"].includes(u.searchParams.get("sslmode") ?? "")) u.searchParams.set("sslmode", "verify-full");
    return u.toString();
  } catch {
    return url;
  }
}

function pool(): Pool {
  if (!g.__schedPool) {
    g.__schedPool = new Pool({ connectionString: strictTls(process.env.COURSE_SCHEDULING_DATABASE_URL!), max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
    g.__schedPool.on("error", (e) => console.error("course scheduling db pool error", e.message));
  }
  return g.__schedPool;
}

export type Run = { id: number; term: string; label: string; checked: boolean; findings: number };

export type SectionInfo = {
  id: string; title: string; when: { days: string; start: string; end: string } | null; room: string | null; instructor: string | null; enrolled: number | null;
  note: string | null;   // what the solver did with it in a draft ("New room (was none).", or why it couldn't be placed)
};

const PLAIN = new Set(["Kept as run.", "As run by the university", "The file gives no time, room or instructor", "No set time: kept as given."]);

/** Every timetable we have, newest first. The timetable as the university ran it is labelled as such. */
export async function listRuns(): Promise<Run[]> {
  const { rows } = await pool().query(
    `select r.run_id, r.term_id, r.solver_version, r.created_at, count(v.violation_id)::int as n
       from course_scheduling.schedule_runs r left join course_scheduling.rule_violations v using (run_id)
      group by r.run_id order by r.run_id desc`);
  return rows.map((r) => ({
    id: Number(r.run_id), term: r.term_id, findings: r.n, checked: r.n > 0,
    label: r.solver_version === "actual-timetable" ? `As run by Newman (${r.term_id})` : `Draft ${r.run_id} (${r.term_id})`,
  }));
}

/** The checker's saved findings for one timetable, and what the page needs to describe each section involved. */
export async function issuesFor(runId: number): Promise<{ findings: Finding[]; sections: Record<string, SectionInfo> }> {
  const { rows } = await pool().query(
    `select rule_code, severity, basis, section_ids, detail, fixes from course_scheduling.rule_violations where run_id = $1 order by violation_id`, [runId]);
  const findings: Finding[] = rows.map((r) => ({ rule: r.rule_code, severity: r.severity, basis: r.basis, sections: r.section_ids, detail: r.detail, fixes: r.fixes ?? [] }));
  const ids = [...new Set(findings.flatMap((f) => f.sections))];
  const sections: Record<string, SectionInfo> = {};
  if (ids.length) {
    const info = await pool().query(
      `select s.section_id, coalesce(src.course_title, s.course_id) as title, s.enrolled, a.room_id, a.reason, f.name as instructor,
              t.days, to_char(t.start_time, 'HH24:MI') as st, to_char(t.end_time, 'HH24:MI') as et
         from course_scheduling.sections s
         left join course_scheduling.source_sections src on src.section_id = s.section_id
         left join course_scheduling.schedule_assignments a on a.section_id = s.section_id and a.run_id = $1
         left join course_scheduling.time_slots t on t.slot_id = a.slot_id
         left join course_scheduling.faculty f on f.faculty_id = a.faculty_id
        where s.section_id = any($2)`, [runId, ids]);
    for (const r of info.rows) {
      sections[r.section_id] = {
        id: r.section_id, title: r.title, enrolled: r.enrolled, room: r.room_id, instructor: r.instructor,
        when: r.days ? { days: r.days, start: r.st, end: r.et } : null,
        note: r.reason && !PLAIN.has(r.reason) ? r.reason : null,
      };
    }
  }
  return { findings, sections };
}

/** Every section in one timetable, ready for the week view, and the term's student groups (guessed until Newman sends real ones). */
export async function timetableFor(runId: number): Promise<{ rows: Meeting[]; groups: Record<string, { label: string; courses: string[] }> }> {
  const term = (await pool().query(`select term_id from course_scheduling.schedule_runs where run_id = $1`, [runId])).rows[0]?.term_id as string | undefined;
  if (!term) return { rows: [], groups: {} };
  const [secs, probs, grp, span] = await Promise.all([
    pool().query(
      `select s.section_id, s.course_id, coalesce(src.course_title, s.course_id) as title, s.enrolled, s.seat_cap, s.delivery_mode, s.slot_kind,
              s.first_date, s.last_date, t.days, to_char(t.start_time, 'HH24:MI') as st, to_char(t.end_time, 'HH24:MI') as et,
              a.room_id, r.room_type, f.name as instructor, a.reason, cs.combine_id
         from course_scheduling.sections s
         left join course_scheduling.schedule_assignments a on a.section_id = s.section_id and a.run_id = $1
         left join course_scheduling.source_sections src on src.section_id = s.section_id
         left join course_scheduling.time_slots t on t.slot_id = a.slot_id
         left join course_scheduling.rooms r on r.room_id = a.room_id
         left join course_scheduling.faculty f on f.faculty_id = a.faculty_id
         left join course_scheduling.combined_sections cs on cs.section_id = s.section_id
        where s.term_id = $2
        order by s.section_id`, [runId, term]),
    pool().query(`select unnest(section_ids) as sid, rule_code, basis from course_scheduling.rule_violations where run_id = $1 and severity = 'hard'`, [runId]),
    pool().query(
      `select g.group_id, g.label, array_agg(gc.course_id order by gc.course_id) as courses
         from course_scheduling.student_groups g join course_scheduling.student_group_courses gc using (group_id)
        where g.term_id = $1 group by g.group_id, g.label`, [term]),
    pool().query(`select min(first_date) as a, max(last_date) as b from course_scheduling.sections where term_id = $1`, [term]),
  ]);
  const problems = new Map<string, { rule: string; basis: string }[]>();
  for (const p of probs.rows) problems.set(p.sid, [...(problems.get(p.sid) ?? []), { rule: p.rule_code, basis: p.basis }]);
  const { a: termStart, b: termEnd } = span.rows[0] as { a: Date | null; b: Date | null };
  const mid = termStart && termEnd ? (termStart.getTime() + termEnd.getTime()) / 2 : null;
  const half = (first: Date | null, last: Date | null): Meeting["half"] => {
    if (!mid || !first || !last || !termStart || !termEnd) return null;
    if (last.getTime() <= mid) return "first";
    if (first.getTime() >= mid) return "second";
    return null;
  };
  const rows: Meeting[] = secs.rows.map((r) => ({
    id: r.section_id, course: r.course_id, title: r.title, days: r.days, start: r.st, end: r.et, room: r.room_id, roomType: r.room_type,
    instructor: r.instructor, enrolled: r.enrolled, seats: r.seat_cap, mode: r.delivery_mode, needsTime: !!r.slot_kind,
    half: half(r.first_date, r.last_date), together: r.combine_id, reason: r.reason && !PLAIN.has(r.reason) ? r.reason : null,
    problems: problems.get(r.section_id) ?? [],
  }));
  const groups: Record<string, { label: string; courses: string[] }> = {};
  for (const g of grp.rows) groups[g.group_id] = { label: g.label, courses: g.courses };
  return { rows, groups };
}
