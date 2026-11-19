"""Step 2: the checker. Takes any timetable (from the solver, a planner's edits or a hand-made file) and lists every broken rule.

Hard rules must never be broken; soft rules are preferences the solver tries to meet. Each finding names the rule, the sections
involved and a plain reason, so it can be shown to a planner as is.
"""
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from .model import Assignment, Term

HARD, SOFT = "hard", "soft"

# rule_code -> (severity, what it means)
RULES = {
    "UNKNOWN_SECTION":       (HARD, "The timetable names a section that is not in this term."),
    "DUPLICATE_ASSIGNMENT":  (HARD, "A section appears more than once in the timetable."),
    "NOT_PLACED":            (HARD, "A section has no assignment at all."),
    "UNKNOWN_SLOT":          (HARD, "The time slot does not exist."),
    "UNKNOWN_ROOM":          (HARD, "The room does not exist."),
    "UNKNOWN_FACULTY":       (HARD, "The faculty member does not exist or is inactive."),
    "MISSING_SLOT":          (HARD, "The section meets at a set time but has no time slot."),
    "SLOT_NOT_NEEDED":       (HARD, "The section has no meeting time (online on its own time, or arranged) but was given a slot."),
    "SLOT_KIND_MISMATCH":    (HARD, "A lab is not in a lab block, or a lecture is in a lab block."),
    "MISSING_ROOM":          (HARD, "The section needs a room but has none."),
    "ROOM_NOT_NEEDED":       (HARD, "The section does not use a room (online or arranged) but was given one."),
    "ROOM_TYPE_MISMATCH":    (HARD, "The room is the wrong type for the course."),
    "ROOM_TOO_SMALL":        (HARD, "The room has fewer seats than the section's seat cap."),
    "ROOM_INACTIVE":         (HARD, "The room is not in use."),
    "ROOM_DOUBLE_BOOKED":    (HARD, "Two sections are in the same room at overlapping times."),
    "MISSING_FACULTY":       (HARD, "The section has no faculty member."),
    "FACULTY_NOT_QUALIFIED": (HARD, "The faculty member is not qualified to teach the course."),
    "FIXED_FACULTY_CHANGED": (HARD, "A chair already assigned this section to someone else."),
    "FACULTY_DOUBLE_BOOKED": (HARD, "A faculty member teaches two sections at overlapping times."),
    "FACULTY_UNAVAILABLE":   (HARD, "The section is at a time the faculty member cannot teach."),
    "FACULTY_OVERLOADED":    (HARD, "The faculty member's credits are over their maximum load."),
    "LAB_LECTURE_OVERLAP":   (HARD, "A lab overlaps its own lecture."),
    "GROUP_OVERLAP":         (HARD, "Students who need both courses cannot take them: every section of one overlaps every section of the other."),
    "GROUP_NO_COMBINATION":  (HARD, "Students in this group cannot build a clash-free week from the sections offered."),
    "GROUP_CHECK_LIMIT":     (SOFT, "The group has too many combinations to check fully; the pairwise check found no clash."),
    "REQUIRED_IN_EVENING":   (SOFT, "A required course is in an evening slot."),
    "PREFERENCE_MISSED":     (SOFT, "The section is outside the faculty member's preferred times."),
}

SLOT_FITS = {"lecture": {"lecture", "evening"}, "lab": {"lab"}}
WHOLE_SITES = {"off_site", "clinical_site"}   # a partner college or hospital: many rooms under one code, so never double-booked
SEARCH_LIMIT = 200_000   # combinations tried per student group before giving up


def _clash(s1, slot1, s2, slot2) -> bool:
    """Two sections meet at the same time: their slots overlap and they run in the same weeks of the term."""
    return slot1.overlaps(slot2) and s1.same_weeks(s2)


@dataclass(frozen=True)
class Violation:
    rule_code: str
    section_ids: tuple
    detail: str

    @property
    def severity(self) -> str:
        return RULES[self.rule_code][0]


