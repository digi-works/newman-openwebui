"""Step B: the solver on the small hand-made term. Every draft it makes is checked by the checker. No database needed."""
from dataclasses import replace

from scheduler.checker import HARD, check
from scheduler.model import Assignment, Room, Section
from scheduler.solver import Settings, solve
from test_checker import CLEAN, edit, make_term

FAST = Settings(time_limit=10)


def hard(term, rows):
    return sorted({v.rule_code for v in check(term, rows) if v.severity == HARD})


def row(res, sid):
    return next(a for a in res.assignments if a.section_id == sid)


def test_a_clean_timetable_is_kept_as_it_is():
    res = solve(make_term(), CLEAN, FAST)
    assert res.status == "optimal" and res.moved_time == [] and res.moved_room == [] and res.unplaced == []
    assert sorted(res.assignments, key=lambda a: a.section_id) == sorted(CLEAN, key=lambda a: a.section_id)


def test_a_room_clash_is_fixed_with_one_room_move():
    term = make_term()
    base = edit("BIO-LEC", room_id="L2")              # BIO-LEC and HIS-2 both in L2 at MWF 9:00
    assert "ROOM_DOUBLE_BOOKED" in hard(term, base)
    res = solve(term, base, FAST)
    assert hard(term, res.assignments) == []
    assert len(res.moved_room) == 1 and res.moved_time == []


def test_an_instructor_clash_is_fixed_by_moving_one_section_in_time():
    term = make_term()
    base = edit("HIS-2", slot_id="MWF-1000", room_id="L2")   # P2 teaches HIS-1 and HIS-2 at MWF 10:00
    res = solve(term, base, FAST)
    assert hard(term, res.assignments) == []
    assert len(res.moved_time) == 1
    assert row(res, "HIS-2").faculty_id == "P2" and row(res, "HIS-1").faculty_id == "P2"   # instructors are never changed


def test_a_section_with_no_room_gets_one_that_fits():
    term = make_term()
    res = solve(term, edit("HIS-1", room_id=None), FAST)
    r = row(res, "HIS-1").room_id
    assert r and term.rooms[r].capacity >= 25 and term.rooms[r].is_active and hard(term, res.assignments) == []


def test_a_lab_never_lands_on_its_lecture():
    term = make_term()
    base = edit("BIO-LAB", slot_id="LAB-M-0800")       # overlaps BIO-LEC (MWF 9:00)
    res = solve(term, base, FAST)
    assert "LAB_LECTURE_OVERLAP" not in hard(term, res.assignments)
    assert not term.slots[row(res, "BIO-LAB").slot_id].overlaps(term.slots[row(res, "BIO-LEC").slot_id])


def test_sections_taught_together_move_as_one_class():
    term = make_term()
    term.sections["HIS-3"] = Section("HIS-3", "HIST2013", 3, 4, "IN_PERSON", "lecture", "lecture")
    term.together = {"HIS-1": "TT-1", "HIS-3": "TT-1"}
    base = edit("HIS-1", faculty_id="P3") + [Assignment("HIS-3", "MWF-1000", "L1", "P3")]
    res = solve(term, base, Settings(fresh=True, time_limit=10))
    a, b = row(res, "HIS-1"), row(res, "HIS-3")
    assert (a.slot_id, a.room_id) == (b.slot_id, b.room_id)
    assert term.rooms[a.room_id].capacity >= 25 + 4      # the room holds both
    assert hard(term, res.assignments) == []


def test_a_partner_college_keeps_its_time():
    term = make_term()
    term.rooms["PARTNER"] = Room("PARTNER", "GCCC", 99, "off_site")
    term.sections["OFF"] = Section("OFF", "HIST1013", 3, 10, "IN_PERSON", "lecture", "off_site")
    base = CLEAN + [Assignment("OFF", "TR-0930", "PARTNER", "P3")]
    res = solve(term, base, Settings(fresh=True, time_limit=10))
    assert (row(res, "OFF").slot_id, row(res, "OFF").room_id) == ("TR-0930", "PARTNER")


def test_what_cannot_fit_is_reported_not_forced():
    term = make_term()
    term.rooms = {k: v for k, v in term.rooms.items() if k != "SL"}   # no science lab anywhere
    res = solve(term, CLEAN, FAST)
    assert res.status in ("optimal", "feasible")
    assert res.unplaced == ["BIO-LAB"] and "science_lab" in res.reasons["BIO-LAB"]
    assert row(res, "BIO-LAB").slot_id is None


def test_sections_with_no_set_time_are_left_alone():
    res = solve(make_term(), CLEAN, FAST)
    assert row(res, "ONL") == next(a for a in CLEAN if a.section_id == "ONL")


def test_unavailable_times_are_never_used():
    term = make_term()
    term.unavailable["P2"] = term.unavailable["P2"] + [replace(term.unavailable["P2"][0], days="MWF")]   # P2 can't teach at all now
    res = solve(term, CLEAN, FAST)
    assert set(res.unplaced) == {"HIS-1", "HIS-2"}                    # not even their old time is used
    assert "FACULTY_UNAVAILABLE" not in hard(term, res.assignments)
