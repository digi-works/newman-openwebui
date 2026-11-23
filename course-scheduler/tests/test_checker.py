"""Checker rules on a small hand-made term. No database needed.

A clean timetable has no findings; each test breaks one rule and expects exactly that rule (and nothing else) to be reported.
"""
from dataclasses import replace
from datetime import time

import pytest

from scheduler.checker import RULES, check
from scheduler.model import Assignment, Faculty, Room, Section, Slot, Term, Window


def t(h, m=0): return time(h, m)


def make_term() -> Term:
    term = Term("TEST")
    for s in [Slot("MWF-0900", "MWF", t(9), t(9, 50), "lecture"), Slot("MWF-1000", "MWF", t(10), t(10, 50), "lecture"),
              Slot("TR-0930", "TR", t(9, 30), t(10, 45), "lecture"), Slot("LAB-M-0800", "M", t(8), t(10, 50), "lab"),
              Slot("LAB-R-1300", "R", t(13), t(15, 50), "lab"), Slot("EVE-MW-1800", "MW", t(18), t(19, 15), "evening")]:
        term.slots[s.slot_id] = s
    for r in [Room("L1", "DEM", 30, "lecture"), Room("L2", "DEM", 30, "lecture"), Room("BIG", "DEM", 100, "lecture"),
              Room("SMALL", "EDU", 10, "lecture"), Room("OLD", "EDU", 30, "lecture", is_active=False), Room("SL", "SCI", 20, "science_lab")]:
        term.rooms[r.room_id] = r
    for f in [Faculty("P1", "Prof 1", 12), Faculty("P2", "Prof 2", 12), Faculty("P3", "Prof 3", 12), Faculty("A1", "Adjunct 1", 3)]:
        term.faculty[f.faculty_id] = f
    term.quals = {"P1": {("BIOL", None)}, "P2": {("HIST", "HIST1013"), ("HIST", "HIST2013")},
                  "P3": {("HIST", "HIST1013"), ("HIST", "HIST2013")}, "A1": {("BIOL", "BIOL1003"), ("BIOL", "BIOL1001")}}
    term.unavailable = {"P2": [Window("TR", t(8), t(22))]}
    term.preferred = {"P1": [Window("MWF", t(8), t(12))]}
    for s in [Section("BIO-LEC", "BIOL1003", 3, 30, "IN_PERSON", "lecture", "lecture"),
              Section("BIO-LAB", "BIOL1001", 1, 20, "IN_PERSON", "lab", "science_lab", linked_section_id="BIO-LEC"),
              Section("HIS-1", "HIST1013", 3, 25, "IN_PERSON", "lecture", "lecture"),
              Section("HIS-2", "HIST2013", 3, 25, "IN_PERSON", "lecture", "lecture", fixed_faculty_id="P2"),
              Section("ONL", "BIOL2003", 3, 30, "ONLINE_ASYNC", None, None)]:
        term.sections[s.section_id] = s
    term.groups = {"G": ("Biology BS: 1000-level required", ["BIOL1003", "HIST1013"])}
    return term


CLEAN = [Assignment("BIO-LEC", "MWF-0900", "L1", "P1"), Assignment("BIO-LAB", "LAB-R-1300", "SL", "A1"),
         Assignment("HIS-1", "MWF-1000", "L1", "P2"), Assignment("HIS-2", "MWF-0900", "L2", "P2"), Assignment("ONL", None, None, "P1")]


def edit(section_id, **changes):
    """The clean timetable with one section's assignment changed."""
    return [replace(a, **changes) if a.section_id == section_id else a for a in CLEAN]


def codes(assignments, term=None, partial=False):
    return sorted({v.rule_code for v in check(term or make_term(), assignments, partial=partial)})


def test_clean_timetable_has_no_findings():
    assert check(make_term(), CLEAN) == []


