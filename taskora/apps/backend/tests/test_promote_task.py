"""D5 — doc-driven creation: promote a work-doc block/selection into a task.

Runs the real workspace_docs router against FakeSupabase. The promote endpoint
reuses the doc WRITE gate, so the matrix mirrors test_workspace_docs: owner /
admin / program-lead / contributor can promote; followers (read-only),
unaligned members, and outsiders cannot. Also checks the created task is a
well-formed task (primary stakeholder = promoter, + stakeholder row, title
trimmed).
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER, ADMIN, LEAD = "u-owner", "u-admin", "u-lead"
CONTRIB, FOLLOWER, STRANGER, OUTSIDER = "u-contrib", "u-follower", "u-stranger", "u-out"
BIZ = "biz-1"
PROG, INIT = "prog-1", "init-1"
_CUR = {"u": OWNER}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": u, "name": u} for u in
                  (OWNER, ADMIN, LEAD, CONTRIB, FOLLOWER, STRANGER, OUTSIDER)],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": CONTRIB, "role": "member"},
            {"business_id": BIZ, "user_id": FOLLOWER, "role": "member"},
            {"business_id": BIZ, "user_id": STRANGER, "role": "member"},
        ],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "P", "lead_user_id": LEAD}],
        "initiatives": [{"id": INIT, "business_id": BIZ, "program_id": PROG, "name": "I1",
                         "primary_stakeholder_id": OWNER, "status": "active"}],
        "tasks": [{"id": "t1", "initiative_id": INIT, "created_by": OWNER}],
        "task_stakeholders": [{"task_id": "t1", "user_id": CONTRIB, "role": "secondary"}],
        "initiative_followers": [{"initiative_id": INIT, "user_id": FOLLOWER}],
        "program_followers": [], "subtasks": [], "item_watchers": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _promote(title):
    return client.post(f"/api/v1/initiatives/{INIT}/promote-task", json={"title": title})


def test_owner_promotes_creates_wellformed_task(sb):
    r = _promote("  Wire up the vendor onboarding  ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["initiative_id"] == INIT
    assert body["title"] == "Wire up the vendor onboarding"   # trimmed
    assert body["status"] == "todo"

    task = next(t for t in sb.store["tasks"] if t["id"] == body["id"])
    assert task["primary_stakeholder_id"] == OWNER and task["created_by"] == OWNER
    # the canonical primary-stakeholder row exists, like a normally-created task
    assert any(s["task_id"] == body["id"] and s["user_id"] == OWNER and s["role"] == "primary"
               for s in sb.store["task_stakeholders"])


def test_promoter_becomes_owner(sb):
    _as(CONTRIB)
    body = _promote("Contributor's action item").json()
    task = next(t for t in sb.store["tasks"] if t["id"] == body["id"])
    assert task["primary_stakeholder_id"] == CONTRIB


@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD, CONTRIB])
def test_write_set_can_promote(sb, u):
    _as(u)
    assert _promote("x").status_code == 201


def test_follower_and_stranger_cannot_promote(sb):
    _as(FOLLOWER)
    assert _promote("x").status_code == 403     # read-only follower
    _as(STRANGER)
    assert _promote("x").status_code == 403     # unaligned member


def test_outsider_403(sb):
    _as(OUTSIDER)
    assert _promote("x").status_code == 403


def test_blank_title_422(sb):
    assert _promote("   ").status_code == 422


def test_missing_initiative_404(sb):
    r = client.post("/api/v1/initiatives/nope/promote-task", json={"title": "x"})
    assert r.status_code == 404
