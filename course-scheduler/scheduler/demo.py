"""A deliberately bad timetable built from the mock data: each case breaks one rule on purpose, so we can see the checker catch it.

The mock term (2027SP) is built in memory from the catalog; course_scheduling now holds the real data, so it is not read.

    .venv/bin/python -m scheduler.demo                       # writes mock/bad_timetable.csv and lists what was broken on purpose
    .venv/bin/python -m scheduler.check --csv mock/bad_timetable.csv --mock --partial
"""
import csv, sys

import psycopg

from .model import ROOT, Assignment, Term, database_url, mock_term

TERM = "2027SP"


def bad_timetable(term: Term):
    """(assignments, expected) where expected maps each section broken on purpose to the rule it breaks."""
    secs = sorted(term.sections.values(), key=lambda s: s.section_id)
    lecture_slots = sorted(sid for sid, s in term.slots.items() if s.kind == "lecture")
    lab_slots = sorted(sid for sid, s in term.slots.items() if s.kind == "lab")
    evening = sorted(sid for sid, s in term.slots.items() if s.kind == "evening")
    rows, expected, used_rooms, used_fac = [], {}, set(), set()
    nxt = iter(lecture_slots * 4)

    def room(s, avoid=()):
        r = next(r for r in sorted(term.rooms.values(), key=lambda r: (r.capacity, r.room_id))
                 if r.room_type == s.required_room_type and r.capacity >= s.seat_cap and r.room_id not in used_rooms and r.room_id not in avoid)
        used_rooms.add(r.room_id); return r.room_id

    def teacher(s):
        """A qualified person not used yet: someone with no limits if possible, else anyone qualified."""
        ok = [f for f in sorted(term.faculty) if term.qualified(f, s) and (not s.fixed_faculty_id or f == s.fixed_faculty_id)]
        f = next((f for f in ok if f not in used_fac and not term.unavailable.get(f) and not term.preferred.get(f)), None) \
            or next((f for f in ok if f not in used_fac), None) or ok[0]
        used_fac.add(f); return f

    taken = set()

    def add(s, slot, rm, fac, rule=None):
        assert s.section_id not in taken, f"{s.section_id} picked twice"
        taken.add(s.section_id); rows.append(Assignment(s.section_id, slot, rm, fac))
        if rule: expected[s.section_id] = rule

    reserved = set()

    def pick(pred):
        """The first section not used yet that matches; it is reserved at once so the next pick cannot return it."""
        s = next(s for s in secs if s.section_id not in taken and s.section_id not in reserved and pred(s))
        reserved.add(s.section_id); return s

    lectures = [s for s in secs if s.slot_kind == "lecture" and s.required_room_type == "lecture" and not s.fixed_faculty_id and not s.linked_section_id]
    group_courses = {c for _, cids in term.groups.values() for c in cids}
    plain = {s.section_id for s in lectures if s.course_id not in group_courses}

    class _Free:
        def __next__(self): return pick(lambda s: s.section_id in plain)
    free = _Free()

    big = max(lectures, key=lambda s: s.seat_cap)                                     # 90 seats in a small room
    small = min((r for r in term.rooms.values() if r.room_type == "lecture"), key=lambda r: r.capacity).room_id
    add(big, next(nxt), small, teacher(big), "ROOM_TOO_SMALL"); used_rooms.add(small)

    a, b = next(free), next(free)                                                     # same room, same time
    shared, slot = room(a), next(nxt)
    add(a, slot, shared, teacher(a)); add(b, slot, shared, teacher(b), "ROOM_DOUBLE_BOOKED")

    lab = pick(lambda s: s.required_room_type == "science_lab" and not s.linked_section_id)
    add(lab, lab_slots[0], room(next(free)), teacher(lab), "ROOM_TYPE_MISMATCH")      # a science lab in a lecture room
    lab2 = pick(lambda s: s.required_room_type == "science_lab" and s is not lab and not s.linked_section_id)
    add(lab2, next(nxt), room(lab2), teacher(lab2), "SLOT_KIND_MISMATCH")             # a lab in a lecture slot

    c = next(free); add(c, next(nxt), None, teacher(c), "MISSING_ROOM")
    online = pick(lambda s: s.delivery_mode == "ONLINE_ASYNC")
    add(online, None, room(next(free)), teacher(online), "ROOM_NOT_NEEDED")
    arranged = pick(lambda s: s.delivery_mode == "ARRANGED")
    add(arranged, next(nxt), None, teacher(arranged), "SLOT_NOT_NEEDED")

    single = pick(lambda s: s.required_room_type == "lecture" and len([f for f in term.faculty if term.qualified(f, s)]) == 1)
    wrong = next(f for f in sorted(term.faculty) if not term.qualified(f, single) and f not in used_fac); used_fac.add(wrong)
    add(single, next(nxt), room(single), wrong, "FACULTY_NOT_QUALIFIED")

    fixed = pick(lambda s: s.fixed_faculty_id and s.required_room_type)
    other = next(f for f in sorted(term.faculty) if f != fixed.fixed_faculty_id and term.qualified(f, fixed) and f not in used_fac) \
        if any(f != fixed.fixed_faculty_id and term.qualified(f, fixed) for f in term.faculty) else next(f for f in sorted(term.faculty) if f not in used_fac)
    used_fac.add(other); add(fixed, next(nxt), room(fixed), other, "FIXED_FACULTY_CHANGED")

    d1, d2 = next(free), next(free)                                                   # one person, two rooms, same time
    both = next(f for f in sorted(term.faculty) if term.qualified(f, d1) and term.qualified(f, d2) and f not in used_fac and not term.unavailable.get(f) and not term.preferred.get(f))
    used_fac.add(both); slot = next(nxt)
    add(d1, slot, room(d1), both); add(d2, slot, room(d2), both, "FACULTY_DOUBLE_BOOKED")

    away = next(f for f in sorted(term.unavailable) if any(w.days == "TR" for w in term.unavailable[f]))   # the professor who can't teach Tue/Thu
    s = pick(lambda s: s.section_id in plain and term.qualified(away, s))
    add(s, next(x for x in lecture_slots if x.startswith("TR")), room(s), away, "FACULTY_UNAVAILABLE"); used_fac.add(away)

    adj = next(f for f in sorted(term.faculty) if f.startswith("A-") and f not in used_fac and not term.unavailable.get(f) and not term.preferred.get(f)
               and sum(term.sections[x.section_id].credits for x in rows if x.faculty_id == f) == 0
               and sum(s.credits for s in lectures if term.qualified(f, s)) > term.faculty[f].max_credit_load)
    used_fac.add(adj); load = 0
    for s in [s for s in lectures if term.qualified(adj, s) and s.section_id not in taken]:
        add(s, next(nxt), room(s), adj, "FACULTY_OVERLOADED" if load + s.credits > term.faculty[adj].max_credit_load else None)
        load += s.credits
        if load > term.faculty[adj].max_credit_load: break

    lab3 = pick(lambda s: s.linked_section_id and s.slot_kind == "lab" and s.linked_section_id not in taken and s.required_room_type)       # a lab on top of its own lecture
    lec = term.sections[lab3.linked_section_id]
    lab_slot = lab_slots[0]
    lec_slot = next(x for x in lecture_slots if term.slots[x].overlaps(term.slots[lab_slot]))
    add(lec, lec_slot, room(lec), teacher(lec)); add(lab3, lab_slot, room(lab3), teacher(lab3), "LAB_LECTURE_OVERLAP")

    gid, (label, cids) = next((g, v) for g, v in sorted(term.groups.items())        # two required courses at the same time
                              if sum(1 for c in v[1] if [s for s in secs if s.course_id == c and s.section_id not in taken and s.slot_kind == "lecture" and s.required_room_type == "lecture" and not s.fixed_faculty_id]) >= 2)
    ok = lambda s, c: s.course_id == c and s.section_id not in taken and s.slot_kind == "lecture" and s.required_room_type == "lecture" and not s.fixed_faculty_id
    g1, g2 = [next(s for s in secs if ok(s, c)) for c in cids if any(ok(s, c) for s in secs)][:2]
    slot = next(nxt)
    add(g1, slot, room(g1), teacher(g1)); add(g2, slot, room(g2), teacher(g2), "GROUP_OVERLAP")

    req = pick(lambda s: s in lectures and s.course_id in group_courses)
    add(req, evening[0], room(req), teacher(req), "REQUIRED_IN_EVENING")
    return rows, expected


def main():
    with psycopg.connect(database_url()) as conn, conn.cursor() as cur:
        term = mock_term(cur)
    rows, expected = bad_timetable(term)
    out = ROOT / "mock" / "bad_timetable.csv"
    with open(out, "w", newline="", encoding="utf8") as f:
        w = csv.writer(f); w.writerow(["section_id", "slot_id", "room_id", "faculty_id", "broken_on_purpose"])
        for a in rows: w.writerow([a.section_id, a.slot_id or "", a.room_id or "", a.faculty_id or "", expected.get(a.section_id, "")])
    print(f"wrote {out.relative_to(ROOT)}: {len(rows)} assignments, {len(set(expected.values()))} rules broken on purpose")
    for sid, rule in sorted(expected.items(), key=lambda kv: kv[1]): print(f"  {rule:22} {sid}")


if __name__ == "__main__":
    sys.exit(main())
