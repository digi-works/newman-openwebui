"""Storing timetables. A timetable is never edited: a draft, an applied fix or a hand move is always saved as a new run, and the run it
came from stays as it was. Used by scheduler.solve and by the service."""
from dataclasses import asdict

from psycopg.types.json import Jsonb

from .check import findings_with_fixes, save_findings
from .checker import ESTIMATED, HARD, NOTE, SOFT
from .solver import VERSION, input_hash

CS = "course_scheduling."
GAPS = {"NOT_PLACED", "MISSING_FACULTY", "MISSING_ROOM", "MISSING_SLOT"}


def summarize(found) -> dict:
    hard = [v for v in found if v.severity == HARD]
    real = [v for v in hard if v.basis != ESTIMATED]
    return {"hard": len(hard), "real_clashes": sum(1 for v in real if v.rule_code not in GAPS), "gaps": sum(1 for v in real if v.rule_code in GAPS),
            "guessed": sum(1 for v in found if v.basis == ESTIMATED and v.severity != NOTE),
            "soft": sum(1 for v in found if v.severity == SOFT and v.basis != ESTIMATED), "notes": sum(1 for v in found if v.severity == NOTE)}


def save_run(cur, term, rows, reasons, *, solver_version, created_by, settings: dict, practices, input_digest, placed=None, unplaced=0) -> tuple:
    """Stores rows as a new draft run, checks it and stores its findings with checked fixes. Returns (run_id, summary)."""
    placed = placed if placed is not None else sum(1 for r in rows if r.slot_id or r.room_id or r.faculty_id)
    run_id = cur.execute(
        f"""insert into {CS}schedule_runs (term_id, input_hash, settings, solver_version, status, plan_status, placed_count, unplaced_count, created_by)
            values (%s, %s, %s, %s, 'done', 'draft', %s, %s, %s) returning run_id""",
        (term.term_id, input_digest, Jsonb(settings), solver_version, placed, unplaced, created_by)).fetchone()[0]
    cur.executemany(f"insert into {CS}schedule_assignments (run_id, section_id, slot_id, room_id, faculty_id, placed, reason) values (%s, %s, %s, %s, %s, %s, %s)",
                    [(run_id, r.section_id, r.slot_id, r.room_id, r.faculty_id, bool(r.slot_id or r.room_id or r.faculty_id), reasons.get(r.section_id))
                     for r in rows])
    found, fixes = findings_with_fixes(term, rows, practices)
    save_findings(cur, run_id, found, fixes)
    return run_id, summarize(found)


def save_solver_draft(cur, term, base, res, from_run, created_by) -> tuple:
    s = res.settings
    meta = {**asdict(s), "from_run": from_run, "status": res.status, "seconds": round(res.seconds, 1),
            "moved_time": len(res.moved_time), "moved_room": len(res.moved_room)}
    return save_run(cur, term, res.assignments, res.reasons, solver_version=VERSION, created_by=created_by, settings=meta,
                    practices=s.practices, input_digest=input_hash(term, base, s), placed=res.placed, unplaced=len(res.unplaced))
