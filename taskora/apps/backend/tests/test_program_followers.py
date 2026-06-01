"""P1: Program followers — the apex of the visibility pyramid.

Following a program grants read access to every initiative under it (and
via the task cascade, every task/subtask). Add/remove gated to workspace
owner/admin. Mirrors the initiative_followers (033) test surface.

Uses the in-memory FakeSupabase.
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U_ADMIN = "u-admin"
U_FOLLOWER = "u-follower"      # explicit program_followers row on PROG-A
U_OUTSIDER = "u-outsider"      # member with no stake or follow anywhere

_CURRENT = {"u": U_ADMIN}


def _as(uid):
    _CURRENT["u"] = uid


def _seed():
    return {
        "users": [
            {"id": U_ADMIN,    "name": "Admin",    "email": f"{U_ADMIN}@x.io"},
            {"id": U_FOLLOWER, "name": "Follower", "email": f"{U_FOLLOWER}@x.io"},
            {"id": U_OUTSIDER, "name": "Outsider", "email": f"{U_OUTSIDER}@x.io"},
        ],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_ADMIN,    "role": "admin"},
            {"business_id": "BIZ1", "user_id": U_FOLLOWER, "role": "member"},
            {"business_id": "BIZ1", "user_id": U_OUTSIDER, "role": "member"},
        ],
        "programs": [
            {"id": "PROG-A", "business_id": "BIZ1", "name": "Program A", "status": "active",
             "color": "#3B82F6", "lead_user_id": U_ADMIN,
             "objective": None, "start_date": None, "target_end_date": None, "manual_health": None,
             "created_at": "2026-03-01T00:00:00+00:00"},
            # PROG-B is intentionally empty (no initiatives) to prove that
            # followed-but-empty programs stay visible to followers.
            {"id": "PROG-B", "business_id": "BIZ1", "name": "Program B", "status": "active",
             "color": "#16A34A", "lead_user_id": U_ADMIN,
             "objective": None, "start_date": None, "target_end_date": None, "manual_health": None,
             "created_at": "2026-03-02T00:00:00+00:00"},
        ],
        "initiatives": [
            {"id": "INIT-A", "business_id": "BIZ1", "program_id": "PROG-A",
             "name": "INIT in A", "status": "in_progress",
             "primary_stakeholder_id": U_ADMIN, "owner_id": U_ADMIN,
             "impact_category": "cost", "date_mode": "uniform",
             "created_at": "2026-04-01T00:00:00+00:00"},
        ],
        "tasks": [
            {"id": "TASK-1", "title": "Admin work in A", "status": "in_progress",
             "initiative_id": "INIT-A", "primary_stakeholder_id": U_ADMIN,
             "created_by": U_ADMIN, "due_date": None,
             "created_at": "2026-04-10T00:00:00+00:00",
             "priority": "medium", "approval_state": "none", "closed_at": None},
        ],
        "task_stakeholders": [
            {"task_id": "TASK-1", "user_id": U_ADMIN, "role": "primary"},
        ],
        "program_followers": [],
        "initiative_followers": [],
        "item_watchers": [],
        "task_entities": [],
        "initiative_entities": [],
        "buildings": [],
        "clients": [],
        "subtasks": [],
    }


@pytest.fixture
def fake():
    f = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: (
        {"id": _CURRENT["u"], "email": f"{_CURRENT['u']}@x.io"}
    )
    app.dependency_overrides[get_supabase] = lambda: f
    yield f
    app.dependency_overrides.clear()
    _CURRENT["u"] = U_ADMIN


# ── Follower CRUD gates ──────────────────────────────────────────────────────

def test_member_cannot_add_program_follower(fake):
    _as(U_OUTSIDER)
    r = client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    assert r.status_code == 403


def test_admin_can_add_and_list_program_followers(fake):
    _as(U_ADMIN)
    r = client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    assert r.status_code == 201, r.text

    r = client.get("/api/v1/programs/PROG-A/followers")
    assert r.status_code == 200
    rows = r.json()
    assert {row["user_id"] for row in rows} == {U_FOLLOWER}
    assert rows[0]["name"] == "Follower"


def test_admin_cannot_follow_non_member(fake):
    _as(U_ADMIN)
    r = client.post("/api/v1/programs/PROG-A/followers", json={"user_id": "u-stranger"})
    assert r.status_code == 400


def test_admin_can_remove_program_follower(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    r = client.delete(f"/api/v1/programs/PROG-A/followers/{U_FOLLOWER}")
    assert r.status_code == 204
    rows = client.get("/api/v1/programs/PROG-A/followers").json()
    assert rows == []


# ── Visibility cascade ───────────────────────────────────────────────────────

def test_outsider_sees_nothing_without_follow(fake):
    _as(U_OUTSIDER)
    assert client.get("/api/v1/programs?business_id=BIZ1").json() == []
    assert client.get("/api/v1/programs/PROG-A").status_code == 403
    assert client.get("/api/v1/initiatives/business/BIZ1/with-tasks").json() == []


def test_program_follower_sees_program_in_list(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    rows = client.get("/api/v1/programs?business_id=BIZ1").json()
    assert [p["id"] for p in rows] == ["PROG-A"]
    # initiative_count reflects the full set under followed programs.
    assert rows[0]["initiative_count"] == 1


def test_empty_followed_program_still_listed(fake):
    """Following a program with no initiatives still surfaces it in the list."""
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-B/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    rows = client.get("/api/v1/programs?business_id=BIZ1").json()
    assert [p["id"] for p in rows] == ["PROG-B"]
    assert rows[0]["initiative_count"] == 0


def test_program_follower_can_open_program_detail(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    r = client.get("/api/v1/programs/PROG-A")
    assert r.status_code == 200
    assert {i["id"] for i in r.json()["initiatives"]} == {"INIT-A"}


def test_program_follower_sees_initiatives_with_tasks(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    by_init = {i["id"]: i for i in client.get("/api/v1/initiatives/business/BIZ1/with-tasks").json()}
    assert set(by_init) == {"INIT-A"}
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1"}


def test_program_follower_sees_tasks_in_my_page(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    r = client.get("/api/v1/tasks/my/page")
    assert r.status_code == 200, r.text
    assert {t["id"] for t in r.json()["items"]} == {"TASK-1"}


def test_unfollowing_revokes_visibility(fake):
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    client.delete(f"/api/v1/programs/PROG-A/followers/{U_FOLLOWER}")
    _as(U_FOLLOWER)
    assert client.get("/api/v1/programs?business_id=BIZ1").json() == []
    assert client.get("/api/v1/programs/PROG-A").status_code == 403


def test_program_follower_cannot_create_task(fake):
    """Followers are read-only — writable_initiative_ids excludes them."""
    _as(U_ADMIN)
    client.post("/api/v1/programs/PROG-A/followers", json={"user_id": U_FOLLOWER})
    _as(U_FOLLOWER)
    r = client.post("/api/v1/tasks/", json={
        "title": "Should fail",
        "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_FOLLOWER,
    })
    assert r.status_code == 403
