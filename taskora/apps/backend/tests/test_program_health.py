"""P3 — composite health + ranked risk, plus the bundled N3 (program-edit authz)
and N12 (null-clearing) fixes.

Runs the real programs router against FakeSupabase. Health was date-only before
P3; these tests pin the blended score (schedule + outcome + throughput +
blockers + staleness), the /risks ranking + reasons, the new write-gate, and the
clear-a-field-with-null behavior — across member / admin / founder(owner) / lead
journeys and the isolation loopholes.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "user-owner"      # founder / workspace owner
ADMIN = "user-admin"
LEAD = "user-lead"        # plain member, but the program's lead_user_id
MEMBER = "user-member"    # plain member, no special role
OUTSIDER = "user-out"     # not a member of the business
BIZ = "biz-1"
BIZ2 = "biz-2"
PROG = "prog-1"
_CUR = {"u": OWNER}

TODAY = date.today()
def _d(offset):  # date string offset days from today
    return (TODAY + timedelta(days=offset)).isoformat()


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [
            {"id": OWNER, "name": "Owner"}, {"id": ADMIN, "name": "Admin"},
            {"id": LEAD, "name": "Lead"}, {"id": MEMBER, "name": "Member"},
            {"id": OUTSIDER, "name": "Out"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme"}, {"id": BIZ2, "name": "Other"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "programs": [{
            "id": PROG, "business_id": BIZ, "name": "Cost", "status": "active",
            "color": "#3B82F6", "objective": "cut cost", "manual_health": None,
            "lead_user_id": LEAD, "target_end_date": _d(90),
            "created_at": "2026-05-01T00:00:00+00:00",
        }],
        "initiatives": [],
        "tasks": [],
        "program_key_results": [],
        "program_updates": [],
        "program_snapshots": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _init(iid, *, status="active", end=None, name=None):
    return {"id": iid, "program_id": PROG, "business_id": BIZ, "name": name or iid,
            "status": status, "start_date": None, "target_end_date": end}


def _task(tid, init, *, status="in_progress", due=None, updated=None):
    return {"id": tid, "title": tid, "initiative_id": init, "status": status,
            "due_date": due, "updated_at": (updated or _d(-1)) + "T00:00:00+00:00",
            "created_at": "2026-05-01T00:00:00+00:00"}


# ── composite health ─────────────────────────────────────────────────────────

def test_empty_program_not_started(sb):
    r = client.get(f"/api/v1/programs/{PROG}/risks")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["composite_health"] == "not_started"
    assert b["composite_score"] is None
    assert b["ranked_initiatives"] == []


def test_all_signals_bad_is_red(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(-10))]   # past target → schedule 1.0
    sb.store["tasks"] = [
        _task("T1", "I1", status="blocked", due=_d(-5)),    # overdue + blocked
        _task("T2", "I1", status="in_progress", due=_d(-3)),# overdue
    ]
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    c = b["components"]
    assert c["schedule"] == 1.0
    assert c["throughput"] == 1.0          # 2/2 open overdue
    assert c["blockers"] == 0.5            # 1/2 open blocked
    assert b["composite_health"] == "red"


def test_healthy_program_is_green(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(60))]    # comfortably future
    sb.store["tasks"] = [_task("T1", "I1", due=_d(30), updated=_d(-1))]
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    assert b["components"]["schedule"] == 0.0
    assert b["components"]["throughput"] == 0.0
    assert b["composite_health"] == "green"


def test_outcome_signal_isolated(sb):
    """No dates, no tasks → only the KR attainment drives the score."""
    sb.store["initiatives"] = [_init("I1", end=None)]       # schedule None
    sb.store["program_key_results"] = [
        {"id": "k1", "program_id": PROG, "baseline": 0, "target": 10,
         "current": 2, "direction": "increase"},             # 20% → outcome risk 0.8
    ]
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    assert b["components"]["outcome"] == 0.8
    assert b["components"]["schedule"] is None
    assert b["composite_score"] == 0.8
    assert b["composite_health"] == "red"


def test_staleness_signal(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(60))]
    sb.store["tasks"] = [_task("T1", "I1", due=_d(30), updated=_d(-30))]  # 30d stale
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    assert b["components"]["staleness"] == 1.0
    ranked = b["ranked_initiatives"][0]
    assert any("no activity" in r for r in ranked["reasons"])


def test_manual_health_overrides_composite(sb):
    sb.store["programs"][0]["manual_health"] = "green"
    sb.store["initiatives"] = [_init("I1", end=_d(-10))]    # would compute red
    sb.store["tasks"] = [_task("T1", "I1", status="blocked", due=_d(-5))]
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    assert b["composite_health"] == "green"   # override wins


# ── /risks ranking + reasons ─────────────────────────────────────────────────

def test_ranked_worst_first_with_reasons(sb):
    sb.store["initiatives"] = [
        _init("GOOD", end=_d(60), name="On track"),
        _init("BAD", end=_d(-10), name="Slipping"),
    ]
    sb.store["tasks"] = [
        _task("g1", "GOOD", due=_d(30)),
        _task("b1", "BAD", status="blocked", due=_d(-5)),
        _task("b2", "BAD", due=_d(-2)),
    ]
    b = client.get(f"/api/v1/programs/{PROG}/risks").json()
    order = [i["name"] for i in b["ranked_initiatives"]]
    assert order[0] == "Slipping"          # worst first
    bad = b["ranked_initiatives"][0]
    assert "past target date" in bad["reasons"]
    assert any("overdue task" in r for r in bad["reasons"])
    assert any("blocked task" in r for r in bad["reasons"])
    assert bad["overdue_tasks"] == 2 and bad["blocked_tasks"] == 1


def test_rollup_carries_composite_additively(sb):
    """Legacy `health` stays; composite fields are added alongside it."""
    sb.store["initiatives"] = [_init("I1", end=_d(-10))]
    b = client.get(f"/api/v1/programs/{PROG}/rollup").json()
    assert "health" in b                      # legacy field untouched
    assert "composite_health" in b
    assert "risk_components" in b
    assert set(b["risk_components"]) == {
        "schedule", "outcome", "throughput", "blockers", "staleness"}


# ── N3: program-edit authz (member/admin/founder/lead journeys) ──────────────

def test_member_cannot_edit_program(sb):
    _CUR["u"] = MEMBER
    r = client.patch(f"/api/v1/programs/{PROG}", json={"name": "Hijacked"})
    assert r.status_code == 403, r.text


def test_owner_admin_lead_can_edit_program(sb):
    for u in (OWNER, ADMIN, LEAD):
        _CUR["u"] = u
        r = client.patch(f"/api/v1/programs/{PROG}", json={"name": f"By {u}"})
        assert r.status_code == 200, (u, r.text)
        assert r.json()["name"] == f"By {u}"


def test_non_member_cannot_edit_program(sb):
    _CUR["u"] = OUTSIDER
    r = client.patch(f"/api/v1/programs/{PROG}", json={"name": "x"})
    assert r.status_code == 403, r.text


def test_member_cannot_delete_program_but_lead_can(sb):
    _CUR["u"] = MEMBER
    assert client.delete(f"/api/v1/programs/{PROG}").status_code == 403
    _CUR["u"] = LEAD
    assert client.delete(f"/api/v1/programs/{PROG}").status_code == 204


# ── N12: null-clearing ───────────────────────────────────────────────────────

def test_clear_nullable_program_field(sb):
    _CUR["u"] = LEAD
    r = client.patch(f"/api/v1/programs/{PROG}", json={"target_end_date": None})
    assert r.status_code == 200, r.text
    assert sb.store["programs"][0]["target_end_date"] is None


def test_null_on_required_field_is_ignored(sb):
    """Sending name=null must not blank the name; with nothing else to update
    that's a 422 (no valid fields), and the name is unchanged."""
    _CUR["u"] = LEAD
    before = sb.store["programs"][0]["name"]
    r = client.patch(f"/api/v1/programs/{PROG}", json={"name": None})
    assert r.status_code == 422, r.text
    assert sb.store["programs"][0]["name"] == before


