"""Suggested fixes for what the checker finds. Every suggestion is checked before it is offered: applied to the whole timetable it must
remove the finding and add no new hard finding. Nothing is changed; a person picks a fix (screen 6, or Ask Digi).

    fixes_for(term, assignments, violation) -> [Fix]
"""
from dataclasses import dataclass, replace
from datetime import datetime

from .checker import HARD, SLOT_FITS, WHOLE_SITES, Practices, _clash, check
from .model import Assignment, Term

MAX_FIXES = 3
MAX_TRIES = 40   # candidates checked per finding


@dataclass(frozen=True)
class Fix:
    text: str
    changes: tuple   # Assignments to put in place of the current ones

    def as_json(self):
        return {"text": self.text, "changes": [a.__dict__ for a in self.changes]}


def _minutes(slot):
    d = lambda t: t.hour * 60 + t.minute
    return (d(slot.end) - d(slot.start)) * len(slot.days)


def _busy(term, by, who, sid, slot, practices):
    """Sections (other than sid and its taught-together partners) that meet at slot and use `who` (a room id or a faculty id)."""
    s = term.sections[sid]
    mine = term.together.get(sid) if practices.taught_together else None
    out = []
    for other, a in by.items():
        if other == sid or not a.slot_id or (mine and term.together.get(other) == mine):
            continue
        if who not in (a.room_id, a.faculty_id):
            continue
        o_slot = term.slots.get(a.slot_id)
        if o_slot and _clash(s, slot, term.sections[other], o_slot):
            out.append(other)
    return out


def free_rooms(term, by, sid, slot, practices=Practices()):
    """Rooms of the right type, big enough, in use and free at slot; same building first, then the snuggest fit."""
    s, cur = term.sections[sid], by.get(sid)
    here = term.rooms.get(cur.room_id).building_id if cur and cur.room_id in term.rooms else None
    rooms = [r for r in term.rooms.values() if r.is_active and r.room_type == s.required_room_type and r.room_type not in WHOLE_SITES
             and r.capacity >= s.seat_cap and (not cur or r.room_id != cur.room_id)]
    rooms.sort(key=lambda r: (r.building_id != here, r.capacity, r.room_id))
    return [r for r in rooms if not _busy(term, by, r.room_id, sid, slot, practices)]


def free_slots(term, by, sid, practices=Practices()):
    """Other times of the same kind and length where the instructor and the room are both free and the instructor can teach."""
    s, cur = term.sections[sid], by[sid]
    now = term.slots[cur.slot_id]
    fits = SLOT_FITS.get(s.slot_kind, {s.slot_kind})
    cands = [x for x in term.slots.values() if x.kind in fits and x.slot_id != now.slot_id and _minutes(x) == _minutes(now) and len(x.days) == len(now.days)]
    start = lambda x: x.start.hour * 60 + x.start.minute
    cands.sort(key=lambda x: (x.days != now.days, abs(start(x) - start(now)), x.slot_id))
    out = []
    for x in cands:
        if cur.faculty_id and (_busy(term, by, cur.faculty_id, sid, x, practices) or any(w.overlaps(x) for w in term.unavailable.get(cur.faculty_id, []))):
            continue
        if cur.room_id and term.rooms.get(cur.room_id) and term.rooms[cur.room_id].room_type not in WHOLE_SITES and _busy(term, by, cur.room_id, sid, x, practices):
            continue
        out.append(x)
    return out


