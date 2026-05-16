"""End-to-end logic tests for the Followers/Approvers + Approval workflow.

Runs the real FastAPI handlers against an in-memory fake Supabase that enforces
the DB constraints, so the full close→pending→approve/reject lifecycle, watcher
visibility, scope handling and payload enrichment are exercised for real.
"""
import copy
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
import routers.tasks as tasks_mod
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U_OWNER = "u-owner"
U_APP = "u-approver"
U_APP2 = "u-approver2"
U_FOL = "u-follower"
U_OUT = "u-outsider"
U_ADMIN = "u-admin"

_CURRENT = {"u": U_OWNER}
_PUSHES = []


def _as(uid):
    _CURRENT["u"] = uid


def _seed():
    def user(uid, name):
        return {"id": uid, "name": name, "email": f"{uid}@x.io", "settings": {}}

    store = {
        "users": [
            user(U_OWNER, "Owner"), user(U_APP, "Approver"),
            user(U_APP2, "Approver Two"), user(U_FOL, "Follower"),
            user(U_OUT, "Outsider"), user(U_ADMIN, "Workspace Admin"),
        ],
        "tasks": [
            {
                "id": "T1", "title": "Quarterly audit", "status": "in_progress",
                "priority": "medium", "due_date": None, "initiative_id": None,
                "primary_stakeholder_id": U_OWNER, "approval_state": "none",
                "closed_at": None, "created_at": "2026-05-01T00:00:00+00:00",
            },
            {
                "id": "T2", "title": "Vendor onboarding", "status": "in_progress",
                "priority": "medium", "due_date": None, "initiative_id": "INIT1",
                "primary_stakeholder_id": U_OWNER, "approval_state": "none",
                "closed_at": None, "created_at": "2026-05-03T00:00:00+00:00",
            },
        ],
        "initiatives": [{"id": "INIT1", "business_id": "BIZ1"}],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_ADMIN, "role": "admin"},
        ],
        "task_stakeholders": [
            {"task_id": "T1", "user_id": U_OWNER, "role": "primary"},
            {"task_id": "T2", "user_id": U_OWNER, "role": "primary"},
        ],
        "task_entities": [{
            "task_id": "T1", "entity_type": "building", "entity_id": "E1",
            "per_entity_status": "in_progress", "per_entity_end_date": None,
            "approval_state": "none", "closed_at": None,
            "updated_at": "2026-05-01T00:00:00+00:00",
        }],
        "subtasks": [{
            "id": "S1", "task_id": "T1", "title": "Pull ledgers",
            "status": "in_progress", "approval_state": "none",
            "assignee_id": U_OWNER, "parent_subtask_id": None,
            "scoped_entity_id": None, "scoped_entity_type": None,
            "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
        }],
        "buildings": [{"id": "E1", "name": "HQ Tower"}],
        "clients": [],
        "comments": [],
        "item_watchers": [],
        "approval_log": [],
        "task_date_change_log": [],
        "attachments": [],
    }
    return store


@pytest.fixture(autouse=True)
def _wire(monkeypatch):
    sb = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: {
        "id": _CURRENT["u"], "email": f"{_CURRENT['u']}@x.io",
    }
    app.dependency_overrides[get_supabase] = lambda: sb
    _PUSHES.clear()
    monkeypatch.setattr(
        tasks_mod, "send_push_to_user",
        lambda _sb, uid, title, body, data=None: _PUSHES.append((uid, title)),
    )
    _as(U_OWNER)
    yield sb
    app.dependency_overrides.clear()


# ── helpers ──────────────────────────────────────────────────────────────────

def add_watcher(scope_type, role, user_id, **scope):
    return client.post(
        "/api/v1/tasks/T1/watchers",
        json={"scope_type": scope_type, "role": role, "user_id": user_id, **scope},
    )


def approvals(action, scope_type="task", reason=None, **scope):
    body = {"scope_type": scope_type, "action": action, **scope}
    if reason is not None:
        body["reason"] = reason
    return client.post("/api/v1/tasks/T1/approvals", json=body)


def row(sb, table, **match):
    for r in sb.store[table]:
        if all(r.get(k) == v for k, v in match.items()):
            return r
    return None


