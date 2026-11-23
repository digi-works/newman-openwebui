"""Finds sections taught together in a timetable as run: one instructor teaching several sections at one time as one meeting.

Two kinds, both normal at Newman and not clashes:
- same_room: stacked or cross-listed courses in one room (e.g. a 3000- and a 5000-level course taught as one class);
- multi_site: one class reaching several places at once (a campus room plus a partner college, or plus a live online section).

Used by real/load_real.py to fill course_scheduling.combined_sections from the university's own timetable. A solver never infers these:
it only keeps sections together that are listed there (by this inference, or by the registrar).
"""
from .checker import WHOLE_SITES
from .model import Term


def infer(term: Term, assignments: list) -> list:
    """[(combine_id, section_id, kind)] for every group of two or more sections that meet together."""
    by = {a.section_id: a for a in assignments if a.section_id in term.sections}
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            x = parent[x]
        return x

    def join(a, b):
        parent[find(a)] = find(b)

    def off_campus(a):
        r = term.rooms.get(a.room_id) if a.room_id else None
        return r is None or r.room_type in WHOLE_SITES - {"clinical_site"}   # no room (live online) or a partner college

    timed = sorted((a for a in by.values() if a.slot_id and a.faculty_id), key=lambda a: a.section_id)
    for i, a in enumerate(timed):
        for b in timed[i + 1:]:
            if a.faculty_id != b.faculty_id or a.slot_id != b.slot_id or not term.sections[a.section_id].same_weeks(term.sections[b.section_id]):
                continue
            if (a.room_id and a.room_id == b.room_id) or (a.room_id != b.room_id and (off_campus(a) or off_campus(b))):
                join(a.section_id, b.section_id)

    groups = {}
    for sid in by:
        groups.setdefault(find(sid), []).append(sid)
    out = []
    for n, (_, ids) in enumerate(sorted((k, sorted(v)) for k, v in groups.items() if len(v) > 1)):
        rooms = {by[s].room_id for s in ids}
        kind = "same_room" if len(rooms) == 1 else "multi_site"
        out += [(f"{term.term_id}-TT-{n + 1:03d}", s, kind) for s in ids]
    return out
