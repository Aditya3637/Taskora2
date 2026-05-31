"""P5: Task-level comment thread can roll up subtree comments.

GET /tasks/{id}/comments?include_descendants=true returns every comment
under the task tree (task / entity / subtask scope), each tagged with
its source so the UI can render a scope chip. The default (no param)
still returns only the task-scope thread.

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
        "users": [{"id": U_OWNER, "name": "Owner", "email": "o@x.io"}],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_OWNER, "role": "owner"},
        ],
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
        "subtasks": [{
            "id": "S1", "task_id": "T1", "title": "Pull ledgers",
            "status": "in_progress", "approval_state": "none",
            "assignee_id": U_OWNER, "parent_subtask_id": None,
            "scoped_entity_id": None, "scoped_entity_type": None,
            "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
        }],
        "task_entities": [{
            "task_id": "T1", "entity_type": "building", "entity_id": "B1",
            "per_entity_status": "in_progress", "per_entity_end_date": None,
            "approval_state": "none", "closed_at": None,
            "updated_at": "2026-05-01T00:00:00+00:00",
        }],
        "buildings": [{"id": "B1", "name": "HQ Tower"}],
        "clients": [],
        "comments": [
            {"id": "C-T", "task_id": "T1", "user_id": U_OWNER,
             "content": "task scope", "kind": "note",
             "entity_id": None, "subtask_id": None, "entity_type": None,
             "created_at": "2026-05-03T10:00:00+00:00"},
            {"id": "C-S", "task_id": "T1", "user_id": U_OWNER,
             "content": "subtask scope", "kind": "note",
             "entity_id": None, "subtask_id": "S1", "entity_type": None,
             "created_at": "2026-05-03T11:00:00+00:00"},
            {"id": "C-E", "task_id": "T1", "user_id": U_OWNER,
             "content": "entity scope", "kind": "note",
             "entity_id": "B1", "subtask_id": None, "entity_type": "building",
             "created_at": "2026-05-03T12:00:00+00:00"},
        ],
        "item_watchers": [],
        "initiative_followers": [],
        "program_followers": [],
    }


@pytest.fixture
def fake():
    f = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: (
        {"id": U_OWNER, "email": "o@x.io"}
    )
    app.dependency_overrides[get_supabase] = lambda: f
    yield f
    app.dependency_overrides.clear()


def test_default_list_only_returns_task_scope(fake):
    rows = client.get("/api/v1/tasks/T1/comments").json()
    assert [r["content"] for r in rows] == ["task scope"]
    # Backwards compat — even default path now stamps scope_type for the UI.
    assert rows[0]["scope_type"] == "task"


def test_rollup_returns_every_scope_tagged(fake):
    rows = client.get("/api/v1/tasks/T1/comments?include_descendants=true").json()
    assert len(rows) == 3
    by_scope = {r["scope_type"]: r for r in rows}
    assert set(by_scope) == {"task", "subtask", "entity"}
    # Sources labeled for the UI chip.
    assert by_scope["subtask"]["subtask_id"] == "S1"
    assert by_scope["subtask"]["subtask_title"] == "Pull ledgers"
    assert by_scope["entity"]["entity_id"] == "B1"
    assert by_scope["entity"]["entity_name"] == "HQ Tower"
    assert by_scope["entity"]["entity_type"] == "building"


def test_rollup_preserves_chronological_order(fake):
    """Comments returned oldest-first so the existing CommentsPopup reverse
    rendering still puts the newest on top."""
    rows = client.get("/api/v1/tasks/T1/comments?include_descendants=true").json()
    times = [r["created_at"] for r in rows]
    assert times == sorted(times)


def test_rollup_blocked_for_outsider(fake):
    """Visibility gate is unchanged — same _assert_task_access used by the
    default path. Outsiders still get 403."""
    app.dependency_overrides[get_current_user] = lambda: (
        {"id": "u-outsider", "email": "x@x.io"}
    )
    r = client.get("/api/v1/tasks/T1/comments?include_descendants=true")
    assert r.status_code == 403
