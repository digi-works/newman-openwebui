"""Builds a draft timetable with the solver, checks it, and (with --save) stores it as a new schedule run with its findings.

    .venv/bin/python -m scheduler.solve --from-run 1                  # re-plan the timetable as run: fix clashes, change as little as possible
    .venv/bin/python -m scheduler.solve --from-run 1 --fresh          # build from the same meeting patterns, keeping nothing but instructors
    .venv/bin/python -m scheduler.solve --from-run 1 --save           # store it as a draft (shown on Scheduling > Issues)
    options: --time-limit 60, --strict (no taught-together, no clinical supervision)

Nothing that exists is changed: a draft is a new run; the base run stays as it was.
"""
import argparse, sys
from collections import Counter

import psycopg

from .check import findings_with_fixes
from .checker import ESTIMATED, HARD, NOTE
from .model import database_url, load_run, load_term
from .runs import save_solver_draft
from .solver import Settings, solve


def main(argv=None):
    p = argparse.ArgumentParser(prog="scheduler.solve", description="Builds a draft timetable.")
    p.add_argument("--from-run", type=int, required=True, help="the timetable to start from (instructors and meeting patterns)")
    p.add_argument("--fresh", action="store_true", help="don't try to keep the base timetable's times and rooms")
    p.add_argument("--time-limit", type=float, default=60.0)
    p.add_argument("--strict", action="store_true", help="no sections taught together, no clinical supervision")
    p.add_argument("--save", action="store_true", help="store the draft and its findings as a new schedule run")
    a = p.parse_args(argv)
    settings = Settings(fresh=a.fresh, time_limit=a.time_limit, taught_together=not a.strict, clinical_supervision=not a.strict)

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        term_id, base = load_run(cur, a.from_run)
        term = load_term(cur, term_id)
        res = solve(term, base, settings)
        print(f"{term_id}: solver {res.status} in {res.seconds:.1f}s; {res.placed} sections placed, {len(res.unplaced)} not placed; "
              f"{len(res.moved_time)} moved to another time, {len(res.moved_room)} to another room.")
        if res.status not in ("optimal", "feasible"):
            return 2
        found, fixes = findings_with_fixes(term, res.assignments, settings.practices)
        hard = [v for v in found if v.severity == HARD]
        real = [v for v in hard if v.basis != ESTIMATED]
        print(f"checker: {len(hard)} hard ({len(real)} on real data), {sum(1 for v in found if v.severity == 'soft')} soft, "
              f"{sum(1 for v in found if v.severity == NOTE)} notes")
        gaps = {"NOT_PLACED", "MISSING_FACULTY", "MISSING_ROOM", "MISSING_SLOT"}
        clashes = [v for v in real if v.rule_code not in gaps]
        print(f"  real clashes: {len(clashes)}; data gaps and sections not placed: {len(real) - len(clashes)}")
        for code, n in sorted(Counter(v.rule_code for v in real).items()):
            print(f"  real  {code:24} {n}")
        for sid in res.unplaced:
            print(f"  not placed: {sid}: {res.reasons[sid]}")
        changed = sorted(set(res.moved_time) | set(res.moved_room))
        for sid in changed[:30]:
            print(f"  {sid}: {res.reasons[sid]}")
        if len(changed) > 30:
            print(f"  ... {len(changed) - 30} more changes")

        if a.save:
            run_id, _ = save_solver_draft(cur, term, base, res, a.from_run, "scheduler.solve")
            conn.commit()
            print(f"saved as draft run {run_id}, with {len(found)} findings")
    return 0 if not clashes else 1


if __name__ == "__main__":
    sys.exit(main())
