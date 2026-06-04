"""'My day' personal-cockpit tests (Slice 1 of the Programs build plan).

Runs the real endpoint against the in-memory FakeSupabase (same harness as
test_daily_brief) so scoping + access rules are exercised for real. The whole
point of this slice is that every list is strictly the CALLING user's own and
never leaks another member's or another tenant's rows — so the bulk of these
tests are the §9 loophole matrix, not happy paths.

Journeys covered: member, admin, founder/owner. Loopholes: member A vs member
B, cross-tenant tasks, non-member 403, another user's checklist/delegation.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

# Two workspaces, three people. ME is the caller in most tests.
ME = "user-me"
OTHER = "user-other"      # another member of the same workspace
ADMIN = "user-admin"
BIZ1 = "biz-1"
BIZ2 = "biz-2"            # a different tenant ME does NOT belong to


def _as(uid: str):
    """Switch the authenticated caller."""
    app.dependency_overrides[get_current_user] = lambda: {
        "id": uid, "email": f"{uid}@example.com", "role": "authenticated"}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "business_members": [
            {"business_id": BIZ1, "user_id": ME, "role": "member"},
            {"business_id": BIZ1, "user_id": OTHER, "role": "member"},
            {"business_id": BIZ1, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ2, "user_id": OTHER, "role": "owner"},
        ],
        "businesses": [{"id": BIZ1, "name": "Biz One"}, {"id": BIZ2, "name": "Biz Two"}],
        "initiatives": [
            {"id": "INIT1", "business_id": BIZ1, "name": "Init One", "program_id": None},
            {"id": "INIT2", "business_id": BIZ2, "name": "Init Two (other tenant)", "program_id": None},
        ],
        "tasks": [],
        "task_stakeholders": [],
        "item_watchers": [],
        "notebook_assignments": [],
        "notebook_checklist_items": [],
        "users": [
            {"id": ME, "name": "Me"},
            {"id": OTHER, "name": "Other"},
            {"id": ADMIN, "name": "Admin"},
        ],
    })
    _as(ME)
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def _task(tid, *, init="INIT1", primary=ME, status="in_progress",
          due=None, approval="none", priority="medium", title=None):
    return {
        "id": tid, "title": title or tid, "status": status, "priority": priority,
        "due_date": due, "initiative_id": init, "primary_stakeholder_id": primary,
        "approval_state": approval, "created_at": "2026-05-01T00:00:00+00:00",
        "updated_at": "2026-05-01T00:00:00+00:00",
    }


# ── access ──────────────────────────────────────────────────────────────

def test_business_id_required(sb):
    """Endpoint is workspace-scoped; without business_id it's a 422."""
    assert client.get("/api/v1/my-day").status_code == 422


def test_non_member_forbidden(sb):
    """ME is not a member of BIZ2 -> 403 (loophole: cross-tenant access)."""
    r = client.get(f"/api/v1/my-day?business_id={BIZ2}")
    assert r.status_code == 403, r.text


def test_empty_when_nothing_assigned(sb):
    r = client.get(f"/api/v1/my-day?business_id={BIZ1}")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["user_id"] == ME
    assert b["business_id"] == BIZ1
    assert b["tasks"] == b["approvals"] == b["delegations"] == b["checklist"] == []
    assert b["counts"]["tasks"] == 0


# ── 1. tasks ────────────────────────────────────────────────────────────

def test_member_sees_own_primary_and_stakeholder_tasks(sb):
    sb.store["tasks"] = [
        _task("T-PRIMARY", primary=ME),
        _task("T-STAKE", primary=OTHER),       # ME is a secondary stakeholder
        _task("T-NOTMINE", primary=OTHER),     # not ME's at all
    ]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-PRIMARY", "user_id": ME, "role": "primary"},
        {"task_id": "T-STAKE", "user_id": ME, "role": "secondary"},
        {"task_id": "T-NOTMINE", "user_id": OTHER, "role": "primary"},
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    ids = {t["id"] for t in b["tasks"]}
    assert ids == {"T-PRIMARY", "T-STAKE"}
    assert all(t["initiative_name"] == "Init One" for t in b["tasks"])


