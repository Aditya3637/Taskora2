"""Notebook convergence N-3 — page AI assist (POST /notebook/pages/{id}/ai).

The LLM call is monkeypatched. Verifies write-gate, workspace-membership gate
(the personal notebook borrows the active workspace's AI key), not-configured,
action validation, and response shapes.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER, OTHER, OUTSIDER = "u-owner", "u-other", "u-out"
BIZ = "biz-1"
PG = "pg-1"
_CUR = {"u": OWNER}


@pytest.fixture(autouse=True)
def stub_llm(monkeypatch):
    def fake_run(action, content, context, config):
        if action == "extract_actions":
            return {"kind": "actions", "actions": ["Buy milk", "Email Sam"]}
        return {"kind": "text", "text": f"[{action}] {content[:15]}"}
    monkeypatch.setattr("ai.doc_assist.run_doc_assist", fake_run)


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [{"id": u, "name": u} for u in (OWNER, OTHER, OUTSIDER)],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": OTHER, "role": "member"},
        ],
        "notebook_pages": [{"id": PG, "owner_id": OWNER, "title": "My note",
                            "body": [], "body_doc": {"type": "doc", "content": []},
                            "format": "pm", "archived_at": None}],
        "notebook_page_followers": [],
        "business_ai_settings": [{"business_id": BIZ, "provider": "anthropic",
                                  "api_key": "sk-test", "model": None}],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _ai(action="enhance", biz=BIZ, **over):
    return client.post(f"/api/v1/notebook/pages/{PG}/ai?business_id={biz}", json={"action": action, **over})


def test_owner_enhance_text(sb):
    r = _ai("enhance", selection="some notes")
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "text" and r.json()["text"].startswith("[enhance]")


def test_extract_actions(sb):
    r = _ai("extract_actions")
    assert r.status_code == 200 and r.json()["actions"] == ["Buy milk", "Email Sam"]


def test_non_owner_writer_blocked(sb):
    # OTHER isn't the owner and isn't a page follower → read-only/not visible.
    _CUR["u"] = OTHER
    assert _ai().status_code in (403, 404)


def test_non_member_of_workspace_403(sb):
    # Owner of the page but not a member of the workspace whose key is requested.
    sb.store["business_members"] = [{"business_id": BIZ, "user_id": OTHER, "role": "member"}]
    assert _ai().status_code == 403  # OWNER no longer a member of BIZ


def test_invalid_action_422(sb):
    assert _ai("frobnicate").status_code == 422


def test_not_configured_503(sb):
    sb.store["business_ai_settings"] = []
    assert _ai("summarize").status_code == 503


def test_missing_page_404(sb):
    assert client.post(f"/api/v1/notebook/pages/nope/ai?business_id={BIZ}", json={"action": "enhance"}).status_code == 404
