"""Tests for the strengthened initiative edit endpoint + program dashboard.

Covers the two product invariants added in this PR:
  1. Only workspace owner/admin can PATCH an initiative.
  2. Every changed field writes one activity_log row with old/new values.

Also exercises the new /programs/{id}/rollup and /programs/{id}/gantt endpoints.
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
U_PRIMARY = "u-primary"
U_MEMBER = "u-member"
U_OUTSIDER = "u-outsider"

_CURRENT = {"u": U_ADMIN}


def _as(uid):
    _CURRENT["u"] = uid


def _seed():
    return {
        "users": [
            {"id": U_ADMIN,    "name": "Admin",    "email": f"{U_ADMIN}@x.io"},
            {"id": U_PRIMARY,  "name": "Primary",  "email": f"{U_PRIMARY}@x.io"},
            {"id": U_MEMBER,   "name": "Member",   "email": f"{U_MEMBER}@x.io"},
            {"id": U_OUTSIDER, "name": "Outsider", "email": f"{U_OUTSIDER}@x.io"},
        ],
        "business_members": [
            {"business_id": "BIZ1", "user_id": U_ADMIN,   "role": "admin"},
            {"business_id": "BIZ1", "user_id": U_PRIMARY, "role": "member"},
            {"business_id": "BIZ1", "user_id": U_MEMBER,  "role": "member"},
        ],
        "programs": [{
            "id": "P1", "business_id": "BIZ1", "name": "Solar Bidding 2026",
            "description": "Win tenders", "color": "#3B82F6", "status": "active",
            "lead_user_id": U_ADMIN, "objective": "Win 5 GeM solar tenders.",
            "start_date": "2026-03-01", "target_end_date": "2026-09-30",
            "manual_health": None,
            "created_at": "2026-03-01T00:00:00+00:00",
        }],
        "initiatives": [{
            "id": "INIT1", "business_id": "BIZ1", "program_id": "P1",
            "name": "Win 3 GeM tenders", "description": "Q2 push",
            "status": "in_progress",
            "start_date": "2026-04-01", "target_end_date": "2026-06-30",
            "date_mode": "uniform",
            "owner_id": U_PRIMARY, "primary_stakeholder_id": U_PRIMARY,
            "impact": None, "impact_metric": None, "impact_category": "cost",
            "theme_id": None,
            "created_at": "2026-04-01T00:00:00+00:00",
        }],
        "tasks": [],
        "activity_log": [],
    }


@pytest.fixture
def fake():
    store = _seed()
    f = FakeSupabase(store)
    app.dependency_overrides[get_current_user] = lambda: (
        {"id": _CURRENT["u"], "email": f"{_CURRENT['u']}@x.io"}
    )
    app.dependency_overrides[get_supabase] = lambda: f
    yield f
    app.dependency_overrides.clear()
    _CURRENT["u"] = U_ADMIN


# ── Edit gate ─────────────────────────────────────────────────────────────────

def test_admin_can_edit_initiative(fake):
    _as(U_ADMIN)
    r = client.patch("/api/v1/initiatives/INIT1", json={"name": "Renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renamed"


def test_member_cannot_edit_initiative(fake):
    _as(U_MEMBER)
    r = client.patch("/api/v1/initiatives/INIT1", json={"name": "Sneaky"})
    assert r.status_code == 403


def test_primary_stakeholder_cannot_edit_from_program_section(fake):
    """Per product call: program-section edits are admin-only, even the
    initiative's own primary stakeholder can't edit here."""
    _as(U_PRIMARY)
    r = client.patch("/api/v1/initiatives/INIT1", json={"name": "From owner"})
    assert r.status_code == 403


def test_outsider_cannot_edit_initiative(fake):
    _as(U_OUTSIDER)
    r = client.patch("/api/v1/initiatives/INIT1", json={"name": "Nope"})
    assert r.status_code == 403


# ── Activity logging ──────────────────────────────────────────────────────────

def test_date_change_writes_activity_log(fake):
    _as(U_ADMIN)
    r = client.patch("/api/v1/initiatives/INIT1", json={"target_end_date": "2026-07-15"})
    assert r.status_code == 200
    logs = [l for l in fake.store["activity_log"] if l["initiative_id"] == "INIT1"]
    assert len(logs) == 1
    log = logs[0]
    assert log["action"] == "initiative_target_end_date_changed"
    assert log["old_value"]["value"] == "2026-06-30"
    assert log["new_value"]["value"] == "2026-07-15"
    assert log["actor_id"] == U_ADMIN
    assert log["entity_type"] == "initiative"


def test_stakeholder_change_writes_log_with_names(fake):
    _as(U_ADMIN)
    r = client.patch("/api/v1/initiatives/INIT1", json={"primary_stakeholder_id": U_MEMBER})
    assert r.status_code == 200
    logs = [l for l in fake.store["activity_log"] if l["initiative_id"] == "INIT1"]
    assert len(logs) == 1
    log = logs[0]
    assert log["action"] == "initiative_primary_stakeholder_id_changed"
    assert log["old_value"]["name"] == "Primary"
    assert log["new_value"]["name"] == "Member"
    assert log["old_value"]["value"] == U_PRIMARY
    assert log["new_value"]["value"] == U_MEMBER


def test_multiple_fields_write_one_log_each(fake):
    _as(U_ADMIN)
    r = client.patch("/api/v1/initiatives/INIT1", json={
        "name": "New name",
        "status": "done",
        "target_end_date": "2026-08-01",
    })
    assert r.status_code == 200
    logs = [l for l in fake.store["activity_log"] if l["initiative_id"] == "INIT1"]
    actions = sorted(l["action"] for l in logs)
    assert actions == [
        "initiative_name_changed",
        "initiative_status_changed",
        "initiative_target_end_date_changed",
    ]


def test_no_op_patch_writes_no_log(fake):
    """Sending the same values back should not pollute the activity feed."""
    _as(U_ADMIN)
    r = client.patch("/api/v1/initiatives/INIT1", json={
        "name": "Win 3 GeM tenders",
        "status": "in_progress",
    })
    assert r.status_code == 200
    logs = [l for l in fake.store["activity_log"] if l["initiative_id"] == "INIT1"]
    assert logs == []


# ── Program dashboard endpoints ───────────────────────────────────────────────

def test_program_rollup_returns_shape(fake):
    _as(U_ADMIN)
    r = client.get("/api/v1/programs/P1/rollup")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "health" in body
    assert "progress_pct" in body
    assert "initiative_count" in body
    assert body["initiative_count"]["total"] == 1
    assert body["initiative_count"]["done"] == 0


def test_program_rollup_health_derived_from_children(fake):
    """One overdue child → amber. Two+ overdue → red."""
    fake.store["initiatives"][0]["target_end_date"] = "2025-01-01"
    _as(U_ADMIN)
    r = client.get("/api/v1/programs/P1/rollup")
    assert r.status_code == 200
    assert r.json()["health"] == "amber"

    fake.store["initiatives"].append({
        "id": "INIT2", "business_id": "BIZ1", "program_id": "P1",
        "name": "Another late one", "status": "in_progress",
        "start_date": "2026-01-01", "target_end_date": "2025-02-01",
        "date_mode": "uniform",
        "owner_id": U_PRIMARY, "primary_stakeholder_id": U_PRIMARY,
        "impact_category": "cost", "impact": None, "impact_metric": None,
        "theme_id": None,
        "created_at": "2026-02-01T00:00:00+00:00",
    })
    r = client.get("/api/v1/programs/P1/rollup")
    assert r.json()["health"] == "red"


def test_program_rollup_health_not_started_when_no_dates(fake):
    fake.store["initiatives"][0]["start_date"] = None
    fake.store["initiatives"][0]["target_end_date"] = None
    _as(U_ADMIN)
    r = client.get("/api/v1/programs/P1/rollup")
    assert r.json()["health"] == "not_started"


def test_program_gantt_returns_initiative_rows(fake):
    _as(U_ADMIN)
    r = client.get("/api/v1/programs/P1/gantt")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["program"]["id"] == "P1"
    assert len(body["rows"]) == 1
    row = body["rows"][0]
    assert row["id"] == "INIT1"
    assert row["primary_stakeholder_name"] == "Primary"
    assert row["start_date"] == "2026-04-01"
    assert row["end_date"] == "2026-06-30"
    assert row["health"] in ("green", "amber", "red", "not_started")


def test_program_endpoints_require_membership(fake):
    _as(U_OUTSIDER)
    assert client.get("/api/v1/programs/P1/rollup").status_code == 403
    assert client.get("/api/v1/programs/P1/gantt").status_code == 403