# ════════════════════════════ A. Watchers CRUD ══════════════════════════════

def test_add_and_list_task_follower(_wire):
    _as(U_OWNER)
    r = add_watcher("task", "follower", U_FOL)
    assert r.status_code == 201
    lst = client.get("/api/v1/tasks/T1/watchers").json()
    assert any(w["user_id"] == U_FOL and w["role"] == "follower" for w in lst)


def test_add_subtask_approver_validates_subtask_belongs_to_task(_wire):
    _as(U_OWNER)
    assert add_watcher("subtask", "approver", U_APP, subtask_id="S1").status_code == 201
    assert add_watcher("subtask", "approver", U_APP,
                        subtask_id="GHOST").status_code == 404


def test_entity_scope_requires_entity_fields(_wire):
    _as(U_OWNER)
    assert add_watcher("entity", "approver", U_APP).status_code == 422
    assert add_watcher("entity", "approver", U_APP, entity_type="building",
                        entity_id="E1").status_code == 201


def test_subtask_scope_requires_subtask_id(_wire):
    _as(U_OWNER)
    assert add_watcher("subtask", "follower", U_FOL).status_code == 422


def test_watcher_add_is_idempotent(_wire, ):
    _as(U_OWNER)
    a = add_watcher("task", "approver", U_APP)
    b = add_watcher("task", "approver", U_APP)
    assert a.status_code == 201 and b.status_code == 201
    sb = app.dependency_overrides[get_supabase]()
    assert len([w for w in sb.store["item_watchers"]
                if w["user_id"] == U_APP]) == 1


def test_non_stakeholder_cannot_manage_watchers(_wire):
    _as(U_OUT)
    assert add_watcher("task", "follower", U_FOL).status_code == 403


def test_remove_watcher(_wire):
    _as(U_OWNER)
    add_watcher("task", "follower", U_FOL)
    sb = app.dependency_overrides[get_supabase]()
    wid = sb.store["item_watchers"][0]["id"]
    assert client.delete(f"/api/v1/tasks/T1/watchers/{wid}").status_code == 204
    assert sb.store["item_watchers"] == []


# ════════════════════════════ B. Visibility ═════════════════════════════════

def test_follower_gains_task_tree_access(_wire):
    _as(U_OWNER)
    add_watcher("task", "follower", U_FOL)
    _as(U_FOL)
    assert client.get("/api/v1/tasks/T1").status_code == 200
    assert client.get("/api/v1/tasks/T1/subtasks-grouped").status_code == 200
    page = client.get("/api/v1/tasks/my/page").json()
    assert any(t["id"] == "T1" for t in page["items"])


def test_outsider_denied(_wire):
    _as(U_OUT)
    assert client.get("/api/v1/tasks/T1").status_code == 403
    assert client.get("/api/v1/tasks/T1/subtasks-grouped").status_code == 403
    assert client.get("/api/v1/tasks/my/page").json()["items"] == []


# ════════════════════ C. Close → pending (all scopes) ═══════════════════════

def test_done_without_approver_just_closes(_wire):
    _as(U_OWNER)
    r = client.patch("/api/v1/tasks/T1", json={"status": "done"})
    assert r.status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    t = row(sb, "tasks", id="T1")
    assert t["status"] == "done" and t["closed_at"] is not None
    assert t["approval_state"] == "none"


def test_done_with_task_approver_enters_pending(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    r = client.patch("/api/v1/tasks/T1", json={"status": "done"})
    assert r.status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    t = row(sb, "tasks", id="T1")
    assert t["status"] == "done"
    assert t["closed_at"] is not None          # TAT still anchored
    assert t["approval_state"] == "pending"


def test_status_endpoint_task_level_pending(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    assert client.patch("/api/v1/tasks/T1/status",
                        json={"status": "done"}).status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "tasks", id="T1")["approval_state"] == "pending"


def test_entity_level_pending(_wire):
    _as(U_OWNER)
    add_watcher("entity", "approver", U_APP, entity_type="building", entity_id="E1")
    r = client.patch("/api/v1/tasks/T1/entities/E1",
                      json={"per_entity_status": "done"})
    assert r.status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    e = row(sb, "task_entities", task_id="T1", entity_id="E1")
    assert e["approval_state"] == "pending" and e["closed_at"] is not None


def test_subtask_level_pending(_wire):
    _as(U_OWNER)
    add_watcher("subtask", "approver", U_APP, subtask_id="S1")
    r = client.patch("/api/v1/tasks/T1/subtasks/S1", json={"status": "done"})
    assert r.status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "subtasks", id="S1")["approval_state"] == "pending"


