"""Regression tests for the production bug-hunt findings (2026-05-16).

Found live against prod:
  * POST /api/v1/tasks had NO authorization — any authenticated user could
    create a task under any initiative_id (cross-tenant IDOR), and bad/absent
    ids 500'd on FK / NOT NULL violations.
  * PATCH /api/v1/programs/{id} did not validate `name` (create did).

These lock in the fixes using the in-memory fake that enforces real
constraints.
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

MEMBER = "user-member"
OTHER = "user-outsider"
MATE = "user-teammate"
_CUR = {"u": MEMBER}


@pytest.fixture
def sb():
    store = {
        "users": [
            {"id": MEMBER, "name": "Member", "email": "m@x.io"},
            {"id": OTHER, "name": "Outsider", "email": "o@x.io"},
            {"id": MATE, "name": "Teammate", "email": "t@x.io"},
        ],
        "businesses": [{"id": "BIZ1", "name": "Acme", "type": "building"}],
        "business_members": [
            {"business_id": "BIZ1", "user_id": MEMBER, "role": "owner"},
            {"business_id": "BIZ1", "user_id": MATE, "role": "member"},
        ],
        "programs": [{
            "id": "P1", "business_id": "BIZ1", "name": "Cost",
            "description": None, "status": "active", "color": "#3B82F6",
            "lead_user_id": MEMBER, "created_at": "2026-05-01T00:00:00+00:00",
        }],
        "initiatives": [{"id": "INIT1", "business_id": "BIZ1", "name": "I1"}],
        "tasks": [], "task_stakeholders": [], "task_entities": [],
    }
    s = FakeSupabase(store)
    app.dependency_overrides[get_current_user] = lambda: {
        "id": _CUR["u"], "email": f"{_CUR['u']}@x.io"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = MEMBER


# ── POST /tasks authorization ────────────────────────────────────────────────

def test_member_can_create_task(sb):
    _CUR["u"] = MEMBER
    r = client.post("/api/v1/tasks/", json={
        "title": "Audit", "initiative_id": "INIT1",
        "primary_stakeholder_id": MEMBER})
    assert r.status_code == 201, r.text
    assert len(sb.store["tasks"]) == 1
    assert sb.store["task_stakeholders"][0]["user_id"] == MEMBER


def test_non_member_cannot_create_task_cross_tenant(sb):
    """The IDOR: outsider must NOT create a task under another tenant's
    initiative."""
    _CUR["u"] = OTHER
    r = client.post("/api/v1/tasks/", json={
        "title": "Sneaky", "initiative_id": "INIT1",
        "primary_stakeholder_id": OTHER})
    assert r.status_code == 403, r.text
    assert sb.store["tasks"] == []


def test_missing_initiative_id_is_422_not_500(sb):
    _CUR["u"] = MEMBER
    r = client.post("/api/v1/tasks/", json={
        "title": "No init", "primary_stakeholder_id": MEMBER})
    assert r.status_code == 422, r.text
    assert sb.store["tasks"] == []


def test_unknown_initiative_id_is_404_not_500(sb):
    _CUR["u"] = MEMBER
    r = client.post("/api/v1/tasks/", json={
        "title": "Ghost init",
        "initiative_id": "00000000-0000-0000-0000-000000000000",
        "primary_stakeholder_id": MEMBER})
    assert r.status_code == 404, r.text


def test_ghost_primary_stakeholder_is_400_not_500(sb):
    """Was a raw FK 500; now a clean 400 (not a workspace member)."""
    _CUR["u"] = MEMBER
    r = client.post("/api/v1/tasks/", json={
        "title": "Ghost SH", "initiative_id": "INIT1",
        "primary_stakeholder_id": "00000000-0000-0000-0000-000000000000"})
    assert r.status_code == 400, r.text
    assert sb.store["tasks"] == []


def test_can_assign_task_to_a_teammate(sb):
    """Assigning to another *member* of the same workspace still works."""
    _CUR["u"] = MEMBER
    r = client.post("/api/v1/tasks/", json={
        "title": "Delegate", "initiative_id": "INIT1",
        "primary_stakeholder_id": MATE})
    assert r.status_code == 201, r.text


# ── PATCH /programs name validation ──────────────────────────────────────────

def test_patch_program_blank_name_rejected(sb):
    _CUR["u"] = MEMBER
    r = client.patch("/api/v1/programs/P1", json={"name": "   "})
    assert r.status_code == 422, r.text


def test_patch_program_overlong_name_rejected(sb):
    _CUR["u"] = MEMBER
    r = client.patch("/api/v1/programs/P1", json={"name": "X" * 101})
    assert r.status_code == 422, r.text


def test_patch_program_valid_name_ok(sb):
    _CUR["u"] = MEMBER
    r = client.patch("/api/v1/programs/P1", json={"name": "Cost v2"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Cost v2"
