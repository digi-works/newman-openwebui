"""The course scheduler as a small web service, for the portal and (later) the Ask Digi agent.

Every call except /health needs the header X-Scheduler-Key equal to SCHEDULER_API_KEY. Run it next to the portal on a private network,
never on the internet:

    SCHEDULER_API_KEY=... .venv/bin/uvicorn service.app:app --port 8090

A timetable is never edited: generating a draft, or applying a change, saves a new run; the run it came from stays as it was.
"""
import hmac, os
from contextlib import contextmanager
from dataclasses import replace
from typing import Optional

import psycopg
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from scheduler.check import findings_with_fixes
from scheduler.checker import HARD, Practices, check
from scheduler.model import Assignment, database_url, load_run, load_term
from scheduler.runs import CS, save_run, save_solver_draft, summarize
from scheduler.solver import Settings, solve

app = FastAPI(title="Course scheduler", version="1")
MAX_SECONDS = 120.0


def require_key(x_scheduler_key: str = Header(default="")):
    key = os.environ.get("SCHEDULER_API_KEY", "")
    if not key or not hmac.compare_digest(x_scheduler_key, key):
        raise HTTPException(401, "Missing or wrong X-Scheduler-Key.")


@contextmanager
def db():
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        yield conn, cur


def _run_or_404(cur, run_id: int):
    row = cur.execute(f"select term_id, solver_version, plan_status, created_by, created_at, settings from {CS}schedule_runs where run_id = %s", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, f"No timetable {run_id}.")
    return row


def _f(v):
    return {"rule": v.rule_code, "severity": v.severity, "basis": v.basis, "sections": list(v.section_ids), "detail": v.detail}


class Change(BaseModel):
    section_id: str
    slot_id: Optional[str] = None
    room_id: Optional[str] = None
    faculty_id: Optional[str] = None
    keep: list[str] = Field(default_factory=lambda: [], description="fields to keep as they are (slot_id, room_id, faculty_id); others are set as given")


class SolveRequest(BaseModel):
    from_run: int
    fresh: bool = False
    time_limit: float = 60.0
    by: str = "portal"


class ChangeRequest(BaseModel):
    changes: list[Change]
    reason: str = ""
    by: str = "portal"


def _apply(rows, changes):
    by = {a.section_id: a for a in rows}
    out = dict(by)
    for c in changes:
        cur = by.get(c.section_id) or Assignment(c.section_id)
        new = {k: getattr(c, k) for k in ("slot_id", "room_id", "faculty_id") if k not in c.keep}
        out[c.section_id] = replace(cur, **new)
    return list(out.values())


@app.get("/health")
def health():
    try:
        with db() as (_, cur):
            cur.execute("select 1 from course_scheduling.schedule_runs limit 1")
        return {"ok": True}
    except Exception as e:   # noqa: BLE001
        return {"ok": False, "error": type(e).__name__}


@app.get("/runs", dependencies=[Depends(require_key)])
def runs():
    with db() as (_, cur):
        rows = cur.execute(f"""select r.run_id, r.term_id, r.solver_version, r.plan_status, r.created_by, r.created_at,
                                      count(v.*) filter (where v.severity = 'hard' and v.basis = 'real') as hard_real
                                 from {CS}schedule_runs r left join {CS}rule_violations v using (run_id) group by r.run_id order by r.run_id desc""").fetchall()
    return [{"run_id": r[0], "term": r[1], "kind": r[2], "plan_status": r[3], "created_by": r[4], "created_at": r[5].isoformat(), "hard_real": r[6]} for r in rows]


@app.post("/runs/{run_id}/check", dependencies=[Depends(require_key)])
def recheck(run_id: int):
    """Checks a timetable again (after the data changed) and stores the findings."""
    from scheduler.check import save_findings
    with db() as (conn, cur):
        _run_or_404(cur, run_id)
        term_id, rows = load_run(cur, run_id)
        term = load_term(cur, term_id)
        found, fixes = findings_with_fixes(term, rows, Practices())
        save_findings(cur, run_id, found, fixes)
        conn.commit()
    return {"run_id": run_id, "summary": summarize(found)}


@app.post("/solve", dependencies=[Depends(require_key)])
def generate(req: SolveRequest):
    """Builds a draft from a timetable with the solver, checks it and saves it as a new run."""
    with db() as (conn, cur):
        _run_or_404(cur, req.from_run)
        term_id, base = load_run(cur, req.from_run)
        term = load_term(cur, term_id)
        res = solve(term, base, Settings(fresh=req.fresh, time_limit=max(1.0, min(req.time_limit, MAX_SECONDS))))
        if res.status not in ("optimal", "feasible"):
            raise HTTPException(422, f"The solver found no timetable ({res.status}).")
        run_id, summary = save_solver_draft(cur, term, base, res, req.from_run, req.by[:80])
        conn.commit()
    return {"run_id": run_id, "status": res.status, "seconds": round(res.seconds, 1), "placed": res.placed,
            "unplaced": [{"section_id": s, "reason": res.reasons[s]} for s in res.unplaced],
            "moved_time": res.moved_time, "moved_room": res.moved_room, "summary": summary}


def _try(cur, run_id, changes):
    term_id, rows = load_run(cur, run_id)
    term = load_term(cur, term_id)
    unknown = [c.section_id for c in changes if c.section_id not in term.sections]
    if unknown:
        raise HTTPException(422, f"Not a {term_id} section: {', '.join(unknown)}.")
    new_rows = _apply(rows, changes)
    key = lambda v: (v.rule_code, v.section_ids)
    before = {key(v): v for v in check(term, rows) if v.severity == HARD}
    after = {key(v): v for v in check(term, new_rows) if v.severity == HARD}
    added = [after[k] for k in after if k not in before]
    removed = [before[k] for k in before if k not in after]
    return term, new_rows, added, removed


@app.post("/runs/{run_id}/try", dependencies=[Depends(require_key)])
def try_change(run_id: int, req: ChangeRequest):
    """What a change would do, without saving anything: the hard problems it would add and the ones it would remove."""
    with db() as (_, cur):
        _run_or_404(cur, run_id)
        _, _, added, removed = _try(cur, run_id, req.changes)
    return {"ok": not added, "added": [_f(v) for v in added], "removed": [_f(v) for v in removed]}


@app.post("/runs/{run_id}/apply", dependencies=[Depends(require_key)])
def apply_change(run_id: int, req: ChangeRequest):
    """Saves the timetable with the change as a new draft run, only if the change adds no hard problem."""
    with db() as (conn, cur):
        _run_or_404(cur, run_id)
        term, new_rows, added, removed = _try(cur, run_id, req.changes)
        if added:
            raise HTTPException(409, {"message": "This change would add problems, so it was not saved.", "added": [_f(v) for v in added]})
        changed = {c.section_id for c in req.changes}
        old_reasons = dict(cur.execute(f"select section_id, reason from {CS}schedule_assignments where run_id = %s", (run_id,)).fetchall())
        reasons = {**old_reasons, **{s: (req.reason or "Changed by hand.")[:300] for s in changed}}
        new_id, summary = save_run(cur, term, new_rows, reasons, solver_version="edit", created_by=req.by[:80],
                                   settings={"from_run": run_id, "reason": req.reason[:300], "changes": [c.model_dump() for c in req.changes]},
                                   practices=Practices(), input_digest=f"edit-of-{run_id}")
        conn.commit()
    return {"run_id": new_id, "removed": [_f(v) for v in removed], "summary": summary}
