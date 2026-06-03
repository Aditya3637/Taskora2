"""M2 — Founder glance (portfolio ranked by P3 composite risk + nudge).

Runs the real portfolio router against FakeSupabase. Pins: programs ranked
worst-first, the cross-portfolio "needs you" list, visibility (admins see all /
members see only visible programs), the nudge → delegation flow, and the
isolation loopholes.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "user-owner"      # founder
MEMBER = "user-member"    # plain member, aligned to one program only
LEAD = "user-lead"
OUTSIDER = "user-out"
BIZ = "biz-1"
BIZ2 = "biz-2"
_CUR = {"u": OWNER}

TODAY = date.today()
def _d(off):
    return (TODAY + timedelta(days=off)).isoformat()


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [
            {"id": OWNER, "name": "Owner"}, {"id": MEMBER, "name": "Member"},
            {"id": LEAD, "name": "Lead"}, {"id": OUTSIDER, "name": "Out"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme"}, {"id": BIZ2, "name": "Other"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
        ],
        "programs": [], "initiatives": [], "tasks": [],
        "program_key_results": [], "program_followers": [],
        "initiative_followers": [], "task_stakeholders": [],
        "item_watchers": [], "subtasks": [], "notebook_assignments": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _prog(pid, *, lead=LEAD, status="active"):
    return {"id": pid, "business_id": BIZ, "name": pid, "color": "#3B82F6",
            "status": status, "manual_health": None, "lead_user_id": lead}


def _init(iid, prog, *, end=None, name=None):
    return {"id": iid, "program_id": prog, "business_id": BIZ,
            "name": name or iid, "status": "active",
            "start_date": None, "target_end_date": end}


def _task(tid, init, *, status="in_progress", due=None):
    return {"id": tid, "title": tid, "initiative_id": init, "status": status,
            "due_date": due, "updated_at": _d(-1) + "T00:00:00+00:00",
            "created_at": "2026-05-01T00:00:00+00:00"}


# ── glance ───────────────────────────────────────────────────────────────────

def test_business_id_required(sb):
    assert client.get("/api/v1/portfolio").status_code == 422


def test_non_member_forbidden(sb):
    _CUR["u"] = OUTSIDER
    assert client.get(f"/api/v1/portfolio?business_id={BIZ}").status_code == 403


def test_empty_portfolio(sb):
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert b["programs"] == [] and b["needs_attention"] == []
    assert b["counts"]["programs_total"] == 0


def test_programs_ranked_worst_first(sb):
    sb.store["programs"] = [_prog("GOOD"), _prog("BAD")]
    sb.store["initiatives"] = [
        _init("g1", "GOOD", end=_d(60)),
        _init("b1", "BAD", end=_d(-10)),     # overdue → high schedule risk
    ]
    sb.store["tasks"] = [
        _task("gt", "g1", due=_d(30)),
        _task("bt", "b1", status="blocked", due=_d(-5)),
    ]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    order = [p["name"] for p in b["programs"]]
    assert order[0] == "BAD"                  # worst first
    assert b["programs"][0]["composite_health"] == "red"
    assert b["programs"][0]["lead_name"] == "Lead"


def test_needs_attention_aggregates_and_targets_lead(sb):
    sb.store["programs"] = [_prog("P1")]
    sb.store["initiatives"] = [_init("i1", "P1", end=_d(-10), name="Slipping")]
    sb.store["tasks"] = [_task("t1", "i1", status="blocked", due=_d(-5))]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    needs = b["needs_attention"]
    assert len(needs) == 1
    n = needs[0]
    assert n["initiative_name"] == "Slipping"
    assert n["nudge_user_id"] == LEAD and n["nudge_user_name"] == "Lead"
    assert any("past target date" in r for r in n["reasons"])


def test_healthy_initiative_not_in_needs(sb):
    sb.store["programs"] = [_prog("P1")]
    sb.store["initiatives"] = [_init("i1", "P1", end=_d(60))]
    sb.store["tasks"] = [_task("t1", "i1", due=_d(30))]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert b["needs_attention"] == []
    assert b["counts"]["green"] == 1


# ── visibility journeys ──────────────────────────────────────────────────────

def test_owner_sees_all_programs(sb):
    sb.store["programs"] = [_prog("A"), _prog("B")]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert {p["name"] for p in b["programs"]} == {"A", "B"}


def test_member_sees_only_visible_programs(sb):
    """A plain member sees only programs they're aligned to. MEMBER is primary
    stakeholder on an initiative in A, and unrelated to B → sees only A."""
    sb.store["programs"] = [_prog("A"), _prog("B")]
    sb.store["initiatives"] = [
        {"id": "ia", "program_id": "A", "business_id": BIZ, "name": "ia",
         "status": "active", "primary_stakeholder_id": MEMBER, "target_end_date": None},
        {"id": "ib", "program_id": "B", "business_id": BIZ, "name": "ib",
         "status": "active", "primary_stakeholder_id": OWNER, "target_end_date": None},
    ]
    _CUR["u"] = MEMBER
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert {p["name"] for p in b["programs"]} == {"A"}   # B not visible


def test_cross_tenant_program_excluded(sb):
    """A BIZ2 program never appears in BIZ's portfolio."""
    sb.store["programs"] = [_prog("A"), {
        "id": "X", "business_id": BIZ2, "name": "Other tenant",
        "status": "active", "manual_health": None, "lead_user_id": None}]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert {p["name"] for p in b["programs"]} == {"A"}


def test_archived_programs_excluded(sb):
    sb.store["programs"] = [_prog("Live"), _prog("Old", status="archived")]
    b = client.get(f"/api/v1/portfolio?business_id={BIZ}").json()
    assert {p["name"] for p in b["programs"]} == {"Live"}


# ── nudge ────────────────────────────────────────────────────────────────────

def test_nudge_creates_delegation(sb):
    r = client.post(
        f"/api/v1/portfolio/nudge?business_id={BIZ}",
        json={"recipient_id": LEAD, "note": "Site B is slipping — can you escalate?"})
    assert r.status_code == 201, r.text
    rows = sb.store["notebook_assignments"]
    assert len(rows) == 1
    assert rows[0]["recipient_id"] == LEAD and rows[0]["sender_id"] == OWNER
    assert rows[0]["status"] == "pending"


def test_nudge_rejects_self(sb):
    r = client.post(
        f"/api/v1/portfolio/nudge?business_id={BIZ}",
        json={"recipient_id": OWNER, "note": "x"})
    assert r.status_code == 400


def test_nudge_rejects_non_member_recipient(sb):
    """LOOPHOLE: can't nudge someone who isn't in the workspace."""
    r = client.post(
        f"/api/v1/portfolio/nudge?business_id={BIZ}",
        json={"recipient_id": OUTSIDER, "note": "x"})
    assert r.status_code == 400


def test_nudge_requires_membership(sb):
    """LOOPHOLE: a non-member can't nudge into a workspace at all."""
    _CUR["u"] = OUTSIDER
    r = client.post(
        f"/api/v1/portfolio/nudge?business_id={BIZ}",
        json={"recipient_id": LEAD, "note": "x"})
    assert r.status_code == 403


def test_nudge_empty_note_rejected(sb):
    r = client.post(
        f"/api/v1/portfolio/nudge?business_id={BIZ}",
        json={"recipient_id": LEAD, "note": "   "})
    assert r.status_code == 422
