"""P4 — program milestones (timeline key dates).

Runs the real programs router against FakeSupabase: CRUD, the derived
done/overdue/upcoming status, the owner/admin/lead write-gate (N3), member read,
and cross-program / cross-tenant isolation.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "user-owner"
LEAD = "user-lead"
MEMBER = "user-member"
OUTSIDER = "user-out"
BIZ = "biz-1"
PROG = "prog-1"
PROG2 = "prog-2"
_CUR = {"u": OWNER}

TODAY = date.today()
def _d(off):
    return (TODAY + timedelta(days=off)).isoformat()


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": OWNER, "name": "Owner"}, {"id": LEAD, "name": "Lead"},
                  {"id": MEMBER, "name": "Member"}, {"id": OUTSIDER, "name": "Out"}],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "programs": [
            {"id": PROG, "business_id": BIZ, "name": "Cost", "status": "active",
             "color": "#3B82F6", "manual_health": None, "lead_user_id": LEAD,
             "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": PROG2, "business_id": BIZ, "name": "Other", "status": "active",
             "color": "#000", "manual_health": None, "lead_user_id": None,
             "created_at": "2026-05-01T00:00:00+00:00"},
        ],
        "milestones": [],
        "milestone_entities": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _create(name, date_str):
    return client.post(f"/api/v1/programs/{PROG}/milestones",
                       json={"name": name, "date": date_str})


def test_empty_list(sb):
    r = client.get(f"/api/v1/programs/{PROG}/milestones")
    assert r.status_code == 200 and r.json() == []


def test_create_status_and_order(sb):
    assert _create("Kickoff", _d(-5)).status_code == 201        # past → overdue
    assert _create("Launch", _d(20)).status_code == 201         # future → upcoming
    assert _create("Someday", None).status_code == 201          # undated → upcoming
    rows = client.get(f"/api/v1/programs/{PROG}/milestones").json()
    # earliest-dated first, undated last
    assert [m["name"] for m in rows] == ["Kickoff", "Launch", "Someday"]
    by = {m["name"]: m for m in rows}
    assert by["Kickoff"]["status"] == "overdue"
    assert by["Launch"]["status"] == "upcoming"
    assert by["Someday"]["status"] == "upcoming"


def test_complete_toggle(sb):
    mid = _create("Kickoff", _d(-5)).json()["id"]
    done = client.patch(f"/api/v1/programs/{PROG}/milestones/{mid}",
                        json={"completed": True}).json()
    assert done["status"] == "done" and done["completed_at"]
    back = client.patch(f"/api/v1/programs/{PROG}/milestones/{mid}",
                        json={"completed": False}).json()
    assert back["status"] == "overdue" and back["completed_at"] is None


def test_rename_and_redate(sb):
    mid = _create("Draft", _d(5)).json()["id"]
    r = client.patch(f"/api/v1/programs/{PROG}/milestones/{mid}",
                     json={"name": "Final", "date": _d(40)}).json()
    assert r["name"] == "Final" and r["date"] == _d(40)


def test_delete(sb):
    mid = _create("Temp", _d(5)).json()["id"]
    assert client.delete(f"/api/v1/programs/{PROG}/milestones/{mid}").status_code == 204
    assert client.get(f"/api/v1/programs/{PROG}/milestones").json() == []


# ── authz + isolation ────────────────────────────────────────────────────────

def test_lead_can_write_member_cannot(sb):
    _as(LEAD)
    assert _create("Lead ms", _d(5)).status_code == 201
    _as(MEMBER)
    assert _create("Nope", _d(5)).status_code == 403
    # ...but a plain member can still read.
    assert client.get(f"/api/v1/programs/{PROG}/milestones").status_code == 200


def test_outsider_forbidden(sb):
    _as(OUTSIDER)
    assert client.get(f"/api/v1/programs/{PROG}/milestones").status_code == 403
    assert _create("x", _d(1)).status_code == 403


def test_cross_program_milestone_404(sb):
    mid = _create("P1 ms", _d(5)).json()["id"]
    # the same milestone id is not reachable under a different program
    assert client.patch(f"/api/v1/programs/{PROG2}/milestones/{mid}",
                        json={"name": "x"}).status_code == 404
    assert client.delete(f"/api/v1/programs/{PROG2}/milestones/{mid}").status_code == 404
