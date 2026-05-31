"""End-to-end tests for the workspace-scoped visibility model added 2026-05-22.

Owner/admin see everything. Members see only what they're aligned to:
  - Programs containing initiatives they have stake in (primary OR task
    stakeholder OR task creator).
  - Within each visible initiative, all tasks if they're the initiative's
    primary stakeholder; otherwise only tasks where they have stake or are
    the creator.
  - Task creation requires alignment.

Uses the in-memory FakeSupabase from tests/_fake_supabase.py.
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U_ADMIN = "u-admin"
U_INIT_PRIMARY = "u-init-primary"  # initiative.primary_stakeholder of INIT-A
U_STAKE = "u-stake"                # task_stakeholders row on a task in INIT-A
U_CREATOR = "u-creator"            # created_by on a task in INIT-A
U_OUTSIDER = "u-outsider"          # business member with no stake anywhere

_CURRENT = {"u": U_ADMIN}


def _as(uid):
    _CURRENT["u"] = uid


def _seed():
    return {
        "users": [
            {"id": U_ADMIN,        "name": "Admin",   "email": f"{U_ADMIN}@x.io"},
            {"id": U_INIT_PRIMARY, "name": "InitPrimary", "email": f"{U_INIT_PRIMARY}@x.io"},
            {"id": U_STAKE,        "name": "Stake",   "email": f"{U_STAKE}@x.io"},
            {"id": U_CREATOR,      "name": "Creator", "email": f"{U_CREATOR}@x.io"},
            {"id": U_OUTSIDER,     "name": "Outsider","email": f"{U_OUTSIDER}@x.io"},
        ],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_ADMIN,        "role": "admin"},
            {"business_id": "BIZ1", "user_id": U_INIT_PRIMARY, "role": "member"},
            {"business_id": "BIZ1", "user_id": U_STAKE,        "role": "member"},
            {"business_id": "BIZ1", "user_id": U_CREATOR,      "role": "member"},
            {"business_id": "BIZ1", "user_id": U_OUTSIDER,     "role": "member"},
        ],
        "programs": [
            {"id": "PROG-A", "business_id": "BIZ1", "name": "Program A", "status": "active",
             "color": "#3B82F6", "lead_user_id": U_ADMIN,
             "objective": None, "start_date": None, "target_end_date": None, "manual_health": None,
             "created_at": "2026-03-01T00:00:00+00:00"},
            {"id": "PROG-B", "business_id": "BIZ1", "name": "Program B", "status": "active",
             "color": "#16A34A", "lead_user_id": U_ADMIN,
             "objective": None, "start_date": None, "target_end_date": None, "manual_health": None,
             "created_at": "2026-03-02T00:00:00+00:00"},
        ],
        "initiatives": [
            # INIT-A is in PROG-A, has U_INIT_PRIMARY as primary stakeholder.
            {"id": "INIT-A", "business_id": "BIZ1", "program_id": "PROG-A",
             "name": "INIT in A", "status": "in_progress",
             "primary_stakeholder_id": U_INIT_PRIMARY, "owner_id": U_ADMIN,
             "impact_category": "cost", "date_mode": "uniform",
             "created_at": "2026-04-01T00:00:00+00:00"},
            # INIT-B is in PROG-B, primary is admin — nobody else is aligned.
            {"id": "INIT-B", "business_id": "BIZ1", "program_id": "PROG-B",
             "name": "INIT in B", "status": "in_progress",
             "primary_stakeholder_id": U_ADMIN, "owner_id": U_ADMIN,
             "impact_category": "cost", "date_mode": "uniform",
             "created_at": "2026-04-02T00:00:00+00:00"},
        ],
        "tasks": [
            # Task assigned to U_INIT_PRIMARY, with U_STAKE as a secondary
            # stakeholder, created by U_CREATOR — all three are aligned to INIT-A.
            {"id": "TASK-1", "title": "Build BOQ", "status": "in_progress",
             "initiative_id": "INIT-A", "primary_stakeholder_id": U_INIT_PRIMARY,
             "created_by": U_CREATOR, "due_date": None,
             "created_at": "2026-04-10T00:00:00+00:00",
             "priority": "medium", "approval_state": "none", "closed_at": None},
            # Admin-only task in INIT-B (nobody else assigned/created).
            {"id": "TASK-2", "title": "Admin work", "status": "in_progress",
             "initiative_id": "INIT-B", "primary_stakeholder_id": U_ADMIN,
             "created_by": U_ADMIN, "due_date": None,
             "created_at": "2026-04-11T00:00:00+00:00",
             "priority": "medium", "approval_state": "none", "closed_at": None},
            # Task in INIT-A assigned to admin only — INIT_PRIMARY should
            # still see it because they're initiative-primary.
            {"id": "TASK-3", "title": "Other A task", "status": "in_progress",
             "initiative_id": "INIT-A", "primary_stakeholder_id": U_ADMIN,
             "created_by": U_ADMIN, "due_date": None,
             "created_at": "2026-04-12T00:00:00+00:00",
             "priority": "medium", "approval_state": "none", "closed_at": None},
        ],
        "task_stakeholders": [
            {"task_id": "TASK-1", "user_id": U_INIT_PRIMARY, "role": "primary"},
            {"task_id": "TASK-1", "user_id": U_STAKE,        "role": "secondary"},
            {"task_id": "TASK-2", "user_id": U_ADMIN,        "role": "primary"},
            {"task_id": "TASK-3", "user_id": U_ADMIN,        "role": "primary"},
        ],
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


# ── Programs list scoping ─────────────────────────────────────────────────────

def test_admin_sees_all_programs(fake):
    _as(U_ADMIN)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert r.status_code == 200, r.text
    ids = sorted(p["id"] for p in r.json())
    assert ids == ["PROG-A", "PROG-B"]


def test_init_primary_sees_only_their_program(fake):
    _as(U_INIT_PRIMARY)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert ids == ["PROG-A"]


def test_task_stakeholder_sees_their_program(fake):
    _as(U_STAKE)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert [p["id"] for p in r.json()] == ["PROG-A"]


def test_creator_sees_their_program(fake):
    _as(U_CREATOR)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert [p["id"] for p in r.json()] == ["PROG-A"]


def test_outsider_sees_no_programs(fake):
    _as(U_OUTSIDER)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert r.json() == []


# ── Program detail scoping ───────────────────────────────────────────────────

def test_outsider_blocked_from_program_detail(fake):
    _as(U_OUTSIDER)
    r = client.get("/api/v1/programs/PROG-A")
    assert r.status_code == 403


def test_stake_can_open_program_detail(fake):
    _as(U_STAKE)
    r = client.get("/api/v1/programs/PROG-A")
    assert r.status_code == 200
    assert {i["id"] for i in r.json()["initiatives"]} == {"INIT-A"}


# ── Task list scoping (via /initiatives/business/.../with-tasks) ────────────

def test_admin_sees_all_initiatives_and_tasks(fake):
    _as(U_ADMIN)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    assert r.status_code == 200, r.text
    by_init = {i["id"]: i for i in r.json()}
    assert set(by_init) == {"INIT-A", "INIT-B"}
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1", "TASK-3"}
    assert {t["id"] for t in by_init["INIT-B"]["tasks"]} == {"TASK-2"}


def test_init_primary_sees_all_tasks_in_their_initiative(fake):
    _as(U_INIT_PRIMARY)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    by_init = {i["id"]: i for i in r.json()}
    # Only INIT-A visible (not INIT-B), and they see EVERY task under INIT-A
    # even TASK-3 which is assigned to admin.
    assert set(by_init) == {"INIT-A"}
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1", "TASK-3"}


def test_task_stakeholder_sees_only_their_tasks(fake):
    _as(U_STAKE)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    by_init = {i["id"]: i for i in r.json()}
    assert set(by_init) == {"INIT-A"}
    # U_STAKE is on TASK-1 only — not TASK-3 (admin-only).
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1"}


def test_creator_sees_only_tasks_they_created(fake):
    _as(U_CREATOR)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    by_init = {i["id"]: i for i in r.json()}
    assert set(by_init) == {"INIT-A"}
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1"}


def test_outsider_sees_no_initiatives(fake):
    _as(U_OUTSIDER)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    assert r.json() == []


# ── Task creation gate ───────────────────────────────────────────────────────

def test_admin_can_create_task_anywhere(fake):
    _as(U_ADMIN)
    r = client.post("/api/v1/tasks/", json={
        "title": "Admin new task", "initiative_id": "INIT-B",
        "primary_stakeholder_id": U_ADMIN,
    })
    assert r.status_code == 201, r.text


def test_aligned_member_can_create_task_in_their_initiative(fake):
    _as(U_INIT_PRIMARY)
    r = client.post("/api/v1/tasks/", json={
        "title": "New A task", "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_INIT_PRIMARY,
    })
    assert r.status_code == 201, r.text
    assert r.json()["created_by"] == U_INIT_PRIMARY


# ── Task-assignee-not-creator scenario ──────────────────────────────────────
# Hard-pin: a user whose only touchpoint on a task is being its primary
# stakeholder (someone else created it) must still see + act on it through
# every endpoint. The visibility view's task_stakeholders branch covers this
# because create_task inserts a task_stakeholders row alongside the task,
# but we lock the behaviour in with these tests so the cascade can't
# silently break.

def test_task_assignee_can_read_via_with_tasks(fake):
    """User assigned a task they didn't create must see it in the Tasks page
    feed (/initiatives/business/{id}/with-tasks)."""
    U_PURE_ASSIGNEE = "u-pure-assignee"
    fake.store["users"].append(
        {"id": U_PURE_ASSIGNEE, "name": "PureAssignee", "email": f"{U_PURE_ASSIGNEE}@x.io"}
    )
    fake.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": U_PURE_ASSIGNEE, "role": "member"}
    )
    # Admin creates a task in INIT-A and assigns to U_PURE_ASSIGNEE.
    # The assignee has no other touch: no init primary, no initiative_followers,
    # no watcher, no subtask, no created_by.
    fake.store["tasks"].append({
        "id": "TASK-ASSIGNED", "title": "Field BMS install",
        "status": "in_progress",
        "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_PURE_ASSIGNEE,
        "created_by": U_ADMIN,
        "due_date": None,
        "priority": "medium", "approval_state": "none", "closed_at": None,
        "created_at": "2026-05-15T00:00:00+00:00",
    })
    fake.store["task_stakeholders"].append(
        {"task_id": "TASK-ASSIGNED", "user_id": U_PURE_ASSIGNEE, "role": "primary"}
    )

    _as(U_PURE_ASSIGNEE)
    by_init = {i["id"]: i for i in client.get("/api/v1/initiatives/business/BIZ1/with-tasks").json()}
    # They see INIT-A …
    assert "INIT-A" in by_init, "assignee can't see the initiative containing their task"
    # … and crucially their assigned task is in the visible task list.
    task_ids = {t["id"] for t in by_init["INIT-A"]["tasks"]}
    assert "TASK-ASSIGNED" in task_ids, "assignee can't see the task they're assigned to"


def test_task_assignee_can_write(fake):
    """Same setup — they must also be able to act on the task (status
    change goes through _assert_task_write)."""
    U_PURE_ASSIGNEE = "u-pure-assignee-2"
    fake.store["users"].append(
        {"id": U_PURE_ASSIGNEE, "name": "PureAssignee2", "email": f"{U_PURE_ASSIGNEE}@x.io"}
    )
    fake.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": U_PURE_ASSIGNEE, "role": "member"}
    )
    fake.store["tasks"].append({
        "id": "TASK-WRITE", "title": "Some task",
        "status": "in_progress",
        "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_PURE_ASSIGNEE,
        "created_by": U_ADMIN,
        "due_date": None,
        "priority": "medium", "approval_state": "none", "closed_at": None,
        "created_at": "2026-05-15T00:00:00+00:00",
    })
    fake.store["task_stakeholders"].append(
        {"task_id": "TASK-WRITE", "user_id": U_PURE_ASSIGNEE, "role": "primary"}
    )

    _as(U_PURE_ASSIGNEE)
    # Mark done — hits _assert_task_write.
    r = client.patch("/api/v1/tasks/TASK-WRITE", json={"status": "done"})
    assert r.status_code == 200, r.text


# ── Subtask/sub-subtask assignee cascade ─────────────────────────────────────

def test_subtask_assignee_sees_program_and_initiative(fake):
    """A user whose only touchpoint is being assigned a subtask (or sub-
    subtask, same table + column) should still see the program + initiative
    in the Programs section."""
    U_SUB_ASSIGNEE = "u-sub-assignee"
    fake.store["users"].append(
        {"id": U_SUB_ASSIGNEE, "name": "SubAssignee", "email": f"{U_SUB_ASSIGNEE}@x.io"}
    )
    fake.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": U_SUB_ASSIGNEE, "role": "member"}
    )
    # Pure subtask assignee — no task_stakeholders row, no watcher, no
    # initiative_followers row, no primary stakeholder slot.
    fake.store["subtasks"].append({
        "id": "SUB-1",
        "task_id": "TASK-3",
        "title": "Wire BMS",
        "status": "in_progress",
        "approval_state": "none",
        "assignee_id": U_SUB_ASSIGNEE,
        "parent_subtask_id": None,
        "scoped_entity_id": None,
        "scoped_entity_type": None,
        "closed_at": None,
        "created_at": "2026-05-15T00:00:00+00:00",
    })

    _as(U_SUB_ASSIGNEE)
    # Programs list now surfaces PROG-A.
    progs = client.get("/api/v1/programs?business_id=BIZ1").json()
    assert [p["id"] for p in progs] == ["PROG-A"]

    # Initiatives + tasks: they see INIT-A and the sibling tasks under it.
    by_init = {i["id"]: i for i in client.get("/api/v1/initiatives/business/BIZ1/with-tasks").json()}
    assert "INIT-A" in by_init


def test_subtask_assignee_still_cannot_create_tasks(fake):
    """Read access via the cascade does NOT grant write access — create_task
    still uses writable_initiative_ids which excludes subtask assignees."""
    U_SUB_ASSIGNEE = "u-sub-assignee-2"
    fake.store["users"].append(
        {"id": U_SUB_ASSIGNEE, "name": "SubAssignee2", "email": f"{U_SUB_ASSIGNEE}@x.io"}
    )
    fake.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": U_SUB_ASSIGNEE, "role": "member"}
    )
    fake.store["subtasks"].append({
        "id": "SUB-2",
        "task_id": "TASK-3",
        "title": "Wire BMS",
        "status": "in_progress",
        "approval_state": "none",
        "assignee_id": U_SUB_ASSIGNEE,
        "parent_subtask_id": None,
        "scoped_entity_id": None,
        "scoped_entity_type": None,
        "closed_at": None,
        "created_at": "2026-05-15T00:00:00+00:00",
    })

    _as(U_SUB_ASSIGNEE)
    r = client.post("/api/v1/tasks/", json={
        "title": "Outsider tries",
        "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_SUB_ASSIGNEE,
    })
    assert r.status_code == 403


def test_sub_subtask_assignee_also_sees_program(fake):
    """Sub-subtask rows are stored in the same subtasks table with a
    parent_subtask_id. assignee_id is the same column, so the cascade
    must work for them too."""
    U_DEEP = "u-deep"
    fake.store["users"].append(
        {"id": U_DEEP, "name": "Deep", "email": f"{U_DEEP}@x.io"}
    )
    fake.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": U_DEEP, "role": "member"}
    )
    # Parent subtask owned by admin, child sub-subtask assigned to U_DEEP.
    fake.store["subtasks"].append({
        "id": "SUB-PARENT",
        "task_id": "TASK-3",
        "title": "Parent sub",
        "status": "in_progress",
        "approval_state": "none",
        "assignee_id": U_ADMIN,
        "parent_subtask_id": None,
        "scoped_entity_id": None,
        "scoped_entity_type": None,
        "closed_at": None,
        "created_at": "2026-05-14T00:00:00+00:00",
    })
    fake.store["subtasks"].append({
        "id": "SUB-CHILD",
        "task_id": "TASK-3",
        "title": "Sub-subtask",
        "status": "in_progress",
        "approval_state": "none",
        "assignee_id": U_DEEP,
        "parent_subtask_id": "SUB-PARENT",
        "scoped_entity_id": None,
        "scoped_entity_type": None,
        "closed_at": None,
        "created_at": "2026-05-15T00:00:00+00:00",
    })

    _as(U_DEEP)
    progs = client.get("/api/v1/programs?business_id=BIZ1").json()
    assert "PROG-A" in {p["id"] for p in progs}


def test_unaligned_member_cannot_create_task_in_other_initiative(fake):
    _as(U_OUTSIDER)
    r = client.post("/api/v1/tasks/", json={
        "title": "Sneaky", "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_OUTSIDER,
    })
    assert r.status_code == 403


# ── Followers (initiative_followers) ─────────────────────────────────────────

def _add_follower(fake, init_id, user_id, added_by=U_ADMIN):
    fake.store.setdefault("initiative_followers", []).append({
        "initiative_id": init_id, "user_id": user_id,
        "added_by": added_by, "added_at": "2026-05-22T00:00:00+00:00",
    })


def test_admin_can_add_follower(fake):
    _as(U_ADMIN)
    r = client.post(
        "/api/v1/initiatives/INIT-A/followers",
        json={"user_id": U_OUTSIDER},
    )
    assert r.status_code == 201, r.text
    # Side-effect visible in the underlying store.
    rows = [
        f for f in fake.store["initiative_followers"]
        if f["initiative_id"] == "INIT-A"
    ]
    assert any(f["user_id"] == U_OUTSIDER for f in rows)


def test_non_admin_cannot_add_follower(fake):
    _as(U_INIT_PRIMARY)  # initiative primary, but not a workspace admin
    r = client.post(
        "/api/v1/initiatives/INIT-A/followers",
        json={"user_id": U_OUTSIDER},
    )
    assert r.status_code == 403


def test_list_followers_includes_user_name(fake):
    _add_follower(fake, "INIT-A", U_OUTSIDER)
    _as(U_INIT_PRIMARY)  # any member can list
    r = client.get("/api/v1/initiatives/INIT-A/followers")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["user_id"] == U_OUTSIDER
    assert body[0]["name"] == "Outsider"


def test_admin_can_remove_follower(fake):
    _add_follower(fake, "INIT-A", U_OUTSIDER)
    _as(U_ADMIN)
    r = client.delete(f"/api/v1/initiatives/INIT-A/followers/{U_OUTSIDER}")
    assert r.status_code == 204
    rows = [
        f for f in fake.store["initiative_followers"]
        if f["initiative_id"] == "INIT-A" and f["user_id"] == U_OUTSIDER
    ]
    assert rows == []


def test_follower_sees_program_via_alignment(fake):
    """A follower with no other stake gains program visibility."""
    _add_follower(fake, "INIT-A", U_OUTSIDER)
    _as(U_OUTSIDER)
    r = client.get("/api/v1/programs?business_id=BIZ1")
    assert [p["id"] for p in r.json()] == ["PROG-A"]


def test_follower_sees_all_tasks_in_followed_initiative(fake):
    """Follower mirrors initiative-primary visibility: every task under
    INIT-A is visible to them, including admin-only TASK-3."""
    _add_follower(fake, "INIT-A", U_OUTSIDER)
    _as(U_OUTSIDER)
    r = client.get("/api/v1/initiatives/business/BIZ1/with-tasks")
    by_init = {i["id"]: i for i in r.json()}
    assert set(by_init) == {"INIT-A"}
    assert {t["id"] for t in by_init["INIT-A"]["tasks"]} == {"TASK-1", "TASK-3"}
    # Followers are read-only — they should NOT get viewer_can_edit=True.
    assert by_init["INIT-A"]["viewer_can_edit"] is False


def test_follower_cannot_create_task(fake):
    """Followers are read-only — creation must be denied even though they
    are 'aligned' for visibility."""
    _add_follower(fake, "INIT-A", U_OUTSIDER)
    _as(U_OUTSIDER)
    r = client.post("/api/v1/tasks/", json={
        "title": "Should fail",
        "initiative_id": "INIT-A",
        "primary_stakeholder_id": U_OUTSIDER,
    })
    assert r.status_code == 403
