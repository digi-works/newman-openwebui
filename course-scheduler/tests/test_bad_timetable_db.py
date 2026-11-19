"""Step 2 'done when': a hand-made bad timetable on the mock data is caught, rule by rule. The mock term is built in memory from the catalog.
Needs DATABASE_URL; skipped without it."""
import pytest

from scheduler import model
from scheduler.checker import check
from scheduler.demo import bad_timetable


@pytest.fixture(scope="module")
def term():
    try:
        url = model.database_url()
    except SystemExit:
        pytest.skip("DATABASE_URL not set")
    psycopg = pytest.importorskip("psycopg")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        return model.mock_term(cur)


def test_every_rule_broken_on_purpose_is_caught(term):
    rows, expected = bad_timetable(term)
    found = {(sid, v.rule_code) for v in check(term, rows, partial=True) for sid in v.section_ids}
    missed = {(sid, rule) for sid, rule in expected.items() if (sid, rule) not in found}
    assert not missed
    assert len(set(expected.values())) >= 15


def test_full_check_reports_every_unlisted_section_as_not_placed(term):
    rows, _ = bad_timetable(term)
    not_placed = [v for v in check(term, rows) if v.rule_code == "NOT_PLACED"]
    assert len(not_placed) == len(term.sections) - len(rows)