def test_leaving_done_resets_approval(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    client.patch("/api/v1/tasks/T1", json={"status": "done"})
    client.patch("/api/v1/tasks/T1", json={"status": "in_progress"})
    sb = app.dependency_overrides[get_supabase]()
    t = row(sb, "tasks", id="T1")
    assert t["approval_state"] == "none" and t["closed_at"] is None


# ════════════════════════ D. Approve / Reject ═══════════════════════════════

def _send_for_approval(scope_type="task", **scope):
    _as(U_OWNER)
    if scope_type == "task":
        client.patch("/api/v1/tasks/T1", json={"status": "done"})
    elif scope_type == "subtask":
        client.patch(f"/api/v1/tasks/T1/subtasks/{scope['subtask_id']}",
                     json={"status": "done"})
    else:
        client.patch(f"/api/v1/tasks/T1/entities/{scope['entity_id']}",
                     json={"per_entity_status": "done"})


def test_approver_approves(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    sb = app.dependency_overrides[get_supabase]()
    closed_before = row(sb, "tasks", id="T1")["closed_at"]
    _as(U_APP)
    r = approvals("approve")
    assert r.status_code == 201 and r.json()["approval_state"] == "approved"
    t = row(sb, "tasks", id="T1")
    assert t["approval_state"] == "approved"
    assert t["status"] == "done"
    assert t["closed_at"] == closed_before          # TAT unchanged
    assert row(sb, "approval_log", task_id="T1", action="approve")
    assert row(sb, "comments", task_id="T1", kind="approval")


def test_reject_requires_reason(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    _as(U_APP)
    r = approvals("reject")
    assert r.status_code == 422
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "tasks", id="T1")["approval_state"] == "pending"


def test_reject_reopens_and_posts_red_comment(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    _as(U_APP)
    r = approvals("reject", reason="Numbers don't reconcile")
    assert r.status_code == 201
    sb = app.dependency_overrides[get_supabase]()
    t = row(sb, "tasks", id="T1")
    assert t["approval_state"] == "rejected"
    assert t["status"] == "reopened"
    assert t["closed_at"] is None
    c = row(sb, "comments", task_id="T1", kind="rejection")
    assert c and c["content"] == "Numbers don't reconcile"
    assert c["entity_id"] is None and c["subtask_id"] is None
    assert (U_OWNER, "Item rejected") in _PUSHES


def test_non_approver_cannot_act(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    _as(U_FOL)
    assert approvals("approve").status_code == 403


def test_first_action_wins(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    add_watcher("task", "approver", U_APP2)
    _send_for_approval("task")
    _as(U_APP)
    assert approvals("approve").status_code == 201
    _as(U_APP2)
    assert approvals("approve").status_code == 409


def test_reopen_then_redo_reenters_pending(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    _as(U_APP)
    approvals("reject", reason="redo")
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "tasks", id="T1")["status"] == "reopened"
    _as(U_OWNER)
    client.patch("/api/v1/tasks/T1", json={"status": "done"})
    t = row(sb, "tasks", id="T1")
    assert t["status"] == "done"
    assert t["approval_state"] == "pending"
    assert t["closed_at"] is not None


def test_entity_scope_reject(_wire):
    _as(U_OWNER)
    add_watcher("entity", "approver", U_APP, entity_type="building", entity_id="E1")
    _send_for_approval("entity", entity_id="E1")
    _as(U_APP)
    r = approvals("reject", scope_type="entity", entity_id="E1", reason="bad")
    assert r.status_code == 201
    sb = app.dependency_overrides[get_supabase]()
    e = row(sb, "task_entities", task_id="T1", entity_id="E1")
    assert e["approval_state"] == "rejected"
    assert e["per_entity_status"] == "reopened"
    assert e["closed_at"] is None
    c = row(sb, "comments", task_id="T1", kind="rejection", entity_id="E1")
    assert c and c["subtask_id"] is None


def test_subtask_scope_approve(_wire):
    _as(U_OWNER)
    add_watcher("subtask", "approver", U_APP, subtask_id="S1")
    _send_for_approval("subtask", subtask_id="S1")
    _as(U_APP)
    r = approvals("approve", scope_type="subtask", subtask_id="S1")
    assert r.status_code == 201
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "subtasks", id="S1")["approval_state"] == "approved"
    c = row(sb, "comments", task_id="T1", kind="approval", subtask_id="S1")
    assert c and c["entity_id"] is None


# ════════════════════════ E. Payload enrichment ═════════════════════════════

def test_my_page_enriches_watchers_and_comment_kind(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    add_watcher("entity", "follower", U_FOL, entity_type="building", entity_id="E1")
    _send_for_approval("task")
    _as(U_APP)
    approvals("reject", reason="see notes")
    _as(U_OWNER)
    page = client.get("/api/v1/tasks/my/page").json()
    t = next(t for t in page["items"] if t["id"] == "T1")
    assert any(w["user_id"] == U_APP and w["role"] == "approver"
               for w in t["watchers"])
    assert t["latest_comment"]["kind"] == "rejection"
    ent = t["task_entities"][0]
    assert any(w["user_id"] == U_FOL for w in ent["watchers"])


def test_subtasks_grouped_enrichment(_wire):
    _as(U_OWNER)
    add_watcher("subtask", "approver", U_APP, subtask_id="S1")
    g = client.get("/api/v1/tasks/T1/subtasks-grouped").json()
    s = g["task_flat"][0]
    assert s["approval_state"] == "none"
    assert any(w["user_id"] == U_APP for w in s["watchers"])


# ═══════════════ F. Access-control hardening / regression guards ════════════

def test_status_endpoint_now_requires_authorization(_wire):
    """Bug fix: PATCH /status was unauthenticated — anyone could close a task."""
    _as(U_OUT)
    assert client.patch("/api/v1/tasks/T1/status",
                        json={"status": "done"}).status_code == 403
    assert client.patch("/api/v1/tasks/T1/status",
                        json={"status": "done", "entity_id": "E1"}).status_code == 403
    _as(U_OWNER)
    assert client.patch("/api/v1/tasks/T1/status",
                        json={"status": "done"}).status_code == 200


def test_follower_cannot_mutate_state(_wire):
    """Regression: adding watchers to _assert_task_access must not let a
    follower write subtasks/entities/status."""
    _as(U_OWNER)
    add_watcher("task", "follower", U_FOL)
    _as(U_FOL)
    assert client.patch("/api/v1/tasks/T1/subtasks/S1",
                        json={"status": "done"}).status_code == 403
    assert client.patch("/api/v1/tasks/T1/entities/E1",
                        json={"per_entity_status": "done"}).status_code == 403
    assert client.post("/api/v1/tasks/T1/subtasks",
                       json={"title": "x"}).status_code == 403
    assert client.patch("/api/v1/tasks/T1/status",
                        json={"status": "done"}).status_code == 403
    # …but a follower can still READ the tree.
    assert client.get("/api/v1/tasks/T1/subtasks-grouped").status_code == 200


def test_workspace_admin_can_manage_and_change_status(_wire):
    """Bug fix: backend now honours the workspace owner/admin affordance the
    frontend already exposes (canManageWatchers)."""
    _as(U_ADMIN)  # admin of BIZ1, not a stakeholder on T2
    assert client.post(
        "/api/v1/tasks/T2/watchers",
        json={"scope_type": "task", "role": "approver", "user_id": U_APP},
    ).status_code == 201
    assert client.patch("/api/v1/tasks/T2/status",
                        json={"status": "done"}).status_code == 200
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "tasks", id="T2")["approval_state"] == "pending"


def test_reject_reason_whitespace_only_is_rejected(_wire):
    _as(U_OWNER)
    add_watcher("task", "approver", U_APP)
    _send_for_approval("task")
    _as(U_APP)
    assert approvals("reject", reason="   ").status_code == 422
    sb = app.dependency_overrides[get_supabase]()
    assert row(sb, "tasks", id="T1")["approval_state"] == "pending"
