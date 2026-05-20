"""Workspace owner/admin can edit tasks they don't personally own.

Regression for the "I can't edit dates on a task" prod bug — the workspace
owner of Business Excellence wasn't the primary stakeholder of every task,
and PATCH /api/v1/tasks/{id} (which handles due_date / title / priority /
description / status changes via this single endpoint) had its own inline
stakeholder-only check that diverged from _assert_task_write. Same shape
for PATCH /tasks/{id}/recurring/mark-done. Stakeholder management
(POST/DELETE /tasks/{id}/stakeholders) is also opened to owner/admin so
they can reassign stranded tasks.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

BIZ = "biz-1"
OWNER = "owner-1"      # workspace owner, NOT a stakeholder on the task
PRIMARY = "primary-1"  # task's primary stakeholder, not workspace owner
SECONDARY = "secondary-1"
STRANGER = "stranger-1"
TASK = "task-1"
INIT = "init-1"


def _seed():
    return FakeSupabase({
        "users": [
            {"id": OWNER,     "name": "Owner",     "email": "o@x.dev"},
            {"id": PRIMARY,   "name": "Primary",   "email": "p@x.dev"},
            {"id": SECONDARY, "name": "Secondary", "email": "s@x.dev"},
            {"id": STRANGER,  "name": "Stranger",  "email": "x@x.dev"},
        ],
        "businesses": [
            {"id": BIZ, "name": "Acme", "type": "building", "owner_id": OWNER},
        ],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER,   "role": "owner"},
            {"business_id": BIZ, "user_id": PRIMARY, "role": "member"},
            # SECONDARY and STRANGER are NOT members of this workspace.
        ],
        "initiatives": [
            {"id": INIT, "business_id": BIZ, "owner_id": OWNER, "name": "I"},
        ],
        "tasks": [
            {"id": TASK, "initiative_id": INIT, "primary_stakeholder_id": PRIMARY,
             "status": "todo", "title": "Original", "due_date": "2026-06-01"},
        ],
        "task_stakeholders": [
            {"task_id": TASK, "user_id": SECONDARY, "role": "secondary"},
        ],
        "subtasks": [],
        "task_entities": [],
        "item_watchers": [],
    })


def _as(user_id: str, **overrides):
    return lambda: {"id": user_id, "email": f"{user_id}@x.dev", **overrides}


@pytest.fixture
def sb():
    s = _seed()
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


# ── PATCH /tasks/{id} — the bug-of-the-day ─────────────────────────────────

def test_owner_can_edit_task_due_date(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.patch(f"/api/v1/tasks/{TASK}", json={"due_date": "2026-07-01"})
    assert r.status_code == 200, r.text
    t = next(t for t in sb.store["tasks"] if t["id"] == TASK)
    assert t["due_date"] == "2026-07-01"


def test_owner_can_edit_task_title(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.patch(f"/api/v1/tasks/{TASK}", json={"title": "New title"})
    assert r.status_code == 200
    t = next(t for t in sb.store["tasks"] if t["id"] == TASK)
    assert t["title"] == "New title"


def test_primary_can_still_edit(sb):
    app.dependency_overrides[get_current_user] = _as(PRIMARY)
    r = client.patch(f"/api/v1/tasks/{TASK}", json={"due_date": "2026-08-01"})
    assert r.status_code == 200


def test_secondary_can_edit_task(sb):
    # Add SECONDARY as a workspace member for the access gate's lookup.
    sb.store["business_members"].append(
        {"business_id": BIZ, "user_id": SECONDARY, "role": "member"})
    app.dependency_overrides[get_current_user] = _as(SECONDARY)
    r = client.patch(f"/api/v1/tasks/{TASK}", json={"due_date": "2026-09-01"})
    assert r.status_code == 200


def test_non_workspace_member_cannot_edit(sb):
    app.dependency_overrides[get_current_user] = _as(STRANGER)
    r = client.patch(f"/api/v1/tasks/{TASK}", json={"due_date": "2026-09-01"})
    assert r.status_code == 403


# ── POST/DELETE /tasks/{id}/stakeholders ──────────────────────────────────

def test_owner_can_add_stakeholder(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.post(
        f"/api/v1/tasks/{TASK}/stakeholders",
        json={"user_id": STRANGER, "role": "secondary"},
    )
    assert r.status_code == 201, r.text
    assert any(
        s["task_id"] == TASK and s["user_id"] == STRANGER
        for s in sb.store["task_stakeholders"]
    )


def test_owner_can_remove_stakeholder(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.delete(f"/api/v1/tasks/{TASK}/stakeholders/{SECONDARY}")
    assert r.status_code == 204
    assert not any(s["user_id"] == SECONDARY for s in sb.store["task_stakeholders"])


def test_secondary_cannot_add_stakeholder(sb):
    # Secondary deliberately denied — only primary or admin can decide.
    sb.store["business_members"].append(
        {"business_id": BIZ, "user_id": SECONDARY, "role": "member"})
    app.dependency_overrides[get_current_user] = _as(SECONDARY)
    r = client.post(
        f"/api/v1/tasks/{TASK}/stakeholders",
        json={"user_id": STRANGER, "role": "secondary"},
    )
    assert r.status_code == 403


def test_primary_can_still_manage_stakeholders(sb):
    app.dependency_overrides[get_current_user] = _as(PRIMARY)
    r = client.post(
        f"/api/v1/tasks/{TASK}/stakeholders",
        json={"user_id": STRANGER, "role": "secondary"},
    )
    assert r.status_code == 201


# ── PATCH /tasks/{id}/recurring/mark-done ─────────────────────────────────

def test_owner_can_mark_recurring_done(sb):
    sb.store["tasks"][0]["recurring_type"] = "weekly"
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.patch(f"/api/v1/tasks/{TASK}/recurring/mark-done")
    assert r.status_code == 200, r.text