def free_faculty(term, by, sid, practices=Practices()):
    """Instructors qualified for the course (they teach it this term), free at its time and under their maximum load; lightest load first."""
    s, cur = term.sections[sid], by.get(sid)
    slot = term.slots.get(cur.slot_id) if cur and cur.slot_id else None
    load = {}
    for a in by.values():
        if a.faculty_id: load[a.faculty_id] = load.get(a.faculty_id, 0) + term.sections[a.section_id].credits
    out = []
    for f in term.faculty.values():
        if not term.qualified(f.faculty_id, s) or load.get(f.faculty_id, 0) + s.credits > f.max_credit_load:
            continue
        if slot and (_busy(term, by, f.faculty_id, sid, slot, practices) or any(w.overlaps(slot) for w in term.unavailable.get(f.faculty_id, []))):
            continue
        out.append(f)
    return sorted(out, key=lambda f: (load.get(f.faculty_id, 0), f.faculty_id))


def _hard(found):
    return {(v.rule_code, v.section_ids) for v in found if v.severity == HARD}


def _verified(term, assignments, by, changes, target, before, practices):
    """The changes remove the target finding and add no new hard finding."""
    new = {a.section_id: a for a in changes}
    after = _hard(check(term, [new.get(a.section_id, a) for a in assignments] + [a for s, a in new.items() if s not in by], practices=practices))
    return (target.rule_code, target.section_ids) not in after and after <= before


def _label(slot):
    t = lambda x: datetime.combine(datetime.today(), x).strftime("%-I:%M %p")
    return f"{slot.days} {t(slot.start)}-{t(slot.end)}"


def fixes_for(term: Term, assignments: list, v, practices: Practices = Practices(), before=None) -> list:
    """Up to MAX_FIXES checked fixes for one finding; [] when there is no safe fix or the finding is not one we fix."""
    by = {a.section_id: a for a in assignments}
    before = before if before is not None else _hard(check(term, assignments, practices=practices))
    cands = []   # (text, changes)

    def room_moves(sid):
        a = by.get(sid)
        slot = term.slots.get(a.slot_id) if a and a.slot_id else None
        if not slot: return
        for r in free_rooms(term, by, sid, slot, practices)[:MAX_TRIES]:
            cands.append((f"Move {sid} to {r.room_id} ({r.capacity} seats{', estimated' if 'capacity' in r.estimated else ''}), free at {_label(slot)}.",
                          (replace(a, room_id=r.room_id),)))

    code, ids = v.rule_code, list(v.section_ids)
    if code == "ROOM_DOUBLE_BOOKED":
        for sid in sorted(ids, key=lambda x: (term.sections[x].enrolled or term.sections[x].seat_cap, x)):   # move the smaller class first
            room_moves(sid)
    elif code in ("MISSING_ROOM", "ROOM_TOO_SMALL", "ROOM_TYPE_MISMATCH", "ROOM_INACTIVE"):
        room_moves(ids[0])
    elif code in ("FACULTY_DOUBLE_BOOKED", "LAB_LECTURE_OVERLAP", "FACULTY_UNAVAILABLE"):
        movable = [x for x in ids if by.get(x) and by[x].slot_id]
        if code == "LAB_LECTURE_OVERLAP":
            movable = [x for x in movable if term.sections[x].linked_section_id]   # move the lab, keep the lecture
        for sid in movable:
            for x in free_slots(term, by, sid, practices)[:MAX_TRIES]:
                cands.append((f"Move {sid} to {_label(x)}, same room and instructor.", (replace(by[sid], slot_id=x.slot_id),)))
    elif code == "MISSING_FACULTY" or (code == "NOT_PLACED" and not term.sections[ids[0]].slot_kind and not term.sections[ids[0]].required_room_type):
        sid = ids[0]
        a = by.get(sid) or Assignment(sid)
        for f in free_faculty(term, by, sid, practices)[:MAX_TRIES]:
            cands.append((f"Give {sid} to {f.name}, who teaches {term.sections[sid].course_id} this term and is free then.", (replace(a, faculty_id=f.faculty_id),)))

    out, seen = [], set()
    for text, changes in cands:
        if len(out) == MAX_FIXES: break
        if changes in seen: continue
        seen.add(changes)
        if _verified(term, assignments, by, changes, v, before, practices):
            out.append(Fix(text, changes))
    return out
