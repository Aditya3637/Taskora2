"""Notebook router tests.

Covers the critical authz + flow paths:
- User-scoped isolation (User A cannot see User B's pages/projects)
- Page sharing (viewer reads, editor writes, owner shares)
- Goals upsert + owner-only
- Checklist tabs (mine vs assigned)
- Assignment flow end-to-end (create → inbox → accept → promote → done)
- Cross-workspace assignment forbidden
- Self-assign forbidden
- People picker partitions in_workspace vs external
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

ALICE = "user-alice"
BOB = "user-bob"
CAROL = "user-carol"  # in a different workspace
BIZ_A = "biz-a"
BIZ_B = "biz-b"


def _seed():
    return FakeSupabase({
        # Shared workspace A: alice + bob. Workspace B: carol only.
        "users": [
            {"id": ALICE, "name": "Alice", "email": "alice@example.com"},
            {"id": BOB, "name": "Bob", "email": "bob@example.com"},
            {"id": CAROL, "name": "Carol", "email": "carol@example.com"},
        ],
        "business_members": [
            {"business_id": BIZ_A, "user_id": ALICE, "role": "owner"},
            {"business_id": BIZ_A, "user_id": BOB, "role": "member"},
            {"business_id": BIZ_B, "user_id": CAROL, "role": "owner"},
        ],
        "notebook_projects": [],
        "notebook_pages": [],
        "notebook_page_followers": [],
        "notebook_goals": [],
        "notebook_checklist_items": [],
        "notebook_assignments": [],
    })


def _as(uid: str):
    app.dependency_overrides[get_current_user] = lambda: {"id": uid}


@pytest.fixture
def sb():
    s = _seed()
    _as(ALICE)
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


# ─── Projects + isolation ────────────────────────────────────────────

def test_projects_are_user_scoped(sb):
    r = client.post("/api/v1/notebook/projects", json={"name": "Q4"})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    # Bob shouldn't see Alice's project
    _as(BOB)
    r = client.get("/api/v1/notebook/projects")
    assert r.status_code == 200
    assert r.json() == []

    # Bob can't update Alice's project either
    r = client.patch(f"/api/v1/notebook/projects/{pid}", json={"name": "Hijacked"})
    assert r.status_code == 404


def test_pages_owner_only_until_shared(sb):
    proj = client.post("/api/v1/notebook/projects", json={"name": "P"}).json()
    page = client.post("/api/v1/notebook/pages",
                       json={"project_id": proj["id"], "title": "Secret"}).json()

    _as(BOB)
    r = client.get(f"/api/v1/notebook/pages/{page['id']}")
    assert r.status_code == 404


def test_trash_restore_and_purge(sb):
    # Create two pages, delete (soft-archive) one.
    keep = client.post("/api/v1/notebook/pages", json={"title": "Keep"}).json()
    gone = client.post("/api/v1/notebook/pages", json={"title": "Gone"}).json()
    assert client.delete(f"/api/v1/notebook/pages/{gone['id']}").status_code == 204

    # Live list excludes the archived page; trash shows only it.
    live = client.get("/api/v1/notebook/pages").json()
    assert {p["id"] for p in live} == {keep["id"]}
    trash = client.get("/api/v1/notebook/pages/trash").json()
    assert [p["id"] for p in trash] == [gone["id"]]

    # Restore brings it back to the live list and clears it from trash.
    r = client.post(f"/api/v1/notebook/pages/{gone['id']}/restore")
    assert r.status_code == 200 and r.json()["archived_at"] is None
    assert client.get("/api/v1/notebook/pages/trash").json() == []
    live = client.get("/api/v1/notebook/pages").json()
    assert {p["id"] for p in live} == {keep["id"], gone["id"]}

    # Re-delete, then purge for good — gone from both lists.
    client.delete(f"/api/v1/notebook/pages/{gone['id']}")
    assert client.delete(f"/api/v1/notebook/pages/{gone['id']}/permanent").status_code == 204
    assert client.get("/api/v1/notebook/pages/trash").json() == []


def test_trash_is_owner_only(sb):
    page = client.post("/api/v1/notebook/pages", json={"title": "Mine"}).json()
    client.delete(f"/api/v1/notebook/pages/{page['id']}")

    _as(BOB)
    # Bob never sees Alice's trash, and can't restore or purge her page.
    assert client.get("/api/v1/notebook/pages/trash").json() == []
    assert client.post(f"/api/v1/notebook/pages/{page['id']}/restore").status_code == 403
    assert client.delete(f"/api/v1/notebook/pages/{page['id']}/permanent").status_code == 403


def test_restore_orphans_page_when_project_archived(sb):
    proj = client.post("/api/v1/notebook/projects", json={"name": "P"}).json()
    page = client.post("/api/v1/notebook/pages",
                       json={"project_id": proj["id"], "title": "Child"}).json()
    client.delete(f"/api/v1/notebook/pages/{page['id']}")
    client.delete(f"/api/v1/notebook/projects/{proj['id']}")  # archive the project

    restored = client.post(f"/api/v1/notebook/pages/{page['id']}/restore").json()
    # Project gone → page moved to Unfiled so it stays visible.
    assert restored["project_id"] is None


def test_search_matches_title_and_body(sb):
    p1 = client.post("/api/v1/notebook/pages", json={
        "title": "Budget plan",
        "body": [{"id": "b1", "type": "text", "text": "hire a designer in Q3"}],
    }).json()
    client.post("/api/v1/notebook/pages", json={
        "title": "Random",
        "body": [{"id": "b1", "type": "text", "text": "nothing relevant here"}],
    }).json()

    # Body-only match returns the page + a snippet containing the term.
    r = client.get("/api/v1/notebook/search?q=designer")
    assert r.status_code == 200
    pages = r.json()["pages"]
    assert [p["id"] for p in pages] == [p1["id"]]
    assert "designer" in pages[0]["snippet"].lower()

    # Multi-token AND over the title.
    r = client.get("/api/v1/notebook/search?q=budget plan").json()
    assert [p["id"] for p in r["pages"]] == [p1["id"]]

    # Empty / blank query → no work.
    assert client.get("/api/v1/notebook/search?q=").json() == {"pages": [], "checklist": []}


def test_search_ignores_image_data_and_archived_and_is_scoped(sb):
    # Image src (a fake data URL) must NOT be searchable; caption is.
    client.post("/api/v1/notebook/pages", json={
        "title": "Trip",
        "body": [{"id": "b1", "type": "image",
                  "src": "data:image/jpeg;base64,SECRETTOKEN", "caption": "beach sunset"}],
    }).json()
    r = client.get("/api/v1/notebook/search?q=SECRETTOKEN").json()
    assert r["pages"] == []
    r = client.get("/api/v1/notebook/search?q=sunset").json()
    assert len(r["pages"]) == 1

    # Checklist items are searched; archived pages are not.
    client.post("/api/v1/notebook/checklist", json={"content": "call the vendor"})
    gone = client.post("/api/v1/notebook/pages", json={"title": "vendor secret"}).json()
    client.delete(f"/api/v1/notebook/pages/{gone['id']}")
    r = client.get("/api/v1/notebook/search?q=vendor").json()
    assert any(c["content"] == "call the vendor" for c in r["checklist"])
    assert gone["id"] not in [p["id"] for p in r["pages"]]

    # Another user sees none of it.
    _as(BOB)
    r2 = client.get("/api/v1/notebook/search?q=vendor").json()
    assert r2 == {"pages": [], "checklist": []}


def test_share_grants_read_but_not_write(sb):
    page = client.post("/api/v1/notebook/pages", json={"title": "Meeting"}).json()
    pid = page["id"]
    r = client.post(f"/api/v1/notebook/pages/{pid}/followers",
                    json={"user_id": BOB, "role": "viewer"})
    assert r.status_code == 201

    _as(BOB)
    r = client.get(f"/api/v1/notebook/pages/{pid}")
    assert r.status_code == 200
    # Viewer can't edit
    r = client.patch(f"/api/v1/notebook/pages/{pid}", json={"title": "Hacked"})
    assert r.status_code == 403


def test_promoted_editor_can_write(sb):
    page = client.post("/api/v1/notebook/pages", json={"title": "Spec"}).json()
    pid = page["id"]
    client.post(f"/api/v1/notebook/pages/{pid}/followers",
                json={"user_id": BOB, "role": "editor"})

    _as(BOB)
    r = client.patch(f"/api/v1/notebook/pages/{pid}",
                     json={"body": [{"id": "b1", "type": "text", "text": "hi"}]})
    assert r.status_code == 200
    # But editor can't move a page between projects (owner-only)
    r = client.patch(f"/api/v1/notebook/pages/{pid}", json={"project_id": None})
    # Already null, will pass through to _own_project_or_404? Actually
    # null is allowed but the owner-check fires first. Confirm it's a 403.
    assert r.status_code == 403


def test_only_owner_can_share(sb):
    page = client.post("/api/v1/notebook/pages", json={"title": "Doc"}).json()

    _as(BOB)
    r = client.post(f"/api/v1/notebook/pages/{page['id']}/followers",
                    json={"user_id": CAROL, "role": "viewer"})
    assert r.status_code in (403, 404)  # 404 if Bob can't see the page at all


def test_cross_workspace_share_blocked(sb):
    page = client.post("/api/v1/notebook/pages", json={"title": "Doc"}).json()
    # Carol shares no workspace with Alice
    r = client.post(f"/api/v1/notebook/pages/{page['id']}/followers",
                    json={"user_id": CAROL, "role": "viewer"})
    assert r.status_code == 403


# ─── Goals ───────────────────────────────────────────────────────────

def test_goals_lazy_create_and_upsert(sb):
    r = client.get("/api/v1/notebook/goals")
    assert r.status_code == 200
    assert r.json()["body"] == []

    r = client.put("/api/v1/notebook/goals", json={"body": ["Ship v1"]})
    assert r.status_code == 200
    assert r.json()["body"] == ["Ship v1"]

    # Second user sees their own empty goals, not Alice's
    _as(BOB)
    r = client.get("/api/v1/notebook/goals")
    assert r.status_code == 200
    assert r.json()["body"] == []


# ─── Checklist ───────────────────────────────────────────────────────

def test_checklist_mine_tab(sb):
    r = client.post("/api/v1/notebook/checklist",
                    json={"content": "Buy oat milk"})
    assert r.status_code == 201
    r = client.get("/api/v1/notebook/checklist?tab=mine")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_assignment_flow_end_to_end(sb):
    """Alice assigns to Bob → Bob's inbox → accept → promotes to Bob's
    checklist → Bob marks done → assignment status flips to 'done'."""
    page = client.post("/api/v1/notebook/pages", json={"title": "Sprint plan"}).json()
    pid = page["id"]
    r = client.post("/api/v1/notebook/assignments", json={
        "recipient_id": BOB,
        "content": "draft the deck",
        "source_page_id": pid,
        "source_block_id": "blk-1",
    })
    assert r.status_code == 201, r.text
    aid = r.json()["id"]

    # Bob's inbox count
    _as(BOB)
    r = client.get("/api/v1/notebook/checklist/assigned-count")
    assert r.status_code == 200 and r.json()["count"] == 1

    # Inbox list
    r = client.get("/api/v1/notebook/checklist?tab=assigned")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["sender_name"] == "Alice"

    # Accept
    r = client.post(f"/api/v1/notebook/assignments/{aid}/accept")
    assert r.status_code == 200
    item_id = r.json()["checklist_item_id"]
    assert item_id

    # Now Bob's mine tab shows it
    r = client.get("/api/v1/notebook/checklist?tab=mine")
    assert r.status_code == 200
    assert any(i["id"] == item_id for i in r.json())

    # Mark done → assignment flips
    r = client.patch(f"/api/v1/notebook/checklist/{item_id}", json={"status": "done"})
    assert r.status_code == 200

    # Alice (sender) sees the assignment as 'done' on /assignments/sent
    _as(ALICE)
    r = client.get(f"/api/v1/notebook/assignments/sent?source_page_id={pid}")
    assert r.status_code == 200
    rows = r.json()
    assert rows and rows[0]["status"] == "done"


def test_cross_workspace_assignment_blocked(sb):
    r = client.post("/api/v1/notebook/assignments", json={
        "recipient_id": CAROL,
        "content": "do thing",
    })
    assert r.status_code == 403


def test_self_assignment_blocked(sb):
    r = client.post("/api/v1/notebook/assignments", json={
        "recipient_id": ALICE,
        "content": "self",
    })
    assert r.status_code == 400


# ─── People picker ───────────────────────────────────────────────────

def test_people_picker_partitions_workspace_vs_external(sb):
    r = client.get("/api/v1/notebook/people-picker?q=")
    assert r.status_code == 200
    data = r.json()
    in_ws_ids = {u["id"] for u in data["in_workspace"]}
    assert BOB in in_ws_ids
    assert ALICE not in in_ws_ids  # caller excluded
    # Carol is in a different workspace → not in in_workspace
    assert CAROL not in in_ws_ids


def test_people_picker_external_search_needs_two_chars(sb):
    # Empty query → no external results
    r = client.get("/api/v1/notebook/people-picker?q=")
    assert r.json()["external"] == []

    # 2+ char query finds Carol by name
    r = client.get("/api/v1/notebook/people-picker?q=Car")
    ext_ids = {u["id"] for u in r.json()["external"]}
    assert CAROL in ext_ids


def test_decline_marks_status(sb):
    r = client.post("/api/v1/notebook/assignments", json={
        "recipient_id": BOB,
        "content": "thing",
    })
    aid = r.json()["id"]

    _as(BOB)
    r = client.post(f"/api/v1/notebook/assignments/{aid}/decline")
    assert r.status_code == 200
    # Sender side
    _as(ALICE)
    r = client.get("/api/v1/notebook/assignments/sent")
    assert r.status_code == 200
    assert r.json()[0]["status"] == "declined"