def test_clear_key_result_target(sb):
    sb.store["program_key_results"] = [{
        "id": "k1", "program_id": PROG, "title": "KR", "baseline": 0,
        "target": 10, "current": 5, "direction": "increase"}]
    _CUR["u"] = MEMBER  # KR edit stays member-allowed (N3 scoped to update_program)
    r = client.patch(f"/api/v1/programs/{PROG}/key-results/k1", json={"target": None})
    assert r.status_code == 200, r.text
    assert r.json()["target"] is None
    assert r.json()["progress_pct"] is None   # no target → not measurable


# ── loopholes ────────────────────────────────────────────────────────────────

def test_risks_non_member_forbidden(sb):
    _CUR["u"] = OUTSIDER
    assert client.get(f"/api/v1/programs/{PROG}/risks").status_code == 403


def test_risks_cross_tenant_program_not_leaked(sb):
    """A program in BIZ2 is invisible to an OUTSIDER and to BIZ members alike
    unless they belong to BIZ2."""
    sb.store["programs"].append({
        "id": "prog-2", "business_id": BIZ2, "name": "Secret",
        "status": "active", "manual_health": None, "lead_user_id": None})
    _CUR["u"] = MEMBER  # member of BIZ, not BIZ2
    assert client.get("/api/v1/programs/prog-2/risks").status_code == 403
