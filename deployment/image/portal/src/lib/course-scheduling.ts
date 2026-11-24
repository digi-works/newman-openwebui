import { Pool } from "pg";
import type { Finding } from "./scheduling-issues";

/**
 * The course scheduler's database (schema course_scheduling, filled by course-scheduler/real/load_real.py and the checker).
 * It is a separate database from Digi's own, set with COURSE_SCHEDULING_DATABASE_URL. Read only: the portal never changes a timetable here yet.
 */
export const schedulingEnabled = () => !!process.env.COURSE_SCHEDULING_DATABASE_URL;

const g = globalThis as { __schedPool?: Pool };

function pool(): Pool {
  if (!g.__schedPool) {
    g.__schedPool = new Pool({ connectionString: process.env.COURSE_SCHEDULING_DATABASE_URL, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
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
