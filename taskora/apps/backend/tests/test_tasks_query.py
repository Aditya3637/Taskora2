"""POST /api/v1/tasks/query — the Work view's server-side query.

Verifies filter / sort / group / search / pagination evaluate the WHOLE visible
set (not a single page), which is the property the old /my/page lacked.
"""
from datetime import date, timedelta

from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U = "user-123"
BIZ = "biz-1"
PAST = "2020-01-01"
TODAY = date.today().isoformat()
SOON = (date.today() + timedelta(days=3)).isoformat()


def _task(id, **kw):
    base = {
        "id": id, "title": id, "description": None, "initiative_id": "init-A",
        "primary_stakeholder_id": U, "priority": "medium", "status": "todo",
        "start_date": None, "due_date": None, "entity_id": None, "entity_type": None,
        "archived_at": None, "created_at": "2026-01-01T00:00:00+00:00",
    }
    base.update(kw)
    return base


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "admin"}],
        "initiatives": [
            {"id": "init-A", "business_id": BIZ, "name": "Alpha"},
            {"id": "init-B", "business_id": BIZ, "name": "Beta"},
        ],
        "users": [{"id": U, "name": "Me"}, {"id": "u-2", "name": "Other"}],
        "tasks": [
            _task("T1", status="in_progress", priority="high", due_date=PAST,
                  initiative_id="init-A", created_at="2026-01-03T00:00:00+00:00"),
            _task("T2", status="todo", priority="urgent", primary_stakeholder_id="u-2",
                  due_date=None, initiative_id="init-A", created_at="2026-01-02T00:00:00+00:00"),
            _task("T3", status="done", priority="low", due_date=PAST,
                  initiative_id="init-B", created_at="2026-01-01T00:00:00+00:00"),
            _task("T4", status="backlog", priority="medium", primary_stakeholder_id=None,
                  due_date=SOON, initiative_id="init-B", title="Survey rollout",
                  description="metering at site", created_at="2026-01-04T00:00:00+00:00"),
            _task("T5", status="todo", archived_at="2026-01-05T00:00:00+00:00",
                  initiative_id="init-A"),
        ],
        # tables _hydrate_tasks_with_entities touches
        "task_entities": [], "task_date_change_log": [], "comments": [],
        "item_watchers": [], "buildings": [], "clients": [],
        "task_stakeholders": [], "subtasks": [],
    }


def _setup(store):
    app.dependency_overrides[get_current_user] = lambda: {"id": U, "email": "me@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def _q(**body):
    body.setdefault("business_id", BIZ)
    return client.post("/api/v1/tasks/query", json=body)


def _ids(r):
    return [t["id"] for t in r.json()["items"]]


def test_default_returns_all_active_newest_first():
    _setup(_store())
    r = _q()
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 4           # T5 archived excluded
    assert _ids(r) == ["T4", "T1", "T2", "T3"]   # created_at desc


def test_status_filter():
    _setup(_store())
    r = _q(filters={"status": ["todo"]})
    assert _ids(r) == ["T2"]                 # T5 (also todo) is archived → excluded
    assert r.json()["total"] == 1


def test_priority_filter():
    _setup(_store())
    r = _q(filters={"priority": ["urgent", "high"]})
    assert set(_ids(r)) == {"T1", "T2"}


def test_search_matches_title_and_description():
    _setup(_store())
    assert _ids(_q(filters={"search": "survey"})) == ["T4"]
    assert _ids(_q(filters={"search": "metering"})) == ["T4"]   # description hit


def test_assignee_and_unassigned():
    _setup(_store())
    assert set(_ids(_q(filters={"assignee_ids": [U]}))) == {"T1", "T3"}
    assert _ids(_q(filters={"unassigned": True})) == ["T4"]


def test_due_overdue_excludes_done():
    _setup(_store())
    # T1 (past, in_progress) is overdue; T3 (past, done) is not.
    assert _ids(_q(filters={"due": "overdue"})) == ["T1"]


def test_sort_priority_asc():
    _setup(_store())
    r = _q(sort=[{"field": "priority", "dir": "asc"}])
    assert _ids(r) == ["T2", "T1", "T4", "T3"]   # urgent, high, medium, low


def test_group_by_status_rollup():
    _setup(_store())
    r = _q(group_by="status")
    groups = {g["key"]: g for g in r.json()["groups"]}
    assert groups["in_progress"]["count"] == 1
    assert groups["done"]["count"] == 1 and groups["done"]["done"] == 1
    # blocked(none) < in_progress < todo < backlog < done ordering
    assert [g["key"] for g in r.json()["groups"]] == ["in_progress", "todo", "backlog", "done"]


def test_pagination_has_more():
    _setup(_store())
    r = _q(limit=2, offset=0)
    assert len(r.json()["items"]) == 2
    assert r.json()["total"] == 4 and r.json()["has_more"] is True
    r2 = _q(limit=2, offset=2)
    assert len(r2.json()["items"]) == 2 and r2.json()["has_more"] is False


def test_archived_only():
    _setup(_store())
    r = _q(filters={"archived": True})
    assert _ids(r) == ["T5"]
