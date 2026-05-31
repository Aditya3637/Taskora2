"""P4: Watcher cascade view — parent-task watchers appear on subtask rows
tagged inherited_from: 'task'. The underlying item_watchers row stays at
task scope; the read endpoints just merge inherited records in for display.

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
U_TASK_WATCHER = "u-task-watcher"
U_SUB_WATCHER = "u-sub-watcher"
U_BOTH = "u-both"


def _seed():
    return {
        "users": [
            {"id": U_OWNER, "name": "Owner", "email": "o@x.io"},
            {"id": U_TASK_WATCHER, "name": "Task Watcher", "email": "tw@x.io"},
            {"id": U_SUB_WATCHER, "name": "Sub Watcher", "email": "sw@x.io"},
            {"id": U_BOTH, "name": "Both", "email": "b@x.io"},
        ],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_OWNER, "role": "owner"},
            {"business_id": "BIZ1", "user_id": U_TASK_WATCHER, "role": "member"},
            {"business_id": "BIZ1", "user_id": U_SUB_WATCHER, "role": "member"},
            {"business_id": "BIZ1", "user_id": U_BOTH, "role": "member"},
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
            "id": "S1", "task_id": "T1", "title": "Sub one",
            "status": "in_progress", "approval_state": "none",
            "assignee_id": U_OWNER, "parent_subtask_id": None,
            "scoped_entity_id": None, "scoped_entity_type": None,
            "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
            "due_date": None, "priority": "medium", "description": None,
        }],
        "item_watchers": [
            # Task-scope watcher — should appear inherited on S1.
            {"id": "W-T", "task_id": "T1", "scope_type": "task",
             "subtask_id": None, "entity_id": None, "entity_type": None,
             "user_id": U_TASK_WATCHER, "role": "follower"},
            # Subtask's own watcher.
            {"id": "W-S", "task_id": "T1", "scope_type": "subtask",
             "subtask_id": "S1", "entity_id": None, "entity_type": None,
             "user_id": U_SUB_WATCHER, "role": "follower"},
        ],
        "task_entities": [],
        "comments": [],
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


def _by_user(watchers):
    return {w["user_id"]: w for w in watchers}


def test_subtask_watchers_include_inherited_task_scope(fake):
    rows = client.get("/api/v1/tasks/T1/subtasks").json()
    assert len(rows) == 1
    watchers = _by_user(rows[0]["watchers"])
    # Sub-own watcher: no inherited_from
    assert U_SUB_WATCHER in watchers
    assert watchers[U_SUB_WATCHER].get("inherited_from") in (None, "")
    # Task-scope watcher: tagged inherited_from='task'
    assert U_TASK_WATCHER in watchers
    assert watchers[U_TASK_WATCHER]["inherited_from"] == "task"


def test_subtasks_grouped_inherits_task_watchers(fake):
    g = client.get("/api/v1/tasks/T1/subtasks-grouped").json()
    sub = g["task_flat"][0]
    watchers = _by_user(sub["watchers"])
    assert watchers[U_TASK_WATCHER]["inherited_from"] == "task"
    assert watchers[U_SUB_WATCHER].get("inherited_from") in (None, "")


def test_inherited_dedupes_when_user_already_subtask_watcher(fake):
    """If the same (user_id, role) exists at both scopes, the inherited copy
    is suppressed — the subtask's own chip wins so it stays interactive."""
    # Add a duplicate row: U_BOTH is task-scope AND subtask-scope, same role.
    fake.store["item_watchers"].append({
        "id": "W-BT", "task_id": "T1", "scope_type": "task",
        "subtask_id": None, "entity_id": None, "entity_type": None,
        "user_id": U_BOTH, "role": "follower",
    })
    fake.store["item_watchers"].append({
        "id": "W-BS", "task_id": "T1", "scope_type": "subtask",
        "subtask_id": "S1", "entity_id": None, "entity_type": None,
        "user_id": U_BOTH, "role": "follower",
    })
    rows = client.get("/api/v1/tasks/T1/subtasks").json()
    # Only one entry per user (the subtask-own one), no duplicate inherited.
    user_counts: dict = {}
    for w in rows[0]["watchers"]:
        user_counts[w["user_id"]] = user_counts.get(w["user_id"], 0) + 1
    assert user_counts[U_BOTH] == 1
    both = next(w for w in rows[0]["watchers"] if w["user_id"] == U_BOTH)
    assert both.get("inherited_from") in (None, "")  # the own copy, not inherited


def test_inherited_keeps_different_role_at_same_user(fake):
    """If U_BOTH is task=approver and subtask=follower, the dedupe key is
    (user_id, role) — both entries should still appear."""
    fake.store["item_watchers"].append({
        "id": "W-BT2", "task_id": "T1", "scope_type": "task",
        "subtask_id": None, "entity_id": None, "entity_type": None,
        "user_id": U_BOTH, "role": "approver",
    })
    fake.store["item_watchers"].append({
        "id": "W-BS2", "task_id": "T1", "scope_type": "subtask",
        "subtask_id": "S1", "entity_id": None, "entity_type": None,
        "user_id": U_BOTH, "role": "follower",
    })
    rows = client.get("/api/v1/tasks/T1/subtasks").json()
    both_rows = [w for w in rows[0]["watchers"] if w["user_id"] == U_BOTH]
    assert len(both_rows) == 2
    roles_and_inherited = {(w["role"], w.get("inherited_from") or None) for w in both_rows}
    assert roles_and_inherited == {("approver", "task"), ("follower", None)}


def test_list_watchers_endpoint_unchanged_by_p4(fake):
    """Top-level /watchers still returns the raw set without inheritance
    tagging — it's the source-of-truth API, not the rendered view."""
    rows = client.get("/api/v1/tasks/T1/watchers").json()
    for w in rows:
        assert "inherited_from" not in w
