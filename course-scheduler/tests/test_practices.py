"""Step A: Newman practices the checker recognises, findings on guessed data, sections taught together, and checked fixes. No database needed."""
from dataclasses import replace

from scheduler import together
from scheduler.checker import ESTIMATED, REAL, Practices, check
from scheduler.fixes import fixes_for
from scheduler.model import Assignment, Room, Section
from test_checker import CLEAN, edit, make_term


def codes(term, rows, **kw):
    return sorted({v.rule_code for v in check(term, rows, **kw)})


def stacked_term():
    """HIS-1 and HIS-3 are a 1000- and a 3000-level course taught as one class by P3, same time and room."""
    term = make_term()
    term.sections["HIS-3"] = Section("HIS-3", "HIST2013", 3, 10, "IN_PERSON", "lecture", "lecture")
    return term


STACKED = edit("HIS-1", faculty_id="P3") + [Assignment("HIS-3", "MWF-1000", "L1", "P3")]


def test_taught_together_is_a_note_not_a_clash():
    term = stacked_term()
    assert codes(term, STACKED) == ["FACULTY_DOUBLE_BOOKED", "ROOM_DOUBLE_BOOKED"]   # not declared: a clash
    term.together = {"HIS-1": "TT-1", "HIS-3": "TT-1"}
    assert codes(term, STACKED) == ["TAUGHT_TOGETHER"]
    assert codes(term, STACKED, practices=Practices(taught_together=False)) == ["FACULTY_DOUBLE_BOOKED", "ROOM_DOUBLE_BOOKED"]


def test_taught_together_needs_the_same_time_and_instructor():
    """Being in a combine group is not a licence to clash: at different times, or with different instructors, it is two classes."""
    term = stacked_term()
    term.together = {"HIS-1": "TT-1", "HIS-3": "TT-1"}
    other_teacher = edit("HIS-1", faculty_id="P3") + [Assignment("HIS-3", "MWF-1000", "L1", "P2")]
    assert "ROOM_DOUBLE_BOOKED" in codes(term, other_teacher)


def test_taught_together_credits_count_once():
    term = stacked_term()
    term.together = {"HIS-1": "TT-1", "HIS-3": "TT-1"}
    term.faculty["P3"] = replace(term.faculty["P3"], max_credit_load=3)
    assert "FACULTY_OVERLOADED" not in codes(term, STACKED)


def test_infer_finds_stacked_and_multi_site_classes():
    term = stacked_term()
    term.rooms["PARTNER"] = Room("PARTNER", "GCCC", 99, "off_site")
    term.sections["HIS-4"] = Section("HIS-4", "HIST1013", 3, 10, "IN_PERSON", "lecture", "off_site")
    rows = STACKED + [Assignment("HIS-4", "MWF-1000", "PARTNER", "P3")]
    found = together.infer(term, rows)
    assert {(sid, kind) for _, sid, kind in found} == {("HIS-1", "multi_site"), ("HIS-3", "multi_site"), ("HIS-4", "multi_site")}
    assert len({cid for cid, _, _ in found}) == 1
    assert together.infer(make_term(), CLEAN) == []   # nobody teaches two things at once in the clean timetable


def test_clinical_supervision_is_a_note():
    term = make_term()
    term.rooms["HOSP"] = Room("HOSP", "VCSJ", 10, "clinical_site")
    term.sections["CLIN"] = Section("CLIN", "BIOL1003", 1, 5, "IN_PERSON", "lecture", "clinical_site")
    rows = CLEAN + [Assignment("CLIN", "MWF-0900", "HOSP", "P1")]   # P1 also teaches BIO-LEC then
    assert codes(term, rows) == ["CLINICAL_SUPERVISION"]
    assert "FACULTY_DOUBLE_BOOKED" in codes(term, rows, practices=Practices(clinical_supervision=False))


def test_findings_on_guessed_data_are_labelled():
    term = make_term()
    term.rooms["SMALL"] = replace(term.rooms["SMALL"], estimated=("capacity",))
    [v] = check(term, edit("HIS-1", room_id="SMALL"))
    assert (v.rule_code, v.basis) == ("ROOM_TOO_SMALL", ESTIMATED)
    [v] = check(make_term(), edit("HIS-1", room_id="SMALL"))
    assert v.basis == REAL
    term = make_term()
    term.group_source = {"G": "mock_level"}
    assert {v.basis for v in check(term, edit("HIS-1", slot_id="MWF-0900", room_id="BIG", faculty_id="P3"))} == {ESTIMATED}
    term.group_source = {"G": "registration"}
    assert {v.basis for v in check(term, edit("HIS-1", slot_id="MWF-0900", room_id="BIG", faculty_id="P3"))} == {REAL}


def test_room_clash_fix_is_checked_and_works():
    term = make_term()
    rows = edit("BIO-LEC", room_id="L2")   # BIO-LEC and HIS-2 both in L2 at MWF 9:00
    [v] = check(term, rows)
    fixes = fixes_for(term, rows, v)
    assert fixes
    for f in fixes:
        new = {a.section_id: a for a in f.changes}
        assert check(term, [new.get(a.section_id, a) for a in rows]) == []


def test_instructor_clash_fix_moves_a_section_to_a_free_time():
    term = make_term()
    rows = edit("HIS-2", slot_id="MWF-1000")   # P2 teaches HIS-1 and HIS-2 at MWF 10:00
    [v] = check(term, rows)
    fixes = fixes_for(term, rows, v)
    assert fixes and all(f.changes[0].slot_id not in ("MWF-1000",) for f in fixes)


def test_missing_instructor_fix_offers_someone_qualified_and_free():
    term = make_term()
    rows = edit("HIS-1", faculty_id=None)
    [v] = check(term, rows)
    # P3 (free, lightest load) first, then P2 (free at MWF 10:00); P1 and A1 aren't qualified for history
    assert [f.changes[0].faculty_id for f in fixes_for(term, rows, v)] == ["P3", "P2"]
    term.unavailable["P3"] = [term.unavailable["P2"][0].__class__("MWF", make_term().slots["MWF-1000"].start, make_term().slots["MWF-1000"].end)]
    assert [f.changes[0].faculty_id for f in fixes_for(term, rows, v)] == ["P2"]


def test_no_fix_when_nothing_is_free():
    term = make_term()
    for r in ("L1", "L2", "BIG", "SMALL", "OLD"): term.rooms.pop(r)
    term.rooms["ONLY"] = Room("ONLY", "DEM", 30, "lecture")
    rows = [replace(a, room_id="ONLY") if a.section_id in ("BIO-LEC", "HIS-2") else a for a in CLEAN if a.section_id != "HIS-1"]
    v = next(v for v in check(term, rows, partial=True) if v.rule_code == "ROOM_DOUBLE_BOOKED")
    assert fixes_for(term, rows, v) == []   # no other lecture room exists, so no fix is offered rather than a bad one
