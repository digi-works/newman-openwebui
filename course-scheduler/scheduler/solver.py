"""Step B: the solver (Google OR-Tools CP-SAT). Gives every section that meets at a set time a time slot and a room, so that no room
and no instructor is double-booked, rooms fit, a lab never overlaps its lecture and nobody teaches at a time they can't.

How it works with Newman's data:
- Instructors are kept as given (a chair already chose them); the solver decides times and rooms.
- It starts from a timetable (normally the one the university ran) and changes as little as it can: each time or room it changes costs
  something, so the draft stays familiar. With fresh=True nothing is kept and it builds from the same meeting patterns.
- A section keeps its meeting pattern (same days per week and minutes per meeting, e.g. Tue/Thu 75 minutes), unless it had no time at all.
- Sections taught together (combined_sections) move as one class: one time, one room for the ones on campus, credits once.
- Partner colleges and hospitals set their own times: those sections keep their time and site; a campus section taught with them keeps
  the time too, but can get a room.
- Hard rules are constraints (never broken). Soft rules are costs: keeping the old time and room, required courses not in the evening,
  instructors' preferred times, students' guessed groups.
Every draft is checked by the checker afterwards, so the result never rests on the solver alone.

    solve(term, base, settings) -> Result
"""
import hashlib, json
from collections import defaultdict
from dataclasses import asdict, dataclass, field

from ortools.sat.python import cp_model

from .checker import SLOT_FITS, WHOLE_SITES, Practices
from .model import Assignment, Section, Slot, Term

VERSION = "cpsat-1"


@dataclass(frozen=True)
class Settings:
    fresh: bool = False            # True: ignore the base timetable's times and rooms (still keep instructors and meeting patterns)
    time_limit: float = 60.0       # seconds
    keep_time: int = 10            # cost of moving a section to another time
    keep_room: int = 3             # cost of moving a section to another room
    evening_required: int = 2      # cost of a required course in the evening (guessed groups)
    preference: int = 1            # cost of a time outside the instructor's preferred times
    student_clash: int = 4         # cost of two single-section required courses of one student group overlapping (guessed groups)
    unplaced: int = 1000           # cost of leaving a section without a time and room (only when nothing fits)
    taught_together: bool = True
    clinical_supervision: bool = True

    @property
    def practices(self):
        return Practices(self.taught_together, self.clinical_supervision)


@dataclass
class Unit:
    """One class to place: a section, or sections taught together as one meeting."""
    uid: str
    members: list                  # section_ids
    faculty: str | None
    base_slot: str | None
    base_room: str | None
    slots: list = field(default_factory=list)      # candidate slot_ids
    room_type: str | None = None   # campus room needed (None = no campus room)
    seats: int = 0
    rooms: list = field(default_factory=list)      # candidate room_ids
    frozen_time: bool = False      # a partner college or hospital sets the time
    clinical: bool = False         # only hospital clinicals: don't block the instructor (clinical supervision)


@dataclass
class Result:
    status: str                    # optimal, feasible, infeasible, unknown
    assignments: list              # one Assignment per section, the base copied for sections the solver doesn't place
    reasons: dict                  # section_id -> plain reason
    placed: int
    unplaced: list                 # section_ids the solver couldn't place
    moved_time: list
    moved_room: list
    objective: float
    seconds: float
    settings: Settings


def _minutes(t):
    return t.hour * 60 + t.minute


def _pattern(slot: Slot):
    return len(slot.days), _minutes(slot.end) - _minutes(slot.start)


def _segments(term: Term):
    """The term cut into stretches of weeks (e.g. first and second 8 weeks), so sections in different parts of the term never clash."""
    cuts = sorted({d for s in term.sections.values() for d in (s.first_date, s.last_date) if d})
    return cuts


def _covers(cuts, s: Section):
    """The week stretches a section runs in, as indexes between consecutive cut dates."""
    if not s.first_date or not s.last_date or len(cuts) < 2:
        return frozenset({-1})
    out = set()
    for i in range(len(cuts) - 1):
        a, b = cuts[i], cuts[i + 1]
        if s.first_date < b and a < s.last_date or (s.first_date == s.last_date == a):
            out.add(i)
    return frozenset(out or {-1})


