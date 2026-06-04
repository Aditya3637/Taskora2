"""D0 — Workspace Docs engine. CRUD + the §11 visibility/loophole matrix.

Runs the real router against FakeSupabase. The whole point of this slice is that
a doc inherits its initiative's visibility cascade with NO per-doc sharing model,
and that contributors can edit while followers are read-only — so most of these
tests are the access matrix, not happy paths.

Cast (all in BIZ unless noted):
  OWNER     workspace owner   → read+write everything
  ADMIN     workspace admin   → read+write everything
  LEAD      member + program lead of P1 → read+write docs in P1's initiatives
  CONTRIB   member + task_stakeholder on a task in INIT1 → writable → read+write
  FOLLOWER  member + initiative_follower of INIT1 → visible only → READ-ONLY
  STRANGER  member, unaligned → can't see INIT1 → read 404 / write 403
  OUTSIDER  not a member → 403
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
BIZ, BIZ2 = "biz-1", "biz-2"
PROG, INIT, INIT2 = "prog-1", "init-1", "init-2"
_CUR = {"u": OWNER}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": u, "name": u} for u in
                  (OWNER, ADMIN, LEAD, CONTRIB, FOLLOWER, STRANGER, OUTSIDER)],
        "businesses": [{"id": BIZ, "name": "Acme"}, {"id": BIZ2, "name": "Other"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ, "user_id": LEAD, "role": "member"},
            {"business_id": BIZ, "user_id": CONTRIB, "role": "member"},
            {"business_id": BIZ, "user_id": FOLLOWER, "role": "member"},
            {"business_id": BIZ, "user_id": STRANGER, "role": "member"},
        ],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "P", "lead_user_id": LEAD}],
        "initiatives": [
            {"id": INIT, "business_id": BIZ, "program_id": PROG, "name": "I1",
             "primary_stakeholder_id": OWNER, "status": "active"},
            {"id": INIT2, "business_id": BIZ2, "program_id": None, "name": "I2",
             "primary_stakeholder_id": OWNER, "status": "active"},
        ],
        "tasks": [{"id": "t1", "initiative_id": INIT, "created_by": OWNER}],
        "task_stakeholders": [{"task_id": "t1", "user_id": CONTRIB, "role": "secondary"}],
        "initiative_followers": [{"initiative_id": INIT, "user_id": FOLLOWER}],
        "program_followers": [], "subtasks": [], "item_watchers": [],
        "workspace_docs": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _seed_doc(sb, *, init=INIT, biz=BIZ, archived=False, did="d1"):
    sb.store["workspace_docs"].append({
        "id": did, "business_id": biz, "parent_type": "initiative",
        "parent_id": init, "title": "Doc", "body": {"v": 1},
        "created_by": OWNER, "created_at": "2026-06-01T00:00:00+00:00",
        "updated_at": "2026-06-01T00:00:00+00:00",
        "archived_at": "2026-06-02T00:00:00+00:00" if archived else None,
    })


# ── CRUD happy path ──────────────────────────────────────────────────────────

def test_create_list_get_update_archive(sb):
    # create (owner)
    r = client.post(f"/api/v1/initiatives/{INIT}/docs",
                    json={"title": "Recovery plan", "body": {"type": "doc"}})
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["title"] == "Recovery plan" and doc["parent_id"] == INIT
    assert doc["business_id"] == BIZ
    did = doc["id"]

    # list
    lst = client.get(f"/api/v1/initiatives/{INIT}/docs").json()
    assert [d["id"] for d in lst] == [did]

    # get one
    assert client.get(f"/api/v1/docs/{did}").json()["title"] == "Recovery plan"

    # autosave body only
    r2 = client.patch(f"/api/v1/docs/{did}", json={"body": {"type": "doc", "v": 2}})
    assert r2.status_code == 200 and r2.json()["body"]["v"] == 2

    # archive → drops out of the default list, restore brings it back
    assert client.post(f"/api/v1/docs/{did}/archive", json={"archived": True}).status_code == 200
    assert client.get(f"/api/v1/initiatives/{INIT}/docs").json() == []
    assert client.get(f"/api/v1/initiatives/{INIT}/docs?include_archived=true").json()[0]["id"] == did
    client.post(f"/api/v1/docs/{did}/archive", json={"archived": False})
    assert len(client.get(f"/api/v1/initiatives/{INIT}/docs").json()) == 1


def test_default_title_and_empty_body(sb):
    r = client.post(f"/api/v1/initiatives/{INIT}/docs", json={})
    assert r.status_code == 201
    assert r.json()["title"] == "Work document" and r.json()["body"] == {}


def test_patch_empty_is_422(sb):
    _seed_doc(sb)
    assert client.patch("/api/v1/docs/d1", json={}).status_code == 422


# ── read gate ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD, CONTRIB, FOLLOWER])
def test_read_allowed_for(u, sb):
    _seed_doc(sb)
    _as(u)
    assert client.get("/api/v1/docs/d1").status_code == 200
    assert client.get(f"/api/v1/initiatives/{INIT}/docs").status_code == 200


def test_stranger_cannot_see_doc(sb):
    """Member of the business but not aligned to INIT → 404 (don't leak)."""
    _seed_doc(sb)
    _as(STRANGER)
    assert client.get("/api/v1/docs/d1").status_code == 404
    assert client.get(f"/api/v1/initiatives/{INIT}/docs").status_code == 404


def test_non_member_forbidden(sb):
    _seed_doc(sb)
    _as(OUTSIDER)
    assert client.get("/api/v1/docs/d1").status_code == 403
    assert client.get(f"/api/v1/initiatives/{INIT}/docs").status_code == 403


# ── write gate ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD, CONTRIB])
def test_write_allowed_for(u, sb):
    _seed_doc(sb)
    _as(u)
    assert client.patch("/api/v1/docs/d1", json={"title": f"by {u}"}).status_code == 200
    assert client.post(f"/api/v1/initiatives/{INIT}/docs", json={"title": "new"}).status_code == 201


def test_follower_is_read_only(sb):
    """LOOPHOLE: a follower can READ but every write path is 403."""
    _seed_doc(sb)
    _as(FOLLOWER)
    assert client.get("/api/v1/docs/d1").status_code == 200          # read ok
    assert client.patch("/api/v1/docs/d1", json={"title": "x"}).status_code == 403
    assert client.post(f"/api/v1/initiatives/{INIT}/docs", json={"title": "x"}).status_code == 403
    assert client.post("/api/v1/docs/d1/archive", json={"archived": True}).status_code == 403


def test_stranger_cannot_write(sb):
    _seed_doc(sb)
    _as(STRANGER)
    assert client.post(f"/api/v1/initiatives/{INIT}/docs", json={"title": "x"}).status_code == 403
    assert client.patch("/api/v1/docs/d1", json={"title": "x"}).status_code == 403


# ── cross-tenant loopholes ───────────────────────────────────────────────────

def test_cannot_create_on_cross_tenant_initiative(sb):
    """LOOPHOLE: OWNER of BIZ is not a member of BIZ2 → can't create a doc on
    BIZ2's initiative."""
    _as(OWNER)
    assert client.post(f"/api/v1/initiatives/{INIT2}/docs", json={"title": "x"}).status_code == 403


def test_cannot_read_cross_tenant_doc(sb):
    """LOOPHOLE: a doc whose initiative is in BIZ2 is unreadable to a BIZ user."""
    _seed_doc(sb, init=INIT2, biz=BIZ2, did="d2")
    _as(OWNER)  # owner of BIZ, not BIZ2
    assert client.get("/api/v1/docs/d2").status_code == 403


def test_can_write_flag_reflects_role(sb):
    """get_doc tells the editor whether to be editable: writer=true, follower=false."""
    _seed_doc(sb)
    _as(CONTRIB)
    assert client.get("/api/v1/docs/d1").json()["can_write"] is True
    _as(FOLLOWER)
    assert client.get("/api/v1/docs/d1").json()["can_write"] is False


def test_missing_doc_404(sb):
    assert client.get("/api/v1/docs/nope").status_code == 404


def test_create_on_missing_initiative_404(sb):
    assert client.post("/api/v1/initiatives/ghost/docs", json={"title": "x"}).status_code == 404
