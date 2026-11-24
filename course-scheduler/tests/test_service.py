"""The service: auth, trying a change without saving, applying a change as a new draft, generating a draft. Needs DATABASE_URL and the real data.
Runs it creates are deleted at the end."""
import pytest

from scheduler import model

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient   # noqa: E402

KEY = "test-key"


@pytest.fixture(scope="module")
def client():
    try:
        model.database_url()
    except SystemExit:
        pytest.skip("DATABASE_URL not set")
    import psycopg
    with psycopg.connect(model.database_url()) as conn, conn.cursor() as cur:
        if not cur.execute("select 1 from course_scheduling.schedule_runs where run_id = 1 and solver_version = 'actual-timetable'").fetchone():
            pytest.skip("no real data loaded")
        start = cur.execute("select coalesce(max(run_id), 0) from course_scheduling.schedule_runs").fetchone()[0]
    import os
    os.environ["SCHEDULER_API_KEY"] = KEY
    from service.app import app
    yield TestClient(app)
    with psycopg.connect(model.database_url()) as conn, conn.cursor() as cur:
        cur.execute("delete from course_scheduling.schedule_runs where run_id > %s and created_by like 'test%%'", (start,))
        conn.commit()


H = {"X-Scheduler-Key": KEY}
FIX = {"changes": [{"section_id": "2026FA-MUS4083-A", "room_id": "DEMAT-D251", "keep": ["slot_id", "faculty_id"]}], "reason": "Room clash fixed", "by": "test"}


def test_health_is_open_and_the_rest_needs_the_key(client):
    assert client.get("/health").json()["ok"] is True
    assert client.get("/runs").status_code == 401
    assert client.get("/runs", headers={"X-Scheduler-Key": "wrong"}).status_code == 401
    assert client.get("/runs", headers=H).status_code == 200


def test_trying_a_fix_shows_what_it_removes_and_saves_nothing(client):
    before = len(client.get("/runs", headers=H).json())
    out = client.post("/runs/1/try", json=FIX, headers=H).json()
    assert out["ok"] and out["added"] == []
    assert any(f["rule"] == "ROOM_DOUBLE_BOOKED" and "2026FA-MUS4083-A" in f["sections"] for f in out["removed"])
    assert len(client.get("/runs", headers=H).json()) == before


def test_a_change_that_adds_a_clash_is_refused(client):
    bad = {"changes": [{"section_id": "2026FA-ACCT2113-B", "room_id": "DEMAT-D275", "keep": ["slot_id", "faculty_id"]}], "by": "test"}   # D275 is busy then
    assert client.post("/runs/1/try", json=bad, headers=H).json()["ok"] is False
    r = client.post("/runs/1/apply", json=bad, headers=H)
    assert r.status_code == 409 and r.json()["detail"]["added"]


def test_applying_a_fix_saves_a_new_draft_and_leaves_the_old_one(client):
    r = client.post("/runs/1/apply", json=FIX, headers=H)
    assert r.status_code == 200
    new = r.json()["run_id"]
    assert new != 1 and r.json()["summary"]["real_clashes"] == 7      # 8 as run, minus the one fixed
    assert client.post("/runs/1/try", json=FIX, headers=H).json()["removed"]   # run 1 still has the clash


def test_unknown_sections_and_runs_are_refused(client):
    assert client.post("/runs/1/try", json={"changes": [{"section_id": "NOPE"}]}, headers=H).status_code == 422
    assert client.post("/runs/999999/try", json=FIX, headers=H).status_code == 404


def test_generating_a_draft(client):
    r = client.post("/solve", json={"from_run": 1, "time_limit": 60, "by": "test"}, headers=H)
    assert r.status_code == 200
    out = r.json()
    assert out["summary"]["real_clashes"] == 0 and out["status"] in ("optimal", "feasible")
