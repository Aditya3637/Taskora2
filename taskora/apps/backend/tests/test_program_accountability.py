"""P5 — program accountability: owner load + per-site (building/client) rollup.

Runs the real programs router against FakeSupabase: per-owner task aggregation
(total/open/overdue/done + completion%), per-entity rollup off
task_entities.per_entity_status (with per_entity_end_date / task-due overdue
fallback), and the member-read / cross-tenant gate.
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
ALICE = "user-alice"
BOB = "user-bob"
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
        "users": [
            {"id": OWNER, "name": "Owner"}, {"id": ALICE, "name": "Alice"},
            {"id": BOB, "name": "Bob"}, {"id": MEMBER, "name": "Member"},
            {"id": OUTSIDER, "name": "Out"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "Cost", "status": "active",
                      "color": "#3B82F6", "manual_health": None, "lead_user_id": None,
                      "created_at": "2026-05-01T00:00:00+00:00"}],
        "initiatives": [{"id": "I1", "program_id": PROG, "business_id": BIZ, "name": "I1",
                         "status": "active", "start_date": None, "target_end_date": _d(30)}],
        "tasks": [],
        "task_entities": [],
        "buildings": [{"id": "b1", "name": "Tower A", "business_id": BIZ},
                      {"id": "b2", "name": "Tower B", "business_id": BIZ}],
        "clients": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _task(tid, *, owner, status="in_progress", due=None, init="I1"):
    return {"id": tid, "initiative_id": init, "status": status,
            "due_date": due, "primary_stakeholder_id": owner}


def _get(sb):
    r = client.get(f"/api/v1/programs/{PROG}/accountability")
    assert r.status_code == 200, r.text
    return r.json()


def test_empty(sb):
    b = _get(sb)
    assert b["owners"] == [] and b["sites"] == []


def test_owner_load(sb):
    sb.store["tasks"] = [
        _task("t1", owner=ALICE, status="done"),
        _task("t2", owner=ALICE, status="in_progress", due=_d(-2)),   # overdue
        _task("t3", owner=ALICE, status="in_progress", due=_d(5)),
        _task("t4", owner=BOB, status="todo", due=_d(10)),
        _task("t5", owner=BOB, status="cancelled"),                    # ignored from active
    ]
    by = {o["user_id"]: o for o in _get(sb)["owners"]}
    a = by[ALICE]
    assert (a["total"], a["done"], a["open"], a["overdue"]) == (3, 1, 2, 1)
    assert a["completion_pct"] == 33   # 1 / (1+2)
    b = by[BOB]
    assert (b["total"], b["done"], b["open"], b["overdue"]) == (2, 0, 1, 0)
    assert b["completion_pct"] == 0
    # Alice (1 overdue) ranks before Bob (0 overdue).
    assert [o["user_id"] for o in _get(sb)["owners"]] == [ALICE, BOB]
    assert by[ALICE]["name"] == "Alice"


def test_sites_rollup_with_name_and_overdue(sb):
    sb.store["tasks"] = [
        _task("t1", owner=ALICE, due=_d(-3)),   # task due in the past (entity fallback)
        _task("t2", owner=ALICE, due=_d(20)),
    ]
    sb.store["task_entities"] = [
        # Tower A: one done, one open whose entity end-date is past → overdue
        {"task_id": "t1", "entity_type": "building", "entity_id": "b1",
         "per_entity_status": "in_progress", "per_entity_end_date": _d(-1)},
        {"task_id": "t2", "entity_type": "building", "entity_id": "b1",
         "per_entity_status": "done", "per_entity_end_date": None},
        # Tower B: open, no entity end-date → falls back to task t1's past due
        {"task_id": "t1", "entity_type": "building", "entity_id": "b2",
         "per_entity_status": "todo", "per_entity_end_date": None},
    ]
    sites = {s["entity_id"]: s for s in _get(sb)["sites"]}
    a = sites["b1"]
    assert a["name"] == "Tower A"
    assert (a["total"], a["done"], a["open"], a["overdue"]) == (2, 1, 1, 1)
    assert a["completion_pct"] == 50
    b = sites["b2"]
    assert (b["total"], b["open"], b["overdue"]) == (1, 1, 1)   # fallback to task due
    assert b["completion_pct"] == 0


def test_member_reads_outsider_403(sb):
    _CUR["u"] = MEMBER
    assert client.get(f"/api/v1/programs/{PROG}/accountability").status_code == 200
    _CUR["u"] = OUTSIDER
    assert client.get(f"/api/v1/programs/{PROG}/accountability").status_code == 403
