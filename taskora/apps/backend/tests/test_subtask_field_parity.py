"""P2: subtask field parity — due_date, description, priority.

Asserts the create/update endpoints accept the new fields and the read
endpoints project them so the SubtaskRow chip can render.

Uses the in-memory FakeSupabase.
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U_OWNER = "u-owner"


def _seed():
    return {
        "users": [{"id": U_OWNER, "name": "Owner", "email": "owner@x.io"}],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_OWNER, "role": "owner"},
        ],
        "programs": [],
        "initiatives": [{"id": "INIT1", "business_id": "BIZ1",
                         "primary_stakeholder_id": U_OWNER}],
        "tasks": [{
            "id": "T1", "title": "Parent", "status": "in_progress",
            "priority": "medium", "due_date": None, "initiative_id": "INIT1",
            "primary_stakeholder_id": U_OWNER, "created_by": U_OWNER,
            "approval_state": "none", "closed_at": None,
            "created_at": "2026-05-01T00:00:00+00:00",
        }],
        "task_stakeholders": [
            {"task_id": "T1", "user_id": U_OWNER, "role": "primary"},
        ],
        "subtasks": [],
        "task_entities": [],
        "item_watchers": [],
        "comments": [],
        "initiative_followers": [],
        "program_followers": [],
    }


@pytest.fixture
def fake():
    f = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: (
        {"id": U_OWNER, "email": "owner@x.io"}
    )
    app.dependency_overrides[get_supabase] = lambda: f
    yield f
    app.dependency_overrides.clear()


def test_create_subtask_accepts_new_fields(fake):
    r = client.post("/api/v1/tasks/T1/subtasks", json={
        "title": "Pull ledgers",
        "description": "Pull last 4 quarters of ledger entries",
        "due_date": "2026-06-15",
        "priority": "high",
    })
    assert r.status_code == 201, r.text
    row = r.json()
    assert row["description"] == "Pull last 4 quarters of ledger entries"
    assert row["due_date"] == "2026-06-15"
    assert row["priority"] == "high"


def test_create_subtask_defaults_priority_medium(fake):
    r = client.post("/api/v1/tasks/T1/subtasks", json={"title": "Quick check"})
    assert r.status_code == 201, r.text
    assert r.json()["priority"] == "medium"
    assert r.json()["due_date"] is None
    # description defaults to None — column is nullable
    assert r.json().get("description") in (None, "")


def test_list_subtasks_projects_new_fields(fake):
    client.post("/api/v1/tasks/T1/subtasks", json={
        "title": "S1", "due_date": "2026-07-01", "priority": "urgent",
        "description": "desc here",
    })
    rows = client.get("/api/v1/tasks/T1/subtasks").json()
    assert len(rows) == 1
    assert rows[0]["due_date"] == "2026-07-01"
    assert rows[0]["priority"] == "urgent"
    assert rows[0]["description"] == "desc here"


def test_list_subtasks_grouped_projects_new_fields(fake):
    client.post("/api/v1/tasks/T1/subtasks", json={
        "title": "S1", "due_date": "2026-08-12", "priority": "low",
    })
    g = client.get("/api/v1/tasks/T1/subtasks-grouped").json()
    sub = g["task_flat"][0]
    assert sub["due_date"] == "2026-08-12"
    assert sub["priority"] == "low"


def test_patch_subtask_updates_new_fields(fake):
    sid = client.post("/api/v1/tasks/T1/subtasks", json={"title": "S1"}).json()["id"]
    r = client.patch(f"/api/v1/tasks/T1/subtasks/{sid}", json={
        "due_date": "2026-09-30",
        "priority": "urgent",
        "description": "tightened scope",
    })
    assert r.status_code == 200, r.text
    rows = client.get("/api/v1/tasks/T1/subtasks").json()
    assert rows[0]["due_date"] == "2026-09-30"
    assert rows[0]["priority"] == "urgent"
    assert rows[0]["description"] == "tightened scope"


def test_patch_subtask_rejects_bad_priority(fake):
    sid = client.post("/api/v1/tasks/T1/subtasks", json={"title": "S1"}).json()["id"]
    r = client.patch(f"/api/v1/tasks/T1/subtasks/{sid}",
                     json={"priority": "blocker"})
    # Pydantic rejects the Literal — 422 from FastAPI.
    assert r.status_code == 422


def test_create_subtask_rejects_bad_priority(fake):
    r = client.post("/api/v1/tasks/T1/subtasks",
                    json={"title": "S1", "priority": "ultra"})
    assert r.status_code == 422