def build_units(term: Term, base: list, settings: Settings) -> tuple:
    """The classes to place, and the sections the solver leaves as they are (no set time: online on their own time, arranged)."""
    by = {a.section_id: a for a in base}
    groups = defaultdict(list)
    for sid, s in term.sections.items():
        if not s.slot_kind:
            continue
        g = term.together.get(sid) if settings.taught_together else None
        a = by.get(sid)
        # only sections that really met together stay together (same group, same time, same instructor)
        key = (g, a.slot_id if a else None, a.faculty_id if a else None) if g else ("solo", sid)
        groups[key].append(sid)

    units = []
    for key, members in sorted(groups.items(), key=lambda kv: kv[1][0]):
        members.sort()
        lead = members[0]
        a = by.get(lead) or Assignment(lead)
        secs = [term.sections[m] for m in members]
        faculty = a.faculty_id or next((s.fixed_faculty_id for s in secs if s.fixed_faculty_id), None)
        campus = [s for s in secs if s.required_room_type and s.required_room_type not in WHOLE_SITES]
        sites = [s for s in secs if s.required_room_type in WHOLE_SITES]
        u = Unit(uid=lead if len(members) == 1 else f"{key[0]}", members=members, faculty=faculty, base_slot=a.slot_id,
                 base_room=next((by[m].room_id for m in members if m in by and by[m].room_id in term.rooms
                                 and term.rooms[by[m].room_id].room_type not in WHOLE_SITES), None),
                 frozen_time=bool(sites) and bool(a.slot_id), clinical=all(s.required_room_type == "clinical_site" for s in secs))
        if campus:
            u.room_type = campus[0].required_room_type
            u.seats = sum(s.seat_cap for s in campus)
        units.append(u)

    for u in units:
        u.slots = _candidate_slots(term, u, by, settings)
        if u.room_type:
            u.rooms = sorted(r.room_id for r in term.rooms.values()
                             if r.is_active and r.room_type == u.room_type and r.room_type not in WHOLE_SITES
                             and (r.capacity >= u.seats or r.room_id == u.base_room))   # a room the class already met in fits it
    return units


def _candidate_slots(term: Term, u: Unit, by: dict, settings: Settings) -> list:
    s = term.sections[u.members[0]]
    base = term.slots.get(u.base_slot) if u.base_slot else None
    if u.frozen_time and base:
        return [base.slot_id]
    fits = SLOT_FITS.get(s.slot_kind, {s.slot_kind})
    out = []
    for x in term.slots.values():
        if base and _pattern(x) != _pattern(base):
            continue
        if not base and x.kind not in fits:
            continue
        if base and x.kind not in fits | {base.kind}:
            continue
        if u.faculty and any(w.overlaps(x) for w in term.unavailable.get(u.faculty, [])):
            continue   # never at a time the instructor can't teach, not even the old time
        out.append(x.slot_id)
    return sorted(out)


