"""P6 — initiative dependencies (critical path / blocked).

Runs the real programs router against FakeSupabase: the dependency view (stage
ordering, blocked flag from unfinished prerequisites, reverse `blocks`), and the
PUT validation — in-program targets only, no self-dependency, cycle rejection,
and the owner/admin/lead write-gate (N3).
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER, LEAD, MEMBER, OUTSIDER = "u-owner", "u-lead", "u-member", "u-out"
BIZ = "biz-1"
PROG, PROG2 = "prog-1", "prog-2"
_CUR = {"u": OWNER}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": u, "name": u} for u in (OWNER, LEAD, MEMBER, OUTSIDER)],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "programs": [
            {"id": PROG, "business_id": BIZ, "name": "P", "status": "active",
             "color": "#000", "manual_health": None, "lead_user_id": LEAD,
             "created_at": "2026-05-01T00:00:00+00:00"},
            {"id": PROG2, "business_id": BIZ, "name": "P2", "status": "active",
             "color": "#000", "manual_health": None, "lead_user_id": None,
             "created_at": "2026-05-01T00:00:00+00:00"},
        ],
        "initiatives": [
            {"id": "A", "program_id": PROG, "business_id": BIZ, "name": "A",
             "status": "active", "depends_on": []},
            {"id": "B", "program_id": PROG, "business_id": BIZ, "name": "B",
             "status": "active", "depends_on": ["A"]},
            {"id": "C", "program_id": PROG, "business_id": BIZ, "name": "C",
             "status": "active", "depends_on": ["B"]},
            {"id": "X", "program_id": PROG2, "business_id": BIZ, "name": "X",
             "status": "active", "depends_on": []},
        ],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _view(sb):
    r = client.get(f"/api/v1/programs/{PROG}/dependencies")
    assert r.status_code == 200, r.text
    return {i["id"]: i for i in r.json()["initiatives"]}


def _put(initiative_id, depends_on):
    return client.put(f"/api/v1/programs/{PROG}/dependencies",
                      json={"initiative_id": initiative_id, "depends_on": depends_on})


def test_stage_blocked_blocks(sb):
    v = _view(sb)
    assert (v["A"]["stage"], v["B"]["stage"], v["C"]["stage"]) == (0, 1, 2)
    assert v["A"]["blocked"] is False
    assert v["B"]["blocked"] is True and [d["id"] for d in v["B"]["blocked_by"]] == ["A"]
    assert v["C"]["blocked"] is True
    assert v["A"]["blocks"] == ["B"] and v["B"]["blocks"] == ["C"]


def test_finished_prereq_unblocks(sb):
    sb.store["initiatives"][0]["status"] = "done"   # A done
    v = _view(sb)
    assert v["B"]["blocked"] is False
    assert v["C"]["blocked"] is True                 # B still active


def test_put_sets_dependencies(sb):
    # Clear C's deps, then point it at A directly.
    v = _put("C", ["A"]).json()["initiatives"]
    by = {i["id"]: i for i in v}
    assert [d["id"] for d in by["C"]["depends_on"]] == ["A"]
    assert by["C"]["stage"] == 1


def test_self_dependency_rejected(sb):
    assert _put("A", ["A"]).status_code == 400


def test_cycle_rejected(sb):
    # A already ← B ← C. Making A depend on C closes the loop.
    assert _put("A", ["C"]).status_code == 400


def test_cross_program_dependency_rejected(sb):
    assert _put("A", ["X"]).status_code == 400       # X is in PROG2
    assert _put("A", ["nope"]).status_code == 400


def test_initiative_not_in_program_404(sb):
    assert _put("X", ["A"]).status_code == 404


def test_authz(sb):
    _as(LEAD)
    assert _put("A", []).status_code == 200           # program lead may edit
    _as(MEMBER)
    assert _put("A", []).status_code == 403           # plain member may not
    assert client.get(f"/api/v1/programs/{PROG}/dependencies").status_code == 200  # but can read
    _as(OUTSIDER)
    assert client.get(f"/api/v1/programs/{PROG}/dependencies").status_code == 403