def test_closed_tasks_excluded(sb):
    sb.store["tasks"] = [
        _task("T-OPEN", primary=ME, status="in_progress"),
        _task("T-DONE", primary=ME, status="done"),
        _task("T-ARCH", primary=ME, status="archived"),
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert {t["id"] for t in b["tasks"]} == {"T-OPEN"}


def test_overdue_flag_and_ordering(sb):
    sb.store["tasks"] = [
        _task("T-FUTURE", primary=ME, due="2099-01-01"),
        _task("T-OVERDUE", primary=ME, due="2000-01-01"),
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    # Overdue surfaces first.
    assert b["tasks"][0]["id"] == "T-OVERDUE"
    assert b["tasks"][0]["overdue"] is True
    assert b["tasks"][1]["overdue"] is False
    assert b["counts"]["overdue_tasks"] == 1


def test_cross_tenant_task_excluded(sb):
    """LOOPHOLE: a task whose initiative is in BIZ2 must never appear in ME's
    BIZ1 my-day, even though ME is its primary stakeholder."""
    sb.store["tasks"] = [
        _task("T-BIZ1", primary=ME, init="INIT1"),
        _task("T-BIZ2", primary=ME, init="INIT2"),   # other tenant
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert {t["id"] for t in b["tasks"]} == {"T-BIZ1"}


def test_unanchored_task_excluded(sb):
    """A task with NULL initiative_id has no workspace anchor -> dropped."""
    sb.store["tasks"] = [_task("T-FLOAT", primary=ME, init=None)]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["tasks"] == []


def test_member_a_cannot_see_member_b_tasks(sb):
    """LOOPHOLE: ME must not see OTHER's task via my-day."""
    sb.store["tasks"] = [_task("T-OTHER", primary=OTHER, init="INIT1")]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-OTHER", "user_id": OTHER, "role": "primary"}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["tasks"] == []


# ── 2. approvals ────────────────────────────────────────────────────────

def test_approvals_only_when_pending_and_approver(sb):
    sb.store["tasks"] = [
        _task("T-PENDING", primary=OTHER, approval="pending"),
        _task("T-APPROVED", primary=OTHER, approval="approved"),
    ]
    sb.store["item_watchers"] = [
        {"id": "w1", "task_id": "T-PENDING", "scope_type": "task",
         "subtask_id": None, "entity_id": None, "entity_type": None,
         "user_id": ME, "role": "approver"},
        {"id": "w2", "task_id": "T-APPROVED", "scope_type": "task",
         "subtask_id": None, "entity_id": None, "entity_type": None,
         "user_id": ME, "role": "approver"},
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert {t["id"] for t in b["approvals"]} == {"T-PENDING"}


def test_follower_role_does_not_grant_approval(sb):
    """LOOPHOLE: a follower (not approver) watcher must not surface in
    approvals even on a pending task."""
    sb.store["tasks"] = [_task("T-PENDING", primary=OTHER, approval="pending")]
    sb.store["item_watchers"] = [
        {"id": "w1", "task_id": "T-PENDING", "scope_type": "task",
         "subtask_id": None, "entity_id": None, "entity_type": None,
         "user_id": ME, "role": "follower"}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["approvals"] == []


def test_cross_tenant_approval_excluded(sb):
    """LOOPHOLE: a pending approval on a BIZ2 task never shows in BIZ1."""
    sb.store["tasks"] = [_task("T-BIZ2", primary=OTHER, init="INIT2", approval="pending")]
    sb.store["item_watchers"] = [
        {"id": "w1", "task_id": "T-BIZ2", "scope_type": "task",
         "subtask_id": None, "entity_id": None, "entity_type": None,
         "user_id": ME, "role": "approver"}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["approvals"] == []


# ── 3. delegations ──────────────────────────────────────────────────────

def test_delegations_pending_to_me_only(sb):
    sb.store["notebook_assignments"] = [
        {"id": "a1", "recipient_id": ME, "sender_id": OTHER, "content": "Do X",
         "status": "pending", "source_page_id": None,
         "created_at": "2026-05-02T00:00:00+00:00"},
        {"id": "a2", "recipient_id": ME, "sender_id": OTHER, "content": "Done already",
         "status": "accepted", "source_page_id": None,
         "created_at": "2026-05-02T00:00:00+00:00"},
        {"id": "a3", "recipient_id": OTHER, "sender_id": ME, "content": "Not mine",
         "status": "pending", "source_page_id": None,
         "created_at": "2026-05-02T00:00:00+00:00"},
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert {d["id"] for d in b["delegations"]} == {"a1"}     # pending + to ME only
    assert b["delegations"][0]["sender_name"] == "Other"


def test_another_users_delegation_never_returned(sb):
    """LOOPHOLE: a delegation addressed to OTHER must never appear in ME's."""
    sb.store["notebook_assignments"] = [
        {"id": "a3", "recipient_id": OTHER, "sender_id": ME, "content": "Secret",
         "status": "pending", "source_page_id": None,
         "created_at": "2026-05-02T00:00:00+00:00"}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["delegations"] == []


# ── 4. checklist ────────────────────────────────────────────────────────

def test_checklist_soon_and_undated_only(sb):
    sb.store["notebook_checklist_items"] = [
        {"id": "c-overdue", "owner_id": ME, "content": "overdue", "status": "open",
         "due_date": "2000-01-01", "source_page_id": None},
        {"id": "c-undated", "owner_id": ME, "content": "someday", "status": "open",
         "due_date": None, "source_page_id": None},
        {"id": "c-far", "owner_id": ME, "content": "next year", "status": "open",
         "due_date": "2099-01-01", "source_page_id": None},
        {"id": "c-done", "owner_id": ME, "content": "finished", "status": "done",
         "due_date": "2000-01-01", "source_page_id": None},
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    ids = [c["id"] for c in b["checklist"]]
    # Far-future + done excluded; overdue (dated) sorts before undated.
    assert ids == ["c-overdue", "c-undated"]
    assert b["checklist"][0]["overdue"] is True


def test_another_users_checklist_never_returned(sb):
    """LOOPHOLE: OTHER's checklist item must never appear in ME's my-day."""
    sb.store["notebook_checklist_items"] = [
        {"id": "c-other", "owner_id": OTHER, "content": "not mine", "status": "open",
         "due_date": None, "source_page_id": None}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert b["checklist"] == []


# ── journeys: admin & founder get their OWN my-day ──────────────────────

def test_admin_journey_sees_only_own_items(sb):
    """An admin's my-day is personal: their own task, NOT a member's private
    delegation/checklist."""
    _as(ADMIN)
    sb.store["tasks"] = [
        _task("T-ADMIN", primary=ADMIN, init="INIT1"),
        _task("T-MEMBER", primary=ME, init="INIT1"),
    ]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-ADMIN", "user_id": ADMIN, "role": "primary"},
        {"task_id": "T-MEMBER", "user_id": ME, "role": "primary"},
    ]
    sb.store["notebook_assignments"] = [
        {"id": "a-me", "recipient_id": ME, "sender_id": OTHER, "content": "member-private",
         "status": "pending", "source_page_id": None,
         "created_at": "2026-05-02T00:00:00+00:00"}]
    sb.store["notebook_checklist_items"] = [
        {"id": "c-me", "owner_id": ME, "content": "member-private", "status": "open",
         "due_date": None, "source_page_id": None}]
    b = client.get(f"/api/v1/my-day?business_id={BIZ1}").json()
    assert {t["id"] for t in b["tasks"]} == {"T-ADMIN"}
    assert b["delegations"] == []          # does NOT see member's delegation
    assert b["checklist"] == []            # does NOT see member's checklist


def test_founder_journey_sees_own_items(sb):
    """Owner/founder of BIZ2 (OTHER) gets their own my-day in their own
    workspace — and ME's BIZ1 rows never bleed in."""
    _as(OTHER)
    sb.store["tasks"] = [
        _task("T-FOUNDER", primary=OTHER, init="INIT2"),
        _task("T-ME-BIZ1", primary=ME, init="INIT1"),
    ]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-FOUNDER", "user_id": OTHER, "role": "primary"},
        {"task_id": "T-ME-BIZ1", "user_id": ME, "role": "primary"},
    ]
    b = client.get(f"/api/v1/my-day?business_id={BIZ2}").json()
    assert {t["id"] for t in b["tasks"]} == {"T-FOUNDER"}
