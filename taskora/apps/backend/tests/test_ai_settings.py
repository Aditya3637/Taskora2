"""Per-workspace BYO AI key — the Workspace-settings config that powers D4.

Runs the real businesses router against FakeSupabase. Pins the owner/admin-only
write-gate, the keep-on-omit / clear-on-empty key semantics, the last-4 masking
(the raw key is never returned), and that resolve_config / is_configured read the
workspace key (preferring it over any env fallback).
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from ai import program_summary
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

OWNER = "user-owner"
ADMIN = "user-admin"
MEMBER = "user-member"
OUTSIDER = "user-out"
BIZ = "biz-1"
_CUR = {"u": OWNER}


@pytest.fixture
def sb():
    s = FakeSupabase({
        "users": [
            {"id": OWNER, "name": "Owner"}, {"id": ADMIN, "name": "Admin"},
            {"id": MEMBER, "name": "Member"}, {"id": OUTSIDER, "name": "Out"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme"}],
        "business_members": [
            {"business_id": BIZ, "user_id": OWNER, "role": "owner"},
            {"business_id": BIZ, "user_id": ADMIN, "role": "admin"},
            {"business_id": BIZ, "user_id": MEMBER, "role": "member"},
        ],
        "business_ai_settings": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


# ── read state ───────────────────────────────────────────────────────────────

def test_get_defaults_when_unset(sb):
    b = client.get(f"/api/v1/businesses/{BIZ}/ai-settings").json()
    assert b["provider"] == "anthropic"
    assert b["key_set"] is False
    assert b["configured"] is False
    assert b["key_last4"] is None


def test_get_requires_admin(sb):
    _as(MEMBER)
    assert client.get(f"/api/v1/businesses/{BIZ}/ai-settings").status_code == 403


# ── set / mask ───────────────────────────────────────────────────────────────

def test_put_sets_key_and_masks(sb):
    r = client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                   json={"provider": "openai", "api_key": "sk-abcdEFGH3456", "model": "gpt-4o"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["provider"] == "openai"
    assert b["model"] == "gpt-4o"
    assert b["key_set"] is True
    assert b["key_last4"] == "3456"
    assert b["configured"] is True
    # The raw key never leaves the server.
    assert "sk-abcdEFGH3456" not in r.text
    # ...but it IS stored for the backend to use.
    assert sb.store["business_ai_settings"][0]["api_key"] == "sk-abcdEFGH3456"


def test_put_keep_on_omit_clear_on_empty(sb):
    client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
               json={"provider": "anthropic", "api_key": "sk-keepme9999"})
    # Omit api_key → keep the stored one, just change the model.
    b = client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                   json={"provider": "anthropic", "model": "claude-opus-4-8"}).json()
    assert b["key_set"] is True and b["key_last4"] == "9999"
    assert b["model"] == "claude-opus-4-8"
    # Empty string → clear it.
    b = client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                   json={"provider": "anthropic", "api_key": ""}).json()
    assert b["key_set"] is False and b["configured"] is False


def test_put_rejects_bad_provider(sb):
    r = client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                   json={"provider": "gemini", "api_key": "x"})
    assert r.status_code == 400


def test_put_admin_allowed_member_outsider_forbidden(sb):
    _as(ADMIN)
    assert client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                      json={"provider": "anthropic", "api_key": "sk-admin1234"}).status_code == 200
    _as(MEMBER)
    assert client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                      json={"provider": "anthropic", "api_key": "sk-x"}).status_code == 403
    _as(OUTSIDER)
    assert client.put(f"/api/v1/businesses/{BIZ}/ai-settings",
                      json={"provider": "anthropic", "api_key": "sk-x"}).status_code == 403


# ── resolve_config reads the workspace key ───────────────────────────────────

def test_resolve_config_uses_workspace_key(sb):
    assert program_summary.resolve_config(sb, BIZ) is None        # nothing set
    sb.store["business_ai_settings"] = [{
        "business_id": BIZ, "provider": "openai",
        "api_key": "sk-live-key", "model": "gpt-4o",
    }]
    cfg = program_summary.resolve_config(sb, BIZ)
    assert cfg == {"provider": "openai", "api_key": "sk-live-key", "model": "gpt-4o"}
    assert program_summary.is_configured(sb, BIZ) is True
    assert program_summary.effective_model(cfg) == "gpt-4o"


def test_effective_model_falls_back_to_provider_default():
    assert program_summary.effective_model({"provider": "anthropic", "model": None}) == "claude-opus-4-8"
    assert program_summary.effective_model({"provider": "openai", "model": None}) == "gpt-4o"
