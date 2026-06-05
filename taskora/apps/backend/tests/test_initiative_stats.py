"""D1 — per-initiative task rollup for the inline program-page cards.

Runs the real programs router against FakeSupabase: per-initiative counts +
completion % + derived health, cancelled-initiative exclusion, the empty/no-task
edge cases, and the member-read / cross-tenant gate.
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
MEMBER = "user-member"
OUTSIDER = "user-out"
BIZ = "biz-1"
PROG = "prog-1"
_CUR = {"u": OWNER}

TODAY = date.today()
def _d(off):
    return (TODAY + timedelta(days=off)).isoformat()


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": OWNER, "name": "Owner"}, {"id": MEMBER, "name": "Member"},
                  {"id": OUTSIDER, "name": "Out"}],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "Cost", "status": "active",
                      "color": "#3B82F6", "manual_health": None, "lead_user_id": None,
                      "created_at": "2026-05-01T00:00:00+00:00"}],
        "initiatives": [],
        "tasks": [],
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
    return {"id": tid, "initiative_id": init, "status": status, "due_date": due,
            "updated_at": (updated or _d(-1)) + "T00:00:00+00:00"}


def _stats(sb):
    r = client.get(f"/api/v1/programs/{PROG}/initiative-stats")
    assert r.status_code == 200, r.text
    return {s["id"]: s for s in r.json()["stats"]}


def test_empty_program(sb):
    assert _stats(sb) == {}


def test_counts_and_completion(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(30))]
    sb.store["tasks"] = [
        _task("t1", "I1", status="done"),
        _task("t2", "I1", status="done"),
        _task("t3", "I1", status="in_progress", due=_d(-2)),   # overdue
        _task("t4", "I1", status="blocked"),
        _task("t5", "I1", status="cancelled"),                  # excluded from active
    ]
    s = _stats(sb)["I1"]
    assert s["total_tasks"] == 5
    assert s["done_tasks"] == 2
    assert s["open_tasks"] == 2          # in_progress + blocked (cancelled & done excluded)
    assert s["overdue_tasks"] == 1
    assert s["blocked_tasks"] == 1
    # completion = done / (done + open) = 2/4 = 50% (cancelled ignored)
    assert s["completion_pct"] == 50


def test_completion_none_without_active_tasks(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(30))]
    sb.store["tasks"] = [_task("t1", "I1", status="cancelled")]
    s = _stats(sb)["I1"]
    assert s["completion_pct"] is None
    assert s["open_tasks"] == 0 and s["done_tasks"] == 0


def test_health_dot_derivation(sb):
    sb.store["initiatives"] = [
        _init("PAST", end=_d(-5), name="Past"),       # red
        _init("SOON", end=_d(7), name="Soon"),        # amber (≤14d)
        _init("OK", end=_d(60), name="Ok"),           # green
        _init("NODATE", end=None, name="No date"),    # not_started
    ]
    s = _stats(sb)
    assert s["PAST"]["health"] == "red"
    assert s["SOON"]["health"] == "amber"
    assert s["OK"]["health"] == "green"
    assert s["NODATE"]["health"] == "not_started"


def test_cancelled_initiative_excluded(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(30)), _init("DEAD", status="cancelled")]
    s = _stats(sb)
    assert "I1" in s and "DEAD" not in s


def test_member_can_read_outsider_cannot(sb):
    sb.store["initiatives"] = [_init("I1", end=_d(30))]
    _CUR["u"] = MEMBER
    assert client.get(f"/api/v1/programs/{PROG}/initiative-stats").status_code == 200
    _CUR["u"] = OUTSIDER
    assert client.get(f"/api/v1/programs/{PROG}/initiative-stats").status_code == 403
