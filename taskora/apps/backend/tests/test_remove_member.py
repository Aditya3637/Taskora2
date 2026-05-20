"""DELETE /businesses/{id}/members/{userId}: reassign-on-remove.

When an admin/owner removes a member we keep the tasks but reattach them to
the caller. task_stakeholders / item_watchers for the removed user are dropped,
subtasks.assignee_id is nulled. Same user in another business is untouched.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "owner-1"
TARGET = "target-1"
BIZ = "biz-1"
OTHER_BIZ = "biz-2"


def _seed():
    """Owner + target both in BIZ. Target also in OTHER_BIZ with cross-biz tasks."""
    return FakeSupabase({
        "businesses": [
            {"id": BIZ, "name": "Acme", "type": "building", "owner_id": OWNER},
            {"id": OTHER_BIZ, "name": "Other", "type": "building", "owner_id": TARGET},
        ],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": TARGET, "role": "member"},
            {"business_id": OTHER_BIZ, "user_id": TARGET, "role": "owner"},
        ],
        "users": [
            {"id": OWNER, "name": "Owner", "email": "owner@x.dev"},
            {"id": TARGET, "name": "Target", "email": "target@x.dev"},
        ],
        "initiatives": [
            {"id": "init-1", "business_id": BIZ, "owner_id": TARGET, "name": "I1"},
            {"id": "init-2", "business_id": BIZ, "owner_id": OWNER, "name": "I2"},
            {"id": "init-other", "business_id": OTHER_BIZ, "owner_id": TARGET, "name": "X"},
        ],
        "tasks": [
            # Two of TARGET's primary tasks in BIZ — both should reassign.
            {"id": "t1", "initiative_id": "init-1", "primary_stakeholder_id": TARGET,
             "status": "todo"},
            {"id": "t2", "initiative_id": "init-1", "primary_stakeholder_id": TARGET,
             "status": "in_progress"},
            # OWNER's own task — must not move.
            {"id": "t3", "initiative_id": "init-2", "primary_stakeholder_id": OWNER,
             "status": "todo"},
            # Cross-business task (different initiative tree) — must not move.
            {"id": "t-other", "initiative_id": "init-other",
             "primary_stakeholder_id": TARGET, "status": "todo"},
        ],
        "task_stakeholders": [
            {"task_id": "t3", "user_id": TARGET, "role": "secondary"},
            {"task_id": "t-other", "user_id": TARGET, "role": "secondary"},
        ],
        "subtasks": [
            {"id": "s1", "task_id": "t1", "assignee_id": TARGET,
             "title": "do thing", "status": "todo"},
            {"id": "s-other", "task_id": "t-other", "assignee_id": TARGET,
             "title": "x", "status": "todo"},
        ],
        "item_watchers": [
            {"id": "w1", "task_id": "t1", "scope_type": "task", "user_id": TARGET},
            {"id": "w-other", "task_id": "t-other", "scope_type": "task",
             "user_id": TARGET},
        ],
    })


@pytest.fixture
def sb():
    s = _seed()
    app.dependency_overrides[get_current_user] = lambda: {
        "id": OWNER, "email": "owner@x.dev"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_remove_member_reassigns_tasks_to_caller(sb):
    r = client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    assert r.status_code == 204, r.text

    by_id = {t["id"]: t for t in sb.store["tasks"]}
    assert by_id["t1"]["primary_stakeholder_id"] == OWNER
    assert by_id["t2"]["primary_stakeholder_id"] == OWNER
    # OWNER's task stays OWNER's.
    assert by_id["t3"]["primary_stakeholder_id"] == OWNER
    # Tasks themselves are preserved (the whole point).
    assert {"t1", "t2", "t3"}.issubset(by_id.keys())


def test_remove_member_reassigns_initiatives(sb):
    client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    by_id = {i["id"]: i for i in sb.store["initiatives"]}
    assert by_id["init-1"]["owner_id"] == OWNER
    assert by_id["init-2"]["owner_id"] == OWNER  # unchanged


def test_remove_member_drops_task_stakeholders_and_watchers(sb):
    client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    ts = sb.store["task_stakeholders"]
    # The biz-scoped secondary (none here on t1/t2) gone; t3's was OWNER's
    # task so target's secondary on t3 should be gone too (it's in BIZ).
    assert not any(
        row["user_id"] == TARGET and row["task_id"] in {"t1", "t2", "t3"}
        for row in ts
    )
    iw = sb.store["item_watchers"]
    assert not any(
        row["user_id"] == TARGET and row["task_id"] in {"t1", "t2", "t3"}
        for row in iw
    )


def test_remove_member_nulls_subtask_assignees(sb):
    client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    s1 = next(s for s in sb.store["subtasks"] if s["id"] == "s1")
    assert s1["assignee_id"] is None


def test_remove_member_does_not_touch_other_business(sb):
    client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    by_id = {t["id"]: t for t in sb.store["tasks"]}
    assert by_id["t-other"]["primary_stakeholder_id"] == TARGET
    inits = {i["id"]: i for i in sb.store["initiatives"]}
    assert inits["init-other"]["owner_id"] == TARGET
    assert any(
        row["task_id"] == "t-other" and row["user_id"] == TARGET
        for row in sb.store["task_stakeholders"]
    )
    assert any(
        row["task_id"] == "t-other" and row["user_id"] == TARGET
        for row in sb.store["item_watchers"]
    )
    s_other = next(s for s in sb.store["subtasks"] if s["id"] == "s-other")
    assert s_other["assignee_id"] == TARGET


def test_remove_member_deletes_membership_last(sb):
    client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    assert not any(
        m["business_id"] == BIZ and m["user_id"] == TARGET
        for m in sb.store["business_members"]
    )
    # Cross-business membership untouched.
    assert any(
        m["business_id"] == OTHER_BIZ and m["user_id"] == TARGET
        for m in sb.store["business_members"]
    )


def test_cannot_remove_self(sb):
    r = client.delete(f"/api/v1/businesses/{BIZ}/members/{OWNER}")
    assert r.status_code == 400


def test_cannot_remove_owner(sb):
    # Promote target to owner shape and try.
    sb.store["business_members"] = [
        {"business_id": BIZ, "user_id": TARGET, "role": "owner"},
        {"business_id": BIZ, "user_id": OWNER, "role": "admin"},
    ]
    r = client.delete(f"/api/v1/businesses/{BIZ}/members/{TARGET}")
    assert r.status_code == 403
