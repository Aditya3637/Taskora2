"""Logic tests for GET /api/v1/initiatives/{id}/gantt.

Runs the real handler against the in-memory fake Supabase to exercise the
rebuilt Gantt: GET (was POST), task+subtask hierarchy, building+client entity
resolution, milestones, and the "no date => row but no bar" contract.
"""
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U = "u-1"
BIZ = "BIZ"
INIT = "INIT1"


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "initiatives": [{
            "id": INIT, "business_id": BIZ, "name": "Init One",
            "start_date": "2026-05-01", "target_end_date": "2026-06-30",
        }],
        "tasks": [
            {"id": "T1", "title": "Task With Date", "status": "in_progress",
             "priority": "medium", "due_date": "2026-05-20", "initiative_id": INIT,
             "date_mode": "uniform", "depends_on": [],
             "created_at": "2026-05-02T00:00:00+00:00"},
            {"id": "T2", "title": "Task No Date", "status": "todo",
             "priority": "low", "due_date": None, "initiative_id": INIT,
             "date_mode": "uniform", "depends_on": [],
             "created_at": "2026-05-03T00:00:00+00:00"},
        ],
        "task_entities": [
            {"task_id": "T1", "entity_type": "building", "entity_id": "B1",
             "per_entity_end_date": None},
            {"task_id": "T1", "entity_type": "client", "entity_id": "C1",
             "per_entity_end_date": None},
        ],
        "subtasks": [
            {"id": "S1", "title": "Sub of T1", "status": "todo", "task_id": "T1",
             "parent_subtask_id": None, "date_mode": "uniform",
             "created_at": "2026-05-04T00:00:00+00:00"},
        ],
        "subtask_entities": [],
        "buildings": [{"id": "B1", "name": "Tower A"}],
        "clients": [{"id": "C1", "name": "Acme"}],
        "milestones": [
            {"id": "M1", "title": "Launch", "due_date": "2026-06-15",
             "initiative_id": INIT},
        ],
    }


def _setup(store):
    app.dependency_overrides[get_current_user] = lambda: {"id": U, "email": "u@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def _row(rows, rid):
    return next(r for r in rows if r["id"] == rid)


def test_gantt_is_get_not_post():
    _setup(_store())
    assert client.get(f"/api/v1/initiatives/{INIT}/gantt").status_code == 200
    # The old POST route must be gone.
    assert client.post(f"/api/v1/initiatives/{INIT}/gantt").status_code == 405


def test_gantt_task_with_dates_and_entities():
    _setup(_store())
    data = client.get(f"/api/v1/initiatives/{INIT}/gantt").json()
    rows = data["rows"]
    t1 = _row(rows, "T1")
    assert t1["kind"] == "task" and t1["depth"] == 0
    assert t1["end_date"] == "2026-05-20"
    # start derives from the initiative start (no planned-start column).
    assert t1["start_date"] == "2026-05-01"
    names = sorted(e["name"] for e in t1["entities"])
    types = sorted(e["type"] for e in t1["entities"])
    assert names == ["Acme", "Tower A"]
    assert types == ["building", "client"]


def test_gantt_dateless_task_row_has_no_dates():
    """No date aligned => the row exists but carries no start/end (no bar)."""
    _setup(_store())
    rows = client.get(f"/api/v1/initiatives/{INIT}/gantt").json()["rows"]
    t2 = _row(rows, "T2")
    assert t2["start_date"] is None
    assert t2["end_date"] is None


def test_gantt_subtask_nested_and_inherits_due():
    _setup(_store())
    rows = client.get(f"/api/v1/initiatives/{INIT}/gantt").json()["rows"]
    s1 = _row(rows, "S1")
    assert s1["kind"] == "subtask"
    assert s1["depth"] == 1
    assert s1["parent_id"] == "T1"
    # No subtask date column => inherits the parent task's due date.
    assert s1["end_date"] == "2026-05-20"


def test_gantt_milestone_row():
    _setup(_store())
    rows = client.get(f"/api/v1/initiatives/{INIT}/gantt").json()["rows"]
    m1 = _row(rows, "M1")
    assert m1["is_milestone"] is True
    assert m1["kind"] == "milestone"
    assert m1["end_date"] == "2026-06-15"


def test_gantt_non_member_forbidden():
    store = _store()
    store["business_members"] = []
    _setup(store)
    assert client.get(f"/api/v1/initiatives/{INIT}/gantt").status_code == 403
