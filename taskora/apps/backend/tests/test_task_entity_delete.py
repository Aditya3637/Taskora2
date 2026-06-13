"""DELETE /tasks/{id}/entities/{entity_id} — remove a building/client attribute
from a task (admin/owner only), cascading entity-scoped subtasks + watchers.
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
MEMBER = "member-1"   # primary stakeholder, but only a 'member'
INIT = "init-1"
TASK = "task-1"
B1 = "bld-1"


def _seed():
    return FakeSupabase({
        "users": [
            {"id": OWNER, "name": "Owner"},
            {"id": MEMBER, "name": "Member"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme", "owner_id": OWNER}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "initiatives": [{"id": INIT, "business_id": BIZ, "name": "I"}],
        "tasks": [{"id": TASK, "initiative_id": INIT, "primary_stakeholder_id": MEMBER,
                   "status": "todo", "title": "T", "date_mode": "per_entity"}],
        "task_entities": [
            {"task_id": TASK, "entity_type": "building", "entity_id": B1,
             "per_entity_status": "backlog"},
        ],
        "subtasks": [
            {"id": "s-1", "task_id": TASK, "title": "Under B1", "status": "todo",
             "scoped_entity_id": B1, "parent_subtask_id": None},
            {"id": "s-2", "task_id": TASK, "title": "Unscoped", "status": "todo",
             "scoped_entity_id": None, "parent_subtask_id": None},
        ],
        "item_watchers": [
            {"id": "w-1", "task_id": TASK, "entity_id": B1, "scope_type": "entity",
             "user_id": OWNER, "role": "follower"},
        ],
    })


def _as(uid):
    return lambda: {"id": uid, "email": f"{uid}@x.io"}


@pytest.fixture
def sb():
    s = _seed()
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_member_cannot_remove_building(sb):
    app.dependency_overrides[get_current_user] = _as(MEMBER)
    r = client.delete(f"/api/v1/tasks/{TASK}/entities/{B1}")
    assert r.status_code == 403, r.text
    assert len(sb.store["task_entities"]) == 1


def test_owner_removes_building_and_cascades(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.delete(f"/api/v1/tasks/{TASK}/entities/{B1}")
    assert r.status_code == 204, r.text
    assert sb.store["task_entities"] == []
    # Entity-scoped subtask removed; unscoped one kept.
    ids = {s["id"] for s in sb.store["subtasks"]}
    assert ids == {"s-2"}
    # Entity watcher removed.
    assert sb.store["item_watchers"] == []


def test_remove_unknown_building_404(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.delete(f"/api/v1/tasks/{TASK}/entities/nope")
    assert r.status_code == 404, r.text


# ── add building/client ─────────────────────────────────────────────────────

def test_member_cannot_add_building(sb):
    app.dependency_overrides[get_current_user] = _as(MEMBER)
    r = client.post(f"/api/v1/tasks/{TASK}/entities",
                    json={"entity_type": "building", "entity_id": "bld-2"})
    assert r.status_code == 403, r.text


def test_owner_adds_building_with_name(sb):
    sb.store.setdefault("buildings", []).append({"id": "bld-2", "name": "Tower B"})
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.post(f"/api/v1/tasks/{TASK}/entities",
                    json={"entity_type": "building", "entity_id": "bld-2"})
    assert r.status_code == 201, r.text
    assert r.json()["entity_name"] == "Tower B"
    assert any(e["entity_id"] == "bld-2" for e in sb.store["task_entities"])


def test_add_duplicate_building_409(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.post(f"/api/v1/tasks/{TASK}/entities",
                    json={"entity_type": "building", "entity_id": B1})
    assert r.status_code == 409, r.text


# ── change_reason logging (Gantt drag) ──────────────────────────────────────

def test_task_due_change_records_reason(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.patch(f"/api/v1/tasks/{TASK}",
                     json={"due_date": "2026-09-30", "change_reason": "Rescheduled from the timeline"})
    assert r.status_code == 200, r.text
    logs = sb.store.get("task_date_change_log", [])
    assert logs and logs[-1]["reason"] == "Rescheduled from the timeline"
    assert logs[-1]["changed_by"] == OWNER


def test_entity_due_change_records_reason(sb):
    app.dependency_overrides[get_current_user] = _as(OWNER)
    r = client.patch(f"/api/v1/tasks/{TASK}/entities/{B1}",
                     json={"per_entity_end_date": "2026-09-30", "change_reason": "Rescheduled from the timeline"})
    assert r.status_code == 200, r.text
    logs = [l for l in sb.store.get("task_date_change_log", []) if l.get("entity_id") == B1]
    assert logs and logs[-1]["reason"] == "Rescheduled from the timeline"
