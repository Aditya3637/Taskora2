"""Archive / restore for tasks and subtasks, plus the admin-only gate on
adding/deleting attributes (subtasks).

Product rules under test:
  - Adding/deleting attributes and archiving/restoring are workspace
    owner/admin only — a plain member who is the task's primary stakeholder
    can no longer add/delete subtasks (they can still PATCH status/title).
  - Only a *done* task/subtask can be archived.
  - Archiving cascades to the whole subtask subtree; restore cascades back.
  - The active list (/my/page, subtasks-grouped) hides archived rows unless
    asked for them explicitly.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

BIZ = "biz-1"
OWNER = "owner-1"
ADMIN = "admin-1"
MEMBER = "member-1"   # primary stakeholder of the task, but only a 'member'
INIT = "init-1"
TASK = "task-1"
SUB = "sub-1"          # parent subtask
SUBSUB = "subsub-1"    # nested sub-subtask under SUB


def _seed():
    return FakeSupabase({
        "users": [
            {"id": OWNER,  "name": "Owner",  "email": "o@x.dev"},
            {"id": ADMIN,  "name": "Admin",  "email": "a@x.dev"},
            {"id": MEMBER, "name": "Member", "email": "m@x.dev"},
        ],
        "businesses": [
            {"id": BIZ, "name": "Acme", "type": "building", "owner_id": OWNER},
        ],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER,  "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN,  "role": "admin"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "initiatives": [
            {"id": INIT, "business_id": BIZ, "owner_id": OWNER, "name": "I"},
        ],
        "tasks": [
            {"id": TASK, "initiative_id": INIT, "primary_stakeholder_id": MEMBER,
             "status": "done", "title": "T", "archived_at": None},
        ],
        "task_stakeholders": [],
        "subtasks": [
            {"id": SUB, "task_id": TASK, "title": "Sub", "status": "done",
             "parent_subtask_id": None, "archived_at": None, "assignee_id": MEMBER},
            {"id": SUBSUB, "task_id": TASK, "title": "SubSub", "status": "done",
             "parent_subtask_id": SUB, "archived_at": None, "assignee_id": MEMBER},
        ],
        "task_entities": [],
        "item_watchers": [],
    })


def _as(user_id: str):
    return lambda: {"id": user_id, "email": f"{user_id}@x.dev"}


@pytest.fixture
def sb():
    s = _seed()
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


# ── add/delete attribute is admin/owner only ───────────────────────────────

def test_member_cannot_add_attribute(sb):
    app.dependency_overrides[get_current_user] = _as(MEMBER)
    r = client.post(f"/api/v1/tasks/{TASK}/subtasks", json={"title": "New"})
    assert r.status_code == 403, r.text


def test_admin_can_add_attribute(sb):
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    r = client.post(f"/api/v1/tasks/{TASK}/subtasks", json={"title": "New"})
    assert r.status_code == 201, r.text


def test_member_cannot_delete_attribute(sb):
    app.dependency_overrides[get_current_user] = _as(MEMBER)
    r = client.delete(f"/api/v1/tasks/{TASK}/subtasks/{SUB}")
    assert r.status_code == 403, r.text


# ── task archive / restore ─────────────────────────────────────────────────

def test_owner_archives_done_task_cascades_to_subtree(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.post(f"/api/v1/tasks/{TASK}/archive")
    assert r.status_code == 200, r.text
    assert r.json()["archived_at"] is not None
    # Task + both subtasks archived.
    task = [t for t in sb.store["tasks"] if t["id"] == TASK][0]
    assert task["archived_at"] is not None
    for s in sb.store["subtasks"]:
        assert s["archived_at"] is not None


def test_cannot_archive_non_done_task(sb):
    sb.store["tasks"][0]["status"] = "in_progress"
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.post(f"/api/v1/tasks/{TASK}/archive")
    assert r.status_code == 400, r.text


def test_member_cannot_archive_task(sb):
    app.dependency_overrides[get_current_user] = _as(MEMBER)
    r = client.post(f"/api/v1/tasks/{TASK}/archive")
    assert r.status_code == 403, r.text


def test_restore_task_cascades_back(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    client.post(f"/api/v1/tasks/{TASK}/archive")
    r = client.post(f"/api/v1/tasks/{TASK}/restore")
    assert r.status_code == 200, r.text
    task = [t for t in sb.store["tasks"] if t["id"] == TASK][0]
    assert task["archived_at"] is None
    for s in sb.store["subtasks"]:
        assert s["archived_at"] is None


# ── subtask archive / restore ──────────────────────────────────────────────

def test_archive_subtask_cascades_to_children(sb):
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    r = client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/archive")
    assert r.status_code == 200, r.text
    rows = {s["id"]: s for s in sb.store["subtasks"]}
    assert rows[SUB]["archived_at"] is not None
    assert rows[SUBSUB]["archived_at"] is not None  # cascaded


def test_cannot_archive_non_done_subtask(sb):
    sb.store["subtasks"][0]["status"] = "todo"
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    r = client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/archive")
    assert r.status_code == 400, r.text


def test_restore_subtask_cascades_to_children(sb):
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/archive")
    r = client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/restore")
    assert r.status_code == 200, r.text
    rows = {s["id"]: s for s in sb.store["subtasks"]}
    assert rows[SUB]["archived_at"] is None
    assert rows[SUBSUB]["archived_at"] is None


# ── active-list filtering ──────────────────────────────────────────────────

def test_grouped_hides_archived_by_default(sb):
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/archive")
    r = client.get(f"/api/v1/tasks/{TASK}/subtasks-grouped")
    assert r.status_code == 200, r.text
    ids = [s["id"] for s in r.json()["task_flat"]]
    assert SUB not in ids and SUBSUB not in ids


def test_grouped_includes_archived_when_asked(sb):
    app.dependency_overrides[get_current_user] = _as(ADMIN)
    client.post(f"/api/v1/tasks/{TASK}/subtasks/{SUB}/archive")
    r = client.get(f"/api/v1/tasks/{TASK}/subtasks-grouped?include_archived=true")
    assert r.status_code == 200, r.text
    ids = [s["id"] for s in r.json()["task_flat"]]
    assert SUB in ids and SUBSUB in ids


def test_my_page_excludes_and_archived_only_returns(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    client.post(f"/api/v1/tasks/{TASK}/archive")
    # Default active list: task hidden.
    r = client.get("/api/v1/tasks/my/page")
    assert r.status_code == 200, r.text
    assert TASK not in [t["id"] for t in r.json()["items"]]
    # archived_only: task surfaces.
    r2 = client.get("/api/v1/tasks/my/page?archived_only=true")
    assert r2.status_code == 200, r2.text
    assert TASK in [t["id"] for t in r2.json()["items"]]
