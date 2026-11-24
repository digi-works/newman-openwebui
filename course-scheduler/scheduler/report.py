"""Writes a plain-words checker report for a timetable: real clashes (with checked fixes), missing information, findings that rest on
guessed data, and the Newman practices the checker recognised. No instructor names: the report can be shared and committed.

    .venv/bin/python -m scheduler.report --run 1                     # writes real/CHECK_REPORT.md
    .venv/bin/python -m scheduler.report --run 1 --out other.md
"""
import argparse, re
from collections import Counter

import psycopg

from .checker import ESTIMATED, HARD, NOTE, SOFT, check
from .fixes import _hard, _label, fixes_for
from .model import ROOT, database_url, load_run, load_term

MISSING = {"NOT_PLACED", "MISSING_FACULTY", "MISSING_ROOM", "MISSING_SLOT"}


def pretty(sid: str) -> str:
    """2026FA-MUS4083-A -> MUS 4083 A"""
    m = re.match(r"^[0-9]{4}[A-Z]{2}-([A-Z]+)([0-9]+)-(\w+)$", sid)
    return f"{m.group(1)} {m.group(2)} {m.group(3)}" if m else sid


def when(term, a):
    return _label(term.slots[a.slot_id]) if a and a.slot_id in term.slots else "no set time"


def fix_text(term, f) -> str:
    """The fix in words, without instructor names."""
    c = f.changes[0]
    if f.text.startswith("Give"):
        return f"another instructor who teaches {term.sections[c.section_id].course_id} this term is free then"
    if c.room_id and f.text.startswith(f"Move {c.section_id} to {c.room_id}"):
        r = term.rooms[c.room_id]
        return f"move {pretty(c.section_id)} to {c.room_id} ({r.capacity} seats{', estimated' if 'capacity' in r.estimated else ''})"
    return f"move {pretty(c.section_id)} to {_label(term.slots[c.slot_id])}, same room and instructor"


def build(term, assignments) -> str:
    by = {a.section_id: a for a in assignments}
    found = check(term, assignments)
    before = _hard(found)
    hard = [v for v in found if v.severity == HARD]
    clashes = [v for v in hard if v.rule_code not in MISSING and v.basis != ESTIMATED]
    missing = [v for v in hard if v.rule_code in MISSING]
    guessed = [v for v in found if v.severity in (HARD, SOFT) and v.basis == ESTIMATED]
    soft_real = [v for v in found if v.severity == SOFT and v.basis != ESTIMATED]
    notes = [v for v in found if v.severity == NOTE]
    together = [v for v in notes if v.rule_code == "TAUGHT_TOGETHER"]
    clinical = [v for v in notes if v.rule_code == "CLINICAL_SUPERVISION"]
    no_teacher = [v for v in missing if v.rule_code in ("NOT_PLACED", "MISSING_FACULTY")]
    no_room = [v for v in missing if v.rule_code == "MISSING_ROOM"]

    L = [f"# Checker report: {term.term_id}, the timetable as run", "",
         "Written by `scheduler/report.py` from the real data in `course_scheduling`. Section codes and rooms are Newman's; instructor names are left out.", "",
         "## Summary", "", "| | Count | What it means |", "|---|---|---|",
         f"| **Real clashes to fix** | **{len(clashes)}** | Two classes in one room, or one instructor in two places, on real data |",
         f"| Missing information | {len(no_teacher) + len(no_room)} | {len(no_teacher)} sections with no instructor yet (Staff TBD), {len(no_room)} that meet at a set time with no room |",
         f"| Rests on guessed data | {len(guessed)} | Student groups are guessed from program requirements, so these can't be confirmed until Newman sends degree maps or registration data |",
         f"| Wishes not met | {len(soft_real)} | Preferences, not rules |",
         f"| Newman practices, not problems | {len(together)} groups taught together ({sum(len(v.section_ids) for v in together)} sections), {len(clinical)} clinical overlaps | Recognised by the checker and not counted |", "",
         "Before the checker knew Newman's practices, the same timetable showed 240 hard findings.", ""]

    L += ["## Real clashes, with checked fixes", "",
          "Every fix below was applied to the whole timetable and checked: it removes the clash and adds no new hard problem.", "",
          "| Clash | When | Fixes |", "|---|---|---|"]
    for v in clashes:
        a, b = v.section_ids[0], v.section_ids[-1]
        what = (f"{pretty(a)} and {pretty(b)} both in {by[a].room_id}" if v.rule_code == "ROOM_DOUBLE_BOOKED"
                else f"{pretty(a)} and {pretty(b)}: same instructor" if v.rule_code == "FACULTY_DOUBLE_BOOKED" else f"{v.rule_code}: {v.detail}")
        fixes = fixes_for(term, assignments, v, before=before)
        times = when(term, by[a]) if by[a].slot_id == by[b].slot_id else f"{when(term, by[a])} / {when(term, by[b])}"
        L.append(f"| {what} | {times} | {'; '.join(fix_text(term, f) for f in fixes) or 'no free option found: needs a person to decide'} |")

    L += ["", "## Missing information", "", "### Sections that meet at a set time but have no room", "", "| Section | When | Free rooms that fit |", "|---|---|---|"]
    for v in no_room:
        sid = v.section_ids[0]
        fixes = fixes_for(term, assignments, v, before=before)
        L.append(f"| {pretty(sid)} | {when(term, by.get(sid))} | {', '.join(f.changes[0].room_id for f in fixes) or 'none'} |")
    with_offer = sum(1 for v in no_teacher if fixes_for(term, assignments, v, before=before))
    L += ["", f"### Sections with no instructor yet ({len(no_teacher)})", "",
          f"{with_offer} of them have at least one instructor who teaches the same course this term and is free then (Ask Digi can propose them).", "",
          ", ".join(pretty(v.section_ids[0]) for v in no_teacher), ""]

    L += ["## Rests on guessed data", "", "| Finding | Count |", "|---|---|"]
    for code, n in sorted(Counter(v.rule_code for v in guessed).items()):
        L.append(f"| {code} | {n} |")
    L += ["", "Student groups are built from each program's required courses by level, not from real student schedules. "
          "These findings become real (or disappear) once Newman sends degree maps or registration data.", ""]

    L += ["## Newman practices the checker recognises", "",
          f"- **Taught together** ({len(together)} groups): one instructor teaching several sections at one time as one meeting: stacked or cross-listed "
          "courses in one room, or one class reaching a partner college or a live online section. Found in the timetable as run and stored in "
          "`combined_sections`; a solver keeps only these together.",
          f"- **Clinical supervision** ({len(clinical)} overlaps): the instructor of record for a hospital clinical also teaches at that time; "
          "students are with hospital staff.",
          "- Both can be switched off (`python -m scheduler.check --strict`) to count them as clashes again.", ""]
    kinds = Counter(k for k in (("same room" if len({by[s].room_id for s in v.section_ids}) == 1 else "several sites") for v in together))
    L += [f"Groups taught together: {kinds.get('same room', 0)} in one room, {kinds.get('several sites', 0)} across several sites.", ""]
    return "\n".join(L)


def main(argv=None):
    p = argparse.ArgumentParser(prog="scheduler.report")
    p.add_argument("--run", type=int, required=True)
    p.add_argument("--out", default=str(ROOT / "real" / "CHECK_REPORT.md"))
    a = p.parse_args(argv)
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        term_id, assignments = load_run(cur, a.run)
        text = build(load_term(cur, term_id), assignments)
    open(a.out, "w", encoding="utf8").write(text)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
