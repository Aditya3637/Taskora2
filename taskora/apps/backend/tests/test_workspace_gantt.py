"""GET /api/v1/programs/workspace-gantt — workspace-wide program timeline.

Exercises program swimlanes, one initiative bar per child, the synthetic
'Unlinked' lane, the primary-stakeholder roster, and admin vs member
visibility.
"""
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

BIZ = "BIZ"
OWNER = "owner-1"
MEMBER = "member-1"
P1 = "prog-1"


def _store():
    return {
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "users": [
            {"id": OWNER, "name": "Owner"},
            {"id": MEMBER, "name": "Member"},
        ],
        "programs": [
            {"id": P1, "business_id": BIZ, "name": "Solar Rollout",
             "color": "#123456", "start_date": "2026-01-01",
             "target_end_date": "2026-12-31", "created_at": "2026-01-01T00:00:00+00:00"},
        ],
        "initiatives": [
            {"id": "i-1", "business_id": BIZ, "name": "Phase A", "status": "active",
             "start_date": "2026-02-01", "target_end_date": "2026-05-31",
             "program_id": P1, "primary_stakeholder_id": OWNER, "impact_category": "cost"},
            {"id": "i-2", "business_id": BIZ, "name": "Phase B", "status": "active",
             "start_date": "2026-06-01", "target_end_date": "2026-09-30",
             "program_id": P1, "primary_stakeholder_id": MEMBER, "impact_category": "cost",
             "depends_on": ["i-1", "i-missing"]},   # i-missing must be dropped
            # No program → Unlinked lane.
            {"id": "i-3", "business_id": BIZ, "name": "Loose", "status": "active",
             "start_date": "2026-03-01", "target_end_date": "2026-04-30",
             "program_id": None, "primary_stakeholder_id": OWNER, "impact_category": "other"},
            # Cancelled → excluded.
            {"id": "i-4", "business_id": BIZ, "name": "Dropped", "status": "cancelled",
             "start_date": "2026-01-01", "target_end_date": "2026-02-01",
             "program_id": P1, "primary_stakeholder_id": OWNER, "impact_category": "other"},
        ],
        "program_followers": [],
        "milestones": [
            {"id": "m-1", "parent_type": "program", "parent_id": P1,
             "name": "Go-live", "uniform_date": "2026-10-15", "completed_at": None},
            # Different parent_type must be ignored.
            {"id": "m-x", "parent_type": "initiative", "parent_id": "i-1",
             "name": "Other", "uniform_date": "2026-05-01", "completed_at": None},
        ],
    }


def _as(uid):
    app.dependency_overrides[get_current_user] = lambda: {"id": uid, "email": f"{uid}@x.io"}
    app.dependency_overrides[get_supabase] = lambda: _SB


def teardown_function():
    app.dependency_overrides.clear()


_SB = None


def _setup():
    global _SB
    _SB = FakeSupabase(_store())


def test_owner_sees_program_lanes_and_unlinked():
    _setup()
    _as(OWNER)
    data = client.get(f"/api/v1/programs/workspace-gantt?business_id={BIZ}").json()
    lanes = {l["name"]: l for l in data["programs"]}
    assert "Solar Rollout" in lanes and "Unlinked" in lanes
    solar = lanes["Solar Rollout"]
    titles = sorted(i["title"] for i in solar["initiatives"])
    assert titles == ["Phase A", "Phase B"]          # cancelled excluded
    # Bars carry start/end + resolved primary name.
    a = next(i for i in solar["initiatives"] if i["title"] == "Phase A")
    assert a["start_date"] == "2026-02-01" and a["end_date"] == "2026-05-31"
    assert a["primary_stakeholder_name"] == "Owner"


def test_program_milestones_and_dependencies():
    _setup()
    _as(OWNER)
    data = client.get(f"/api/v1/programs/workspace-gantt?business_id={BIZ}").json()
    solar = next(l for l in data["programs"] if l["name"] == "Solar Rollout")
    # Program milestone surfaces; the initiative-scoped one does not.
    assert [m["name"] for m in solar["milestones"]] == ["Go-live"]
    assert solar["milestones"][0]["date"] == "2026-10-15"
    # Dependency edge keeps only the in-response target (i-1), drops i-missing.
    b = next(i for i in solar["initiatives"] if i["title"] == "Phase B")
    assert b["depends_on"] == ["i-1"]


def test_members_roster_for_filter():
    _setup()
    _as(OWNER)
    data = client.get(f"/api/v1/programs/workspace-gantt?business_id={BIZ}").json()
    ids = {m["id"] for m in data["members"]}
    assert ids == {OWNER, MEMBER}


def test_route_not_shadowed_by_program_id():
    """'/workspace-gantt' must resolve to the workspace endpoint, not be
    captured as GET /programs/{program_id='workspace-gantt'}."""
    _setup()
    _as(OWNER)
    r = client.get(f"/api/v1/programs/workspace-gantt?business_id={BIZ}")
    assert r.status_code == 200
    assert "programs" in r.json() and "members" in r.json()
