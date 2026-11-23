"""Checks a timetable against every rule.

    .venv/bin/python -m scheduler.check --run 3                        # a saved solver run
    .venv/bin/python -m scheduler.check --csv my.csv --term 2027SP      # a timetable file (section_id, slot_id, room_id, faculty_id)
    .venv/bin/python -m scheduler.check --csv edit.csv --term 2027SP --partial   # only the sections in the file
    .venv/bin/python -m scheduler.check --csv mock/bad_timetable.csv --mock --partial   # against the step 1 mock term, built in memory
    add --save to store the findings in course_scheduling.rule_violations, --all to print every finding,
    --fixes to suggest checked fixes for each hard finding on real data, --strict to treat Newman practices as clashes again

Exit code: 0 = no hard rule broken, 1 = at least one hard rule broken.
"""
import argparse, sys

import psycopg
from psycopg.types.json import Jsonb

from .checker import ESTIMATED, HARD, NOTE, RULES, Practices, check, summary
from .fixes import _hard, fixes_for
from .model import database_url, load_csv, load_run, load_term, mock_term


def main(argv=None):
    p = argparse.ArgumentParser(prog="scheduler.check", description="Lists every broken rule in a timetable.")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--run", type=int, help="solver run id")
    src.add_argument("--csv", help="timetable file")
    p.add_argument("--term", help="term id (needed with --csv)")
    p.add_argument("--mock", action="store_true", help="check against the step 1 mock term (2027SP), built in memory from the catalog")
    p.add_argument("--partial", action="store_true", help="check only the sections in the timetable")
    p.add_argument("--save", action="store_true", help="store the findings in rule_violations")
    p.add_argument("--all", action="store_true", help="print every finding, not the first 40")
    p.add_argument("--fixes", action="store_true", help="suggest checked fixes for hard findings on real data")
    p.add_argument("--strict", action="store_true", help="count sections taught together and clinical supervision as clashes")
    a = p.parse_args(argv)
    if a.csv and not (a.term or a.mock): p.error("--term or --mock is needed with --csv")
    if a.mock and a.save: p.error("--save cannot be used with --mock")

    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        if a.run is not None:
            term_id, assignments = load_run(cur, a.run)
        else:
            term_id, assignments = a.term, load_csv(a.csv)
        term = mock_term(cur) if a.mock else load_term(cur, term_id)
        term_id = term.term_id
        practices = Practices(False, False) if a.strict else Practices()
        found = check(term, assignments, partial=a.partial, practices=practices)

        hard = [v for v in found if v.severity == HARD]
        notes = [v for v in found if v.severity == NOTE]
        guessed = sum(1 for v in hard if v.basis == ESTIMATED)
        print(f"{term_id}: {len(assignments)} assignments checked; {len(hard)} hard ({guessed} of them rest on guessed data), "
              f"{len(found) - len(hard) - len(notes)} soft, {len(notes)} notes (Newman practices, not problems).")
        for code, n in summary(found).items():
            print(f"  {RULES[code][0]:4}  {code:22} {n:5}  {RULES[code][1]}")
        shown = found if a.all else found[:40]
        if shown: print()
        fixes = {}
        if a.fixes or a.save:
            before = _hard(found)
            fixes = {i: fixes_for(term, assignments, v, practices, before) for i, v in enumerate(found) if v.severity == HARD and v.basis != ESTIMATED}
        for i, v in enumerate(found):
            if v not in shown: continue
            print(f"  [{v.severity}{', guessed data' if v.basis == ESTIMATED else ''}] {v.rule_code}: {v.detail}")
            if a.fixes:
                for f in fixes.get(i, []): print(f"      fix: {f.text}")
        if len(found) > len(shown): print(f"  ... {len(found) - len(shown)} more (use --all)")

        if a.save:
            if a.run is not None:
                cur.execute("delete from course_scheduling.rule_violations where run_id = %s", (a.run,))
            cur.executemany("insert into course_scheduling.rule_violations (run_id, rule_code, severity, section_ids, detail, basis, fixes) values (%s, %s, %s, %s, %s, %s, %s)",
                            [(a.run, v.rule_code, v.severity, list(v.section_ids), v.detail, v.basis, Jsonb([f.as_json() for f in fixes.get(i, [])]))
                             for i, v in enumerate(found)])
            conn.commit()
            print(f"\nsaved {len(found)} findings to course_scheduling.rule_violations" + (f" for run {a.run}" if a.run is not None else " (no run id)"))
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
