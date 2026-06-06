"""AI pass — in-document ✨ assistance (POST /docs/{id}/ai).

The LLM call (doc_assist.run_doc_assist) is monkeypatched so tests never hit the
network — we verify the gating, the not-configured path, action validation, and
the response shapes. Write-gated like the rest of the doc surface, so the matrix
mirrors test_doc_attachments / test_promote_task.
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
PROG, INIT, D1 = "prog-1", "init-1", "doc-1"
_CUR = {"u": OWNER}


@pytest.fixture(autouse=True)
def stub_llm(monkeypatch):
    """Replace the provider call with a deterministic canned result."""
    def fake_run(action, content, context, config):
        if action == "extract_actions":
            return {"kind": "actions", "actions": ["Call the vendor", "Update the SOW"]}
        return {"kind": "text", "text": f"[{action}] {content[:20]}"}
    monkeypatch.setattr("ai.doc_assist.run_doc_assist", fake_run)


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
        "tasks": [{"id": "t1", "initiative_id": INIT, "created_by": OWNER, "status": "todo"}],
        "task_stakeholders": [{"task_id": "t1", "user_id": CONTRIB, "role": "secondary"}],
        "initiative_followers": [{"initiative_id": INIT, "user_id": FOLLOWER}],
        "program_followers": [], "subtasks": [], "item_watchers": [],
        "program_key_results": [],
        "workspace_docs": [{"id": D1, "business_id": BIZ, "parent_type": "initiative",
                            "parent_id": INIT, "title": "Doc", "body": {}, "created_by": OWNER}],
        # A workspace AI key so resolve_config succeeds (no env key in tests).
        "business_ai_settings": [{"business_id": BIZ, "provider": "anthropic",
                                  "api_key": "sk-test", "model": None}],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u): _CUR["u"] = u
def _ai(action="enhance", **over): return client.post(f"/api/v1/docs/{D1}/ai", json={"action": action, **over})


def test_enhance_returns_text(sb):
    r = _ai("enhance", selection="rough notes here")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "text" and body["text"].startswith("[enhance]")


def test_extract_actions_returns_list(sb):
    r = _ai("extract_actions")
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "actions"
    assert r.json()["actions"] == ["Call the vendor", "Update the SOW"]


@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD, CONTRIB])
def test_write_set_can_use_ai(sb, u):
    _as(u)
    assert _ai("summarize").status_code == 200


def test_follower_and_stranger_and_outsider_blocked(sb):
    _as(FOLLOWER); assert _ai().status_code == 403       # read-only follower
    _as(STRANGER); assert _ai().status_code == 403       # unaligned member
    _as(OUTSIDER); assert _ai().status_code == 403       # non-member


def test_invalid_action_422(sb):
    assert _ai("translate").status_code == 422


def test_missing_doc_404(sb):
    assert client.post("/api/v1/docs/nope/ai", json={"action": "enhance"}).status_code == 404


def test_not_configured_503(sb):
    sb.store["business_ai_settings"] = []   # no workspace key, no env key in tests
    assert _ai("enhance").status_code == 503
