"""Daily brief tests.

Uses the in-memory FakeSupabase (same harness as test_onboarding /
test_businesses) so the real endpoint logic runs. The old MagicMock
chain didn't model `in_()` / embeds / `task_stakeholders` and broke
when the route was parallelised. Route is mounted slash-less
(`/api/v1/daily-brief`) — with redirect_slashes=False the trailing-slash
form 404s.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)
UID = "user-123"


@pytest.fixture
def sb():
    s = FakeSupabase({
        "business_members": [],
        "businesses": [],
        "initiatives": [],
        "programs": [],
        "tasks": [],
        "task_stakeholders": [],
        "task_entities": [],
        "subtasks": [],
        "buildings": [],
        "clients": [],
    })
    app.dependency_overrides[get_current_user] = lambda: {
        "id": UID, "email": "test@example.com", "role": "authenticated"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_daily_brief_empty(sb):
    """All queries return empty -> empty buckets, not error."""
    r = client.get("/api/v1/daily-brief")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == UID
    assert body["pending_decisions"] == []
    assert body["overdue_tasks"] == []
    assert body["stale_tasks"] == []
    assert body["due_this_week"] == []
    assert body["blocked_tasks"] == []
    assert body["awaiting_approval"] == []
    assert body["initiative_progress"] == []
    assert body["quick_stats"]["open_tasks"] == 0
    # Hero pick + people rollup are part of the new contract — empty here.
    assert body["top_pick"] is None
    assert body["people_rollup"] == []


def _seed_overdue_tasks(sb):
    """Two overdue tasks under the same initiative, different priorities, so
    we can assert sort + hero pick deterministically."""
    sb.store["business_members"] = [
        {"business_id": "BIZ1", "user_id": UID, "role": "owner"},
    ]
    sb.store["businesses"] = [{"id": "BIZ1", "name": "Biz"}]
    sb.store["initiatives"] = [
        {"id": "INIT1", "business_id": "BIZ1", "name": "Init", "status": "active",
         "primary_stakeholder_id": UID, "program_id": None},
    ]
    sb.store["users"] = [
        {"id": UID, "name": "Owner", "email": "o@x.io"},
        {"id": "u-2", "name": "Other", "email": "o2@x.io"},
    ]
    # T-LOW: medium priority, 1 day overdue.
    # T-URG: urgent priority, 1 day overdue. Should rank higher.
    sb.store["tasks"] = [
        {"id": "T-LOW", "title": "Low one", "status": "in_progress",
         "priority": "medium", "due_date": "2026-05-20",
         "initiative_id": "INIT1", "primary_stakeholder_id": UID,
         "approval_state": "none", "closed_at": None,
         "created_at": "2026-05-01T00:00:00+00:00",
         "updated_at": "2026-05-20T00:00:00+00:00"},
        {"id": "T-URG", "title": "Urgent one", "status": "in_progress",
         "priority": "urgent", "due_date": "2026-05-20",
         "initiative_id": "INIT1", "primary_stakeholder_id": UID,
         "approval_state": "none", "closed_at": None,
         "created_at": "2026-05-02T00:00:00+00:00",
         "updated_at": "2026-05-20T00:00:00+00:00"},
    ]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-LOW", "user_id": UID, "role": "primary"},
        {"task_id": "T-URG", "user_id": UID, "role": "primary"},
    ]


def test_buckets_sorted_by_severity(sb):
    _seed_overdue_tasks(sb)
    r = client.get("/api/v1/daily-brief")
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [t["id"] for t in body["overdue_tasks"]]
    # Urgent ranks above medium, so T-URG must come first.
    assert ids[0] == "T-URG"
    assert ids[1] == "T-LOW"


def test_top_pick_uses_severity(sb):
    _seed_overdue_tasks(sb)
    body = client.get("/api/v1/daily-brief").json()
    pick = body["top_pick"]
    assert pick is not None
    assert pick["task_id"] == "T-URG"
    assert pick["reason"] == "overdue"


def test_people_rollup_team_scope(sb):
    _seed_overdue_tasks(sb)
    # Add a second member with their own overdue.
    sb.store["business_members"].append(
        {"business_id": "BIZ1", "user_id": "u-2", "role": "member"})
    sb.store["tasks"].append({
        "id": "T-OTHER", "title": "Other person", "status": "in_progress",
        "priority": "medium", "due_date": "2026-05-21",
        "initiative_id": "INIT1", "primary_stakeholder_id": "u-2",
        "approval_state": "none", "closed_at": None,
        "created_at": "2026-05-03T00:00:00+00:00",
        "updated_at": "2026-05-20T00:00:00+00:00",
    })
    body = client.get("/api/v1/daily-brief?scope=team").json()
    rollup = body["people_rollup"]
    assert len(rollup) == 2
    by_uid = {r["user_id"]: r for r in rollup}
    assert by_uid[UID]["overdue"] == 2
    assert by_uid["u-2"]["overdue"] == 1
    # Sort puts the heavier overdue load first.
    assert rollup[0]["user_id"] == UID


def test_people_rollup_empty_in_mine_scope(sb):
    _seed_overdue_tasks(sb)
    body = client.get("/api/v1/daily-brief").json()
    assert body["people_rollup"] == []


def test_workspace_lists_full_regardless_of_buckets(sb):
    """workspace_programs / workspace_members include every program + member
    in the user's businesses, even when those don't appear in any bucket
    yet — the filter dropdowns rely on this."""
    sb.store["business_members"] = [
        {"business_id": "BIZ1", "user_id": UID, "role": "owner"},
        {"business_id": "BIZ1", "user_id": "u-other", "role": "member"},
    ]
    sb.store["businesses"] = [{"id": "BIZ1", "name": "Biz"}]
    sb.store["users"] = [
        {"id": UID, "name": "Owner", "email": "o@x.io"},
        {"id": "u-other", "name": "Other", "email": "x@x.io"},
    ]
    sb.store["programs"] = [
        {"id": "PROG-A", "business_id": "BIZ1", "name": "Empty Program"},
        {"id": "PROG-B", "business_id": "BIZ1", "name": "Other Program"},
    ]
    body = client.get("/api/v1/daily-brief").json()
    prog_names = [p["name"] for p in body["workspace_programs"]]
    assert set(prog_names) == {"Empty Program", "Other Program"}
    member_uids = {m["user_id"] for m in body["workspace_members"]}
    assert {UID, "u-other"} <= member_uids


def test_dormant_initiatives_no_tasks(sb):
    """Active initiatives with zero tasks surface as dormant with reason
    no_tasks — the rest of the brief otherwise hides them."""
    sb.store["business_members"] = [
        {"business_id": "BIZ1", "user_id": UID, "role": "owner"},
    ]
    sb.store["businesses"] = [{"id": "BIZ1", "name": "Biz"}]
    sb.store["initiatives"] = [
        {"id": "INIT-EMPTY", "business_id": "BIZ1", "name": "Untouched",
         "status": "active", "program_id": None},
    ]
    body = client.get("/api/v1/daily-brief").json()
    assert len(body["dormant_initiatives"]) == 1
    d = body["dormant_initiatives"][0]
    assert d["id"] == "INIT-EMPTY"
    assert d["reason"] == "no_tasks"
    assert d["last_update"] is None


def test_dormant_initiatives_stale(sb):
    """Active initiatives whose most-recent task was updated 14+ days ago
    surface with reason=stale + the last_update date."""
    sb.store["business_members"] = [
        {"business_id": "BIZ1", "user_id": UID, "role": "owner"},
    ]
    sb.store["businesses"] = [{"id": "BIZ1", "name": "Biz"}]
    sb.store["initiatives"] = [
        {"id": "INIT-STALE", "business_id": "BIZ1", "name": "Stale",
         "status": "active", "program_id": None,
         "primary_stakeholder_id": UID},
    ]
    sb.store["users"] = [{"id": UID, "name": "Owner", "email": "o@x.io"}]
    sb.store["tasks"] = [{
        "id": "T-OLD", "title": "Old", "status": "in_progress",
        "priority": "medium", "due_date": None,
        "initiative_id": "INIT-STALE", "primary_stakeholder_id": UID,
        "approval_state": "none", "closed_at": None,
        "created_at": "2020-01-01T00:00:00+00:00",
        # 30 days before today's test runtime; well past the 14d window.
        "updated_at": "2020-01-01T00:00:00+00:00",
    }]
    sb.store["task_stakeholders"] = [
        {"task_id": "T-OLD", "user_id": UID, "role": "primary"},
    ]
    body = client.get("/api/v1/daily-brief").json()
    dormant = body["dormant_initiatives"]
    assert any(d["id"] == "INIT-STALE" and d["reason"] == "stale" for d in dormant)


def test_pending_approver_ids_projected(sb):
    """The FE uses pending_approver_ids to decide whether to render inline
    Approve/Reject — make sure the field comes back."""
    _seed_overdue_tasks(sb)
    sb.store["tasks"][1]["approval_state"] = "pending"
    sb.store["item_watchers"] = [{
        "id": "w-1", "task_id": "T-URG", "scope_type": "task",
        "subtask_id": None, "entity_id": None, "entity_type": None,
        "user_id": UID, "role": "approver",
    }]
    body = client.get("/api/v1/daily-brief").json()
    pending = body["awaiting_approval"]
    assert len(pending) == 1
    assert pending[0]["pending_approver_ids"] == [UID]
