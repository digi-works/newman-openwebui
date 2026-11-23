"""The real data loaded by real/load_real.py: nothing from the university's file is lost, and every guess is labelled. Needs DATABASE_URL."""
import pytest

from scheduler import model
from scheduler.checker import check

CS = "course_scheduling."


@pytest.fixture(scope="module")
def db():
    try:
        url = model.database_url()
    except SystemExit:
        pytest.skip("DATABASE_URL not set")
    psycopg = pytest.importorskip("psycopg")
    conn = psycopg.connect(url)
    cur = conn.cursor()
    run = cur.execute(f"select run_id, term_id from {CS}schedule_runs where solver_version = 'actual-timetable'").fetchone()
    if not run:
        pytest.skip("no real data loaded")
    yield cur, *run
    conn.close()


def one(cur, sql, *args):
    return cur.execute(sql, args).fetchone()[0]


def test_every_row_of_the_file_is_a_section_and_in_the_timetable(db):
    cur, run_id, term = db
    n = one(cur, f"select count(*) from {CS}source_sections where term_id = %s", term)
    assert n > 0
    assert one(cur, f"select count(*) from {CS}sections where term_id = %s", term) == n
    assert one(cur, f"select count(*) from {CS}source_sections f join {CS}sections s using (section_id)") == n
    assert one(cur, f"select count(*) from {CS}schedule_assignments where run_id = %s", run_id) == n


def test_the_timetable_matches_the_file(db):
    cur, run_id, _ = db
    wrong_teacher = one(cur, f"""select count(*) from {CS}schedule_assignments a join {CS}source_sections f using (section_id)
                                 left join {CS}faculty p on p.faculty_id = a.faculty_id
                                 where a.run_id = %s and p.name is distinct from f.instructor""", run_id)
    assert wrong_teacher == 0
    wrong_time = one(cur, f"""select count(*) from {CS}schedule_assignments a join {CS}source_sections f using (section_id) join {CS}time_slots t using (slot_id)
                              where a.run_id = %s and (t.days <> split_part(f.days, ';', 1) or to_char(t.start_time, 'HH24:MI') <> split_part(f.begin_times, ';', 1))""", run_id)
    assert wrong_time == 0


def test_guesses_are_labelled(db):
    cur, _, term = db
    assert one(cur, f"select count(*) from {CS}rooms where not estimated @> '{{capacity,room_type}}'") == 0
    assert one(cur, f"select count(*) from {CS}faculty where not estimated @> '{{employment,max_credit_load}}'") == 0
    assert one(cur, f"select count(*) from {CS}sections where term_id = %s and not estimated @> '{{seat_cap}}'", term) == 0
    assert one(cur, f"select count(*) from {CS}student_groups where source <> 'mock_level'") == 0
    assert one(cur, f"select count(*) from {CS}faculty_availability where source <> 'mock'") == 0


def test_checker_runs_on_the_real_timetable(db):
    cur, run_id, _ = db
    term_id, rows = model.load_run(cur, run_id)
    term = model.load_term(cur, term_id)
    found = {v.rule_code for v in check(term, rows)}
    # The guesses are made so the real timetable fits them: rooms hold their largest section, loads cover what people teach.
    # Mock availability is fitted around what people really teach, so the real timetable never breaks it.
    assert not found & {"ROOM_TOO_SMALL", "ROOM_TYPE_MISMATCH", "FACULTY_OVERLOADED", "FACULTY_NOT_QUALIFIED", "UNKNOWN_SLOT", "UNKNOWN_ROOM",
                        "FACULTY_UNAVAILABLE", "PREFERENCE_MISSED"}


def test_newman_practices_turn_most_clashes_into_notes(db):
    """Step A: sections taught together and clinical supervision are notes; what's left are real clashes, each found and explained."""
    from scheduler.checker import ESTIMATED, Practices
    from scheduler.fixes import fixes_for
    cur, run_id, _ = db
    term_id, rows = model.load_run(cur, run_id)
    term = model.load_term(cur, term_id)
    assert term.together, "combined_sections is empty: reload with real/load_real.py --rebuild"
    found = check(term, rows)
    strict = check(term, rows, practices=Practices(False, False))
    clashes = [v for v in found if v.rule_code in ("ROOM_DOUBLE_BOOKED", "FACULTY_DOUBLE_BOOKED")]
    assert len(clashes) < len([v for v in strict if v.rule_code in ("ROOM_DOUBLE_BOOKED", "FACULTY_DOUBLE_BOOKED")]) / 10
    real_room = [v for v in clashes if v.section_ids == ("2026FA-MUS4083-A", "2026FA-THEO1033-B")]
    assert real_room and fixes_for(term, rows, real_room[0])   # the one true room clash is still found, with a checked fix
    assert all(v.basis == ESTIMATED for v in found if v.rule_code.startswith("GROUP_"))
