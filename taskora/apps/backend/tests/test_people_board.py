"""Tests for the People board (gallery + focus) and its access model.

Covers: the owns-work roster filter, load-counter correctness, push-score
ordering, focus Program>Initiative grouping, Kanban column derivation incl.
approval-is-orthogonal-to-status, the owner/admin-or-grant access gate, and
the member-permission PATCH endpoint — on the constraint-enforcing fake.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "u-owner"   # workspace owner
MGR = "u-mgr"       # admin
ALICE = "u-alice"   # member, owns lots of work (the person to chase)
BOB = "u-bob"       # member, owns nothing, no grant
CAROL = "u-carol"   # member, owns nothing, but granted board access
_CUR = {"u": OWNER}

TODAY = date.today()
OVERDUE = (TODAY - timedelta(days=10)).isoformat()
LONG_AGO = (TODAY - timedelta(days=20)).isoformat()
SOON = (TODAY + timedelta(days=2)).isoformat()
NOW = TODAY.isoformat()


def _seed():
    return {
        "users": [
            {"id": OWNER, "name": "Olivia Owner", "email": "o@x.io", "avatar_url": None},
            {"id": MGR, "name": "Maya Mgr", "email": "m@x.io", "avatar_url": None},
            {"id": ALICE, "name": "Alice Ace", "email": "a@x.io", "avatar_url": "http://a"},
            {"id": BOB, "name": "Bob Idle", "email": "b@x.io", "avatar_url": None},
            {"id": CAROL, "name": "Carol Cleared", "email": "c@x.io", "avatar_url": None},
        ],
        "businesses": [{"id": "BIZ", "name": "Acme", "type": "building"}],
        "business_members": [
            {"business_id": "BIZ", "user_id": OWNER, "role": "owner"},
            {"business_id": "BIZ", "user_id": MGR, "role": "admin"},
            {"business_id": "BIZ", "user_id": ALICE, "role": "member"},
            {"business_id": "BIZ", "user_id": BOB, "role": "member"},
            {"business_id": "BIZ", "user_id": CAROL, "role": "member",
             "can_view_people_board": True},
        ],
        "programs": [{"id": "PROG", "name": "Cost Cutting"}],
        "initiatives": [
            {"id": "INI", "name": "Energy", "business_id": "BIZ",
             "program_id": "PROG", "owner_id": ALICE,
             "primary_stakeholder_id": ALICE, "status": "active"},
            {"id": "INI2", "name": "Vendors", "business_id": "BIZ",
             "program_id": "PROG", "owner_id": OWNER,
             "primary_stakeholder_id": OWNER, "status": "active"},
        ],
        "tasks": [
            {"id": "T1", "title": "Meters", "status": "in_progress",
             "due_date": OVERDUE, "initiative_id": "INI",
             "primary_stakeholder_id": ALICE, "approval_state": "none",
             "updated_at": LONG_AGO, "created_at": LONG_AGO},
            {"id": "T2", "title": "Vendor PO", "status": "blocked",
             "due_date": SOON, "initiative_id": "INI",
             "primary_stakeholder_id": ALICE, "approval_state": "none",
             "updated_at": LONG_AGO, "created_at": LONG_AGO},
            {"id": "T3", "title": "Pick HVAC", "status": "pending_decision",
             "due_date": SOON, "initiative_id": "INI",
             "primary_stakeholder_id": ALICE, "approval_state": "none",
             "updated_at": NOW, "created_at": NOW},
            {"id": "T4", "title": "Closeout", "status": "done",
             "due_date": None, "initiative_id": "INI",
             "primary_stakeholder_id": ALICE, "approval_state": "pending",
             "updated_at": NOW, "created_at": LONG_AGO},
            {"id": "T5", "title": "Contract", "status": "in_progress",
             "due_date": SOON, "initiative_id": "INI2",
             "primary_stakeholder_id": OWNER, "approval_state": "none",
             "updated_at": NOW, "created_at": NOW},
            {"id": "T6", "title": "Sign-off", "status": "in_progress",
             "due_date": SOON, "initiative_id": "INI2",
             "primary_stakeholder_id": OWNER, "approval_state": "pending",
             "updated_at": NOW, "created_at": NOW},
        ],
        "task_stakeholders": [
            {"task_id": "T5", "user_id": ALICE, "role": "contributor"},
        ],
        "task_entities": [],
        "subtasks": [],
        "comments": [],
        "item_watchers": [
            {"id": "W1", "task_id": "T6", "user_id": ALICE, "role": "approver",
             "scope_type": "task", "subtask_id": None, "entity_id": None},
        ],
    }


@pytest.fixture
def sb():
    s = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: {
        "id": _CUR["u"], "email": f"{_CUR['u']}@x.io"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


# ── Gallery ──────────────────────────────────────────────────────────────────

def test_roster_is_only_people_who_own_work(sb):
    _CUR["u"] = OWNER
    b = client.get("/api/v1/people/board").json()
    ids = {p["user_id"] for p in b["people"]}
    # Alice owns tasks + leads INI; Owner owns tasks + leads INI2.
    assert ids == {ALICE, OWNER}
    # MGR/BOB/CAROL own nothing and lead nothing → excluded.
    assert BOB not in ids and MGR not in ids and CAROL not in ids
    assert b["totals"]["people"] == 2


def test_counts_and_push_score_ordering(sb):
    _CUR["u"] = MGR  # admin can view
    b = client.get("/api/v1/people/board").json()
    alice = next(p for p in b["people"] if p["user_id"] == ALICE)
    assert alice["counts"] == {
        "open": 3, "overdue": 1, "blocked": 1, "due_this_week": 2,
        "pending_decision": 1, "stale": 2, "awaiting_their_approval": 1,
    }
    assert alice["name"] == "Alice Ace" and alice["avatar_url"] == "http://a"
    assert alice["initiatives_led"] == 1 and alice["programs_touched"] == 1
    # push = 1*3 + 1*2 + 1*2 + 1*2 + 2 = 11
    assert alice["push_score"] == 11
    # Worst-first: Alice (11) ahead of Owner.
    assert b["people"][0]["user_id"] == ALICE
    assert b["people"][0]["push_score"] >= b["people"][1]["push_score"]


# ── Focus ────────────────────────────────────────────────────────────────────

def test_focus_groups_program_initiative_and_roles(sb):
    _CUR["u"] = OWNER
    f = client.get(f"/api/v1/people/board/{ALICE}").json()
    assert f["person"]["name"] == "Alice Ace"
    assert [c["key"] for c in f["columns"]][0] == "todo"
    # One program (Cost Cutting), two initiatives (Energy, Vendors).
    assert len(f["programs"]) == 1
    prog = f["programs"][0]
    assert prog["program_name"] == "Cost Cutting"
    inits = {i["name"]: i for i in prog["initiatives"]}
    assert set(inits) == {"Energy", "Vendors"}
    # Alice owns Energy; only contributes/approves in Vendors.
    assert inits["Energy"]["role_of_person"] == "owner"
    assert inits["Vendors"]["role_of_person"] == "contributor"
    roles = {t["id"]: t["role_of_person"]
             for i in prog["initiatives"] for t in i["tasks"]}
    assert roles["T1"] == "primary"
    assert roles["T5"] == "contributor"
    assert roles["T6"] == "approver"


def test_focus_column_mapping_approval_is_orthogonal(sb):
    _CUR["u"] = OWNER
    f = client.get(f"/api/v1/people/board/{ALICE}").json()
    col = {t["id"]: t["column"]
           for p in f["programs"] for i in p["initiatives"] for t in i["tasks"]}
    assert col["T1"] == "in_progress"
    assert col["T2"] == "blocked"
    assert col["T3"] == "needs_decision"
    # T4 is status=done but approval_state=pending → Approval column, not Done.
    assert col["T4"] == "awaiting_approval"
    assert col["T6"] == "awaiting_approval"
    assert f["counts"]["awaiting_their_approval"] == 1


def test_focus_unknown_user_404(sb):
    _CUR["u"] = OWNER
    assert client.get("/api/v1/people/board/u-nope").status_code == 404


# ── Access control ───────────────────────────────────────────────────────────

def test_access_owner_admin_and_grant(sb):
    _CUR["u"] = OWNER
    assert client.get("/api/v1/people/board").status_code == 200
    _CUR["u"] = MGR
    assert client.get("/api/v1/people/board").status_code == 200
    _CUR["u"] = CAROL  # member but granted
    assert client.get("/api/v1/people/board").status_code == 200
    _CUR["u"] = BOB    # member, no grant
    assert client.get("/api/v1/people/board").status_code == 403
    assert client.get(f"/api/v1/people/board/{ALICE}").status_code == 403


# ── Permission PATCH ─────────────────────────────────────────────────────────

def test_permission_patch_gating_and_effect(sb):
    # A plain member cannot grant.
    _CUR["u"] = BOB
    r = client.patch(f"/api/v1/businesses/BIZ/members/{BOB}/permissions",
                      json={"can_view_people_board": True})
    assert r.status_code == 403

    # Owner grants Bob access.
    _CUR["u"] = OWNER
    r = client.patch(f"/api/v1/businesses/BIZ/members/{BOB}/permissions",
                      json={"can_view_people_board": True})
    assert r.status_code == 200

    members = client.get("/api/v1/businesses/BIZ/members").json()
    bob = next(m for m in members if m["user_id"] == BOB)
    assert bob["can_view_people_board"] is True

    # Bob can now see the board.
    _CUR["u"] = BOB
    assert client.get("/api/v1/people/board").status_code == 200

    # Unknown member → 404.
    _CUR["u"] = OWNER
    assert client.patch("/api/v1/businesses/BIZ/members/u-nope/permissions",
                         json={"can_view_people_board": True}).status_code == 404