@pytest.mark.parametrize("assignments, expected", [
    (CLEAN + [Assignment("NOPE", "MWF-0900", "L1", "P1")],          "UNKNOWN_SECTION"),
    (CLEAN + [Assignment("HIS-1", "TR-0930", "L2", "P3")],          "DUPLICATE_ASSIGNMENT"),
    ([a for a in CLEAN if a.section_id != "HIS-1"],                 "NOT_PLACED"),
    (edit("HIS-1", slot_id="XX"),                                   "UNKNOWN_SLOT"),
    (edit("HIS-1", room_id="XX"),                                   "UNKNOWN_ROOM"),
    (edit("HIS-1", faculty_id="XX"),                                "UNKNOWN_FACULTY"),
    (edit("HIS-1", slot_id=None),                                   "MISSING_SLOT"),
    (edit("ONL", slot_id="MWF-1000"),                               "SLOT_NOT_NEEDED"),
    (edit("BIO-LAB", slot_id="MWF-1000"),                           "SLOT_KIND_MISMATCH"),
    (edit("HIS-1", room_id=None),                                   "MISSING_ROOM"),
    (edit("ONL", room_id="L2"),                                     "ROOM_NOT_NEEDED"),
    (edit("BIO-LAB", room_id="L2"),                                 "ROOM_TYPE_MISMATCH"),
    (edit("HIS-1", room_id="SMALL"),                                "ROOM_TOO_SMALL"),
    (edit("HIS-1", room_id="OLD"),                                  "ROOM_INACTIVE"),
    (edit("BIO-LEC", room_id="L2"),                                 "ROOM_DOUBLE_BOOKED"),
    (edit("HIS-1", faculty_id=None),                                "MISSING_FACULTY"),
    (edit("HIS-1", faculty_id="P1"),                                "FACULTY_NOT_QUALIFIED"),
    (edit("HIS-2", faculty_id="P3"),                                "FIXED_FACULTY_CHANGED"),
    (edit("HIS-2", slot_id="MWF-1000"),                             "FACULTY_DOUBLE_BOOKED"),
    (edit("HIS-1", slot_id="TR-0930"),                              "FACULTY_UNAVAILABLE"),
    (edit("BIO-LEC", faculty_id="A1"),                              "FACULTY_OVERLOADED"),
    (edit("BIO-LAB", slot_id="LAB-M-0800"),                         "LAB_LECTURE_OVERLAP"),
    (edit("HIS-1", slot_id="MWF-0900", room_id="BIG", faculty_id="P3"), "GROUP_OVERLAP"),
    (edit("HIS-1", slot_id="EVE-MW-1800"),                          "REQUIRED_IN_EVENING"),
    (edit("BIO-LEC", slot_id="TR-0930"),                            "PREFERENCE_MISSED"),
])
def test_each_rule_is_caught_on_its_own(assignments, expected):
    assert codes(assignments) == [expected]


def test_partial_check_ignores_sections_not_listed():
    assert codes([a for a in CLEAN if a.section_id != "HIS-1"], partial=True) == []
    assert codes([Assignment("HIS-1", "TR-0930", "L1", "P2")], partial=True) == ["FACULTY_UNAVAILABLE"]


def test_group_with_no_clash_free_week():
    # Three required courses, each offered twice, but only two non-overlapping times: every pair works, all three never do.
    term = Term("TEST")
    term.slots = {"X": Slot("X", "MWF", t(9), t(9, 50), "lecture"), "Y": Slot("Y", "TR", t(9, 30), t(10, 45), "lecture")}
    rows = []
    for c in ["A", "B", "C"]:
        term.faculty[c] = Faculty(c, c, 12); term.quals[c] = {("SUBJ", None)}
        for slot in ["X", "Y"]:
            sid = f"{c}-{slot}"
            term.sections[sid] = Section(sid, f"SUBJ{ord(c)}", 3, 20, "ONLINE_LIVE", "lecture", None)
            rows.append(Assignment(sid, slot, None, c))
    # each faculty member teaches both of their sections; X and Y do not overlap, so no double-booking
    term.groups = {"G": ("Test group", [s.course_id for s in term.sections.values()][::2])}
    assert codes(rows, term) == ["GROUP_NO_COMBINATION"]
    term.groups = {"G": ("Test group", [s.course_id for s in term.sections.values()][:4:2])}   # two courses: fine
    assert codes(rows, term) == []


def test_back_to_back_slots_do_not_overlap():
    a, b = Slot("a", "MWF", t(9), t(9, 50), "lecture"), Slot("b", "MWF", t(9, 50), t(10, 40), "lecture")
    assert not a.overlaps(b) and not b.overlaps(a)
    assert Slot("c", "M", t(8), t(10, 50), "lab").overlaps(a)          # Monday 9:00 is inside the lab block
    assert not Slot("d", "TR", t(9), t(10, 15), "lecture").overlaps(a)  # different days


def test_every_rule_has_a_severity_and_reason():
    assert all(sev in ("hard", "soft", "note") and reason for sev, reason in RULES.values())


def test_sections_in_different_halves_of_the_term_never_clash():
    """A first-8-weeks section and a second-8-weeks section may share a room, a teacher and a time."""
    from datetime import date
    term = make_term()
    first, second = (date(2026, 8, 23), date(2026, 10, 17)), (date(2026, 10, 18), date(2026, 12, 12))
    term.sections["HIS-1"] = replace(term.sections["HIS-1"], first_date=first[0], last_date=first[1])
    term.sections["HIS-2"] = replace(term.sections["HIS-2"], first_date=second[0], last_date=second[1])
    same_time_and_room = edit("HIS-2", slot_id="MWF-1000", room_id="L1")   # HIS-1 is already there, with the same teacher
    assert codes(same_time_and_room, term) == []
    term.sections["HIS-2"] = replace(term.sections["HIS-2"], first_date=first[0], last_date=second[1])   # now both run in the first half
    assert codes(same_time_and_room, term) == ["FACULTY_DOUBLE_BOOKED", "ROOM_DOUBLE_BOOKED"]