def check(term: Term, assignments: list, partial: bool = False) -> list:
    """Every broken rule in the timetable. partial=True checks only the sections listed (for a planner's edit, or a hand-made sample)."""
    out = []

    def bad(code, ids, detail):
        out.append(Violation(code, tuple(sorted(ids)), detail))

    # ---- one assignment per section ----
    by_sec = {}
    for a in assignments:
        if a.section_id not in term.sections:
            bad("UNKNOWN_SECTION", [a.section_id], f"{a.section_id} is not a {term.term_id} section."); continue
        if a.section_id in by_sec:
            bad("DUPLICATE_ASSIGNMENT", [a.section_id], f"{a.section_id} is listed more than once; the first entry is checked."); continue
        by_sec[a.section_id] = a

    # ---- each section on its own ----
    placed = {}   # section_id -> (section, slot or None, room or None, faculty_id or None)
    for sid in sorted(term.sections):
        s = term.sections[sid]
        a = by_sec.get(sid)
        if a is None or not (a.slot_id or a.room_id or a.faculty_id):
            if not partial:
                bad("NOT_PLACED", [sid], f"{sid} has no time, room or faculty.")
            continue
        slot = term.slots.get(a.slot_id) if a.slot_id else None
        room = term.rooms.get(a.room_id) if a.room_id else None
        fid = a.faculty_id if a.faculty_id in term.faculty else None
        if a.slot_id and not slot: bad("UNKNOWN_SLOT", [sid], f"{sid}: slot {a.slot_id} does not exist.")
        if a.room_id and not room: bad("UNKNOWN_ROOM", [sid], f"{sid}: room {a.room_id} does not exist.")
        if a.faculty_id and not fid: bad("UNKNOWN_FACULTY", [sid], f"{sid}: faculty {a.faculty_id} does not exist or is inactive.")

        if s.slot_kind:
            if not a.slot_id:
                bad("MISSING_SLOT", [sid], f"{sid} ({s.delivery_mode}) needs a {s.slot_kind} time slot.")
            elif slot and slot.kind not in SLOT_FITS[s.slot_kind]:
                bad("SLOT_KIND_MISMATCH", [sid], f"{sid} is a {s.slot_kind} section but {slot.slot_id} is a {slot.kind} slot.")
        elif a.slot_id:
            bad("SLOT_NOT_NEEDED", [sid], f"{sid} is {s.delivery_mode} and has no meeting time, but was given {a.slot_id}.")

        if s.required_room_type:
            if not a.room_id:
                bad("MISSING_ROOM", [sid], f"{sid} needs a {s.required_room_type} room.")
            elif room:
                if room.room_type != s.required_room_type:
                    bad("ROOM_TYPE_MISMATCH", [sid], f"{sid} needs a {s.required_room_type} room; {room.room_id} is a {room.room_type}.")
                if room.capacity < s.seat_cap:
                    bad("ROOM_TOO_SMALL", [sid], f"{sid} has {s.seat_cap} seats; {room.room_id} holds {room.capacity}.")
                if not room.is_active:
                    bad("ROOM_INACTIVE", [sid], f"{sid}: room {room.room_id} is not in use.")
        elif a.room_id:
            bad("ROOM_NOT_NEEDED", [sid], f"{sid} is {s.delivery_mode} and uses no room, but was given {a.room_id}.")

        if not a.faculty_id:
            bad("MISSING_FACULTY", [sid], f"{sid} has no faculty member.")
        elif fid:
            if not term.qualified(fid, s):
                bad("FACULTY_NOT_QUALIFIED", [sid], f"{fid} is not qualified to teach {s.course_id}.")
            if s.fixed_faculty_id and fid != s.fixed_faculty_id:
                bad("FIXED_FACULTY_CHANGED", [sid], f"{sid} was assigned by a chair to {s.fixed_faculty_id}, not {fid}.")
        placed[sid] = (s, slot if s.slot_kind else None, room if s.required_room_type else None, fid)

    # ---- rooms and faculty at the same time ----
    in_room, teaching = defaultdict(list), defaultdict(list)
    for sid, (s, slot, room, fid) in placed.items():
        if slot and room and room.room_type not in WHOLE_SITES: in_room[room.room_id].append((sid, slot))
        if fid: teaching[fid].append((sid, slot, s.credits))
    sec = term.sections
    for rid, items in sorted(in_room.items()):
        for (a, sa), (b, sb) in combinations(sorted(items), 2):
            if _clash(sec[a], sa, sec[b], sb):
                bad("ROOM_DOUBLE_BOOKED", [a, b], f"{a} ({sa.slot_id}) and {b} ({sb.slot_id}) are both in {rid}.")
    for fid, items in sorted(teaching.items()):
        timed = sorted((sid, slot) for sid, slot, _ in items if slot)
        for (a, sa), (b, sb) in combinations(timed, 2):
            if _clash(sec[a], sa, sec[b], sb):
                bad("FACULTY_DOUBLE_BOOKED", [a, b], f"{fid} teaches {a} ({sa.slot_id}) and {b} ({sb.slot_id}) at the same time.")
        for sid, slot in timed:
            if any(w.overlaps(slot) for w in term.unavailable.get(fid, [])):
                bad("FACULTY_UNAVAILABLE", [sid], f"{fid} cannot teach at {slot.slot_id} ({slot.days} {slot.start:%H:%M}).")
            prefs = term.preferred.get(fid, [])
            if prefs and not any(w.contains(slot) for w in prefs):
                bad("PREFERENCE_MISSED", [sid], f"{sid} at {slot.slot_id} is outside {fid}'s preferred times.")
        load = sum(c for _, _, c in items)
        if load > term.faculty[fid].max_credit_load:
            bad("FACULTY_OVERLOADED", [sid for sid, _, _ in items], f"{fid} has {load:g} credits; the maximum is {term.faculty[fid].max_credit_load:g}.")

    # ---- a lab and its lecture ----
    for sid, (s, slot, _, _) in sorted(placed.items()):
        other = placed.get(s.linked_section_id) if s.linked_section_id else None
        if slot and other and other[1] and _clash(s, slot, other[0], other[1]):
            bad("LAB_LECTURE_OVERLAP", [sid, s.linked_section_id], f"Lab {sid} ({slot.slot_id}) overlaps its lecture {s.linked_section_id} ({other[1].slot_id}).")

    # ---- students: can a group build a clash-free week? ----
    timed_by_course = defaultdict(list)
    for sid, (s, slot, _, _) in placed.items():
        if slot: timed_by_course[s.course_id].append((sid, slot, s))
    in_a_group = set()
    for gid, (label, cids) in sorted(term.groups.items()):
        in_a_group.update(cids)
        options = {c: sorted(timed_by_course[c]) for c in cids if timed_by_course.get(c)}
        if len(options) < 2: continue
        clashing = [(c1, c2) for c1, c2 in combinations(sorted(options), 2)
                    if all(_clash(s1, x, s2, y) for _, x, s1 in options[c1] for _, y, s2 in options[c2])]
        for c1, c2 in clashing:
            ids = [sid for sid, _, _ in options[c1] + options[c2]]
            bad("GROUP_OVERLAP", ids, f"{label}: every section of {c1} overlaps every section of {c2}.")
        if clashing: continue
        found = _clash_free(options)
        if found is False:
            bad("GROUP_NO_COMBINATION", [sid for c in options for sid, _, _ in options[c]], f"{label}: no clash-free choice of one section per course ({len(options)} courses).")
        elif found is None:
            bad("GROUP_CHECK_LIMIT", [], f"{label}: {len(options)} courses, too many combinations to check fully.")

    for sid, (s, slot, _, _) in sorted(placed.items()):
        if slot and slot.kind == "evening" and s.course_id in in_a_group:
            bad("REQUIRED_IN_EVENING", [sid], f"{sid} is a required course in evening slot {slot.slot_id}.")
    return out


def _clash_free(options: dict):
    """True if one section per course can be chosen with no overlaps; False if not; None if the search hit its limit."""
    courses = sorted(options, key=lambda c: len(options[c]))
    chosen, tries = [], [0]

    def go(i):
        if i == len(courses): return True
        for _, slot, sec in options[courses[i]]:
            tries[0] += 1
            if tries[0] > SEARCH_LIMIT: raise _Limit
            if all(not _clash(sec, slot, s2, c) for s2, c in chosen):
                chosen.append((sec, slot))
                if go(i + 1): return True
                chosen.pop()
        return False
    try:
        return go(0)
    except _Limit:
        return None


class _Limit(Exception):
    pass


def summary(violations: list) -> dict:
    counts = defaultdict(int)
    for v in violations: counts[v.rule_code] += 1
    return dict(sorted(counts.items(), key=lambda kv: (RULES[kv[0]][0] != HARD, kv[0])))