def solve(term: Term, base: list, settings: Settings = Settings()) -> Result:
    by = {a.section_id: a for a in base}
    units = build_units(term, base, settings)
    cuts = _segments(term)
    weeks = {u.uid: frozenset().union(*(_covers(cuts, term.sections[m]) for m in u.members)) for u in units}

    m = cp_model.CpModel()
    y = {}      # (uid, slot) -> placed at that time
    x = {}      # (uid, slot, room) -> placed at that time in that room
    off = {}    # uid -> not placed
    for u in units:
        for sl in u.slots:
            y[u.uid, sl] = m.NewBoolVar(f"y|{u.uid}|{sl}")
            if u.room_type:
                xs = [m.NewBoolVar(f"x|{u.uid}|{sl}|{r}") for r in u.rooms]
                for r, v in zip(u.rooms, xs):
                    x[u.uid, sl, r] = v
                m.Add(sum(xs) == y[u.uid, sl])   # no room that fits -> this time can't be used
        off[u.uid] = m.NewBoolVar(f"off|{u.uid}")
        m.AddExactlyOne([y[u.uid, sl] for sl in u.slots] + [off[u.uid]])

    # ---- no room and no instructor double-booked: at every moment a meeting can start, at most one class ----
    def moments(slot_ids):
        return {(d, _minutes(term.slots[s].start)) for s in slot_ids for d in term.slots[s].days}

    def covering(slot_id, d, t):
        sl = term.slots[slot_id]
        return d in sl.days and _minutes(sl.start) <= t < _minutes(sl.end)

    all_moments = moments({sl for u in units for sl in u.slots})
    in_room = defaultdict(list)    # room -> [(unit, slot, var)]
    for (uid, sl, r), v in x.items():
        in_room[r].append((uid, sl, v))
    teaching = defaultdict(list)   # faculty -> [(unit, slot, var)]
    for u in units:
        if u.faculty and not (settings.clinical_supervision and u.clinical):
            for sl in u.slots:
                teaching[u.faculty].append((u.uid, sl, y[u.uid, sl]))

    def at_most_one_at_each_moment(items):
        segs = sorted({g for uid, _, _ in items for g in weeks[uid]})
        for d, t in all_moments:
            here = [(uid, v) for uid, sl, v in items if covering(sl, d, t)]
            if len(here) < 2:
                continue
            for g in segs:
                vs = [v for uid, v in here if g in weeks[uid] or -1 in weeks[uid]]
                if len(vs) > 1:
                    m.AddAtMostOne(vs)

    for items in in_room.values():
        at_most_one_at_each_moment(items)
    for items in teaching.values():
        at_most_one_at_each_moment(items)

    # ---- a lab never overlaps its own lecture ----
    unit_of = {mid: u for u in units for mid in u.members}
    for sid, s in term.sections.items():
        if not s.linked_section_id or sid not in unit_of or s.linked_section_id not in unit_of:
            continue
        a, b = unit_of[sid], unit_of[s.linked_section_id]
        if a is b or not (weeks[a.uid] & weeks[b.uid] or -1 in weeks[a.uid] | weeks[b.uid]):
            continue
        for s1 in a.slots:
            for s2 in b.slots:
                if term.slots[s1].overlaps(term.slots[s2]):
                    m.AddBoolOr([y[a.uid, s1].Not(), y[b.uid, s2].Not()])

    # ---- costs ----
    cost = []
    in_a_group = {c for _, cids in term.groups.values() for c in cids}
    for u in units:
        cost.append(settings.unplaced * off[u.uid])
        secs = [term.sections[mid] for mid in u.members]
        for sl in u.slots:
            slot = term.slots[sl]
            c = 0
            if not settings.fresh and u.base_slot and sl != u.base_slot:
                c += settings.keep_time
            if slot.kind == "evening" and any(s.course_id in in_a_group for s in secs):
                c += settings.evening_required
            prefs = term.preferred.get(u.faculty, []) if u.faculty else []
            if prefs and not any(w.contains(slot) for w in prefs):
                c += settings.preference
            if c:
                cost.append(c * y[u.uid, sl])
        if u.room_type and not settings.fresh and u.base_room:
            kept = [x[u.uid, sl, u.base_room] for sl in u.slots if (u.uid, sl, u.base_room) in x]
            cost.append(settings.keep_room * (1 - off[u.uid]) - settings.keep_room * sum(kept))

    # students (guessed groups): two required courses that each have one class only should not overlap
    single = defaultdict(list)
    for u in units:
        for mid in u.members:
            single[term.sections[mid].course_id].append(u)
    single = {c: us[0] for c, us in single.items() if len({id(v) for v in us}) == 1}
    seen = set()
    for _, cids in term.groups.values():
        cs = sorted({c for c in cids if c in single})
        for i, c1 in enumerate(cs):
            for c2 in cs[i + 1:]:
                a, b = single[c1], single[c2]
                if a is b or (a.uid, b.uid) in seen:
                    continue
                seen.add((a.uid, b.uid))
                for s1 in a.slots:
                    for s2 in b.slots:
                        if term.slots[s1].overlaps(term.slots[s2]):
                            both = m.NewBoolVar("")
                            m.Add(both >= y[a.uid, s1] + y[b.uid, s2] - 1)
                            cost.append(settings.student_clash * both)
    m.Minimize(sum(cost))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = settings.time_limit
    solver.parameters.num_workers = 8
    solver.parameters.random_seed = 2026
    code = solver.Solve(m)
    status = {cp_model.OPTIMAL: "optimal", cp_model.FEASIBLE: "feasible", cp_model.INFEASIBLE: "infeasible"}.get(code, "unknown")
    if status not in ("optimal", "feasible"):
        return Result(status, list(base), {}, 0, [], [], [], 0, solver.WallTime(), settings)

    out, reasons, unplaced, moved_t, moved_r = {}, {}, [], [], []
    for u in units:
        if solver.Value(off[u.uid]):
            unplaced += u.members
            for mid in u.members:
                out[mid] = Assignment(mid, None, None, u.faculty)
                reasons[mid] = (f"No {u.room_type} room for {u.seats} seats exists." if u.room_type and not u.rooms
                                else f"No {u.room_type} room for {u.seats} seats is free at any of its {len(u.slots)} possible times." if u.room_type
                                else "Every possible time clashes with its instructor's other classes or can't-teach times.")
            continue
        sl = next(s for s in u.slots if solver.Value(y[u.uid, s]))
        room = next((r for r in u.rooms if solver.Value(x[u.uid, sl, r])), None) if u.room_type else None
        for mid in u.members:
            b = by.get(mid) or Assignment(mid)
            keeps_site = term.sections[mid].required_room_type in WHOLE_SITES or not term.sections[mid].required_room_type
            r = b.room_id if keeps_site else room
            out[mid] = Assignment(mid, sl, r, b.faculty_id or u.faculty)
            why = []
            if b.slot_id != sl:
                why.append(f"new time (was {b.slot_id or 'none'})")
                moved_t.append(mid)
            if r != b.room_id:
                why.append(f"new room (was {b.room_id or 'none'})")
                moved_r.append(mid)
            text = "; ".join(why)
            reasons[mid] = "Kept as run." if not why else text[0].upper() + text[1:] + "."
    for a in base:   # sections with no set time, and anything not in a unit, stay as they were
        if a.section_id not in out and a.section_id in term.sections:
            out[a.section_id] = a
            reasons[a.section_id] = "No set time: kept as given."
    rows = [out[s] for s in sorted(out)]
    return Result(status, rows, reasons, len(rows) - len(unplaced), sorted(unplaced), sorted(moved_t), sorted(moved_r),
                  solver.ObjectiveValue(), solver.WallTime(), settings)


def input_hash(term: Term, base: list, settings: Settings) -> str:
    h = hashlib.sha256()
    h.update(json.dumps(asdict(settings), sort_keys=True).encode())
    h.update(json.dumps(sorted((a.section_id, a.slot_id, a.room_id, a.faculty_id) for a in base), default=str).encode())
    h.update(json.dumps(sorted((k, sorted(v)) for k, v in ((g, [s for s, x in term.together.items() if x == g]) for g in set(term.together.values())))).encode())
    h.update(VERSION.encode())
    return h.hexdigest()[:16]
