"""D4 — AI program summary.

Runs the real programs router against FakeSupabase. The LLM call itself is
stubbed (no network): we monkeypatch `program_summary.generate_summary` /
`is_configured`, so these tests pin the *plumbing* — gather→generate→store, the
owner/admin/lead write-gate (N3), the configured/unconfigured states, the
member-wide read, tenant isolation, and the TipTap excerpt flattening.
"""
from datetime import date, timedelta

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
LEAD = "user-lead"        # plain member, but the program's lead_user_id
MEMBER = "user-member"    # plain member, no special role
OUTSIDER = "user-out"     # not a member of the business
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
            {"id": OWNER, "name": "Owner"}, {"id": ADMIN, "name": "Admin"},
            {"id": LEAD, "name": "Lead"}, {"id": MEMBER, "name": "Member"},
            {"id": OUTSIDER, "name": "Out"},
        ],
        "businesses": [{"id": BIZ, "name": "Acme"}],
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
        "initiatives": [
            {"id": "I1", "program_id": PROG, "business_id": BIZ, "name": "Slipping",
             "status": "active", "start_date": None, "target_end_date": _d(-10)},
        ],
        "tasks": [
            {"id": "T1", "title": "T1", "initiative_id": "I1", "status": "blocked",
             "due_date": _d(-5), "updated_at": _d(-1) + "T00:00:00+00:00",
             "created_at": "2026-05-01T00:00:00+00:00"},
        ],
        "program_key_results": [],
        "program_updates": [],
        "program_snapshots": [],
        "workspace_docs": [],
        "program_ai_summaries": [],
    })
    _CUR["u"] = OWNER
    app.dependency_overrides[get_current_user] = lambda: {"id": _CUR["u"]}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = OWNER


def _as(u):
    _CUR["u"] = u


def _enable(monkeypatch, gen=None, captured=None):
    """Make the AI integration look configured and stub the model call."""
    cfg = {"provider": "anthropic", "api_key": "sk-test", "model": None}
    monkeypatch.setattr(program_summary, "resolve_config", lambda *a, **k: cfg)
    monkeypatch.setattr(program_summary, "is_configured", lambda *a, **k: True)

    def default_gen(context, config=None):
        if captured is not None:
            captured["ctx"] = context
            captured["cfg"] = config
        return "## Where things stand\nHealth is **red** — Slipping is past its target date."

    monkeypatch.setattr(program_summary, "generate_summary", gen or default_gen)


# ── read / configured state ──────────────────────────────────────────────────

def test_get_when_none_and_unconfigured(sb):
    r = client.get(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["summary"] is None
    assert b["configured"] is False   # no ANTHROPIC_API_KEY in the test env


def test_get_reports_configured(sb, monkeypatch):
    _enable(monkeypatch)
    b = client.get(f"/api/v1/programs/{PROG}/ai-summary").json()
    assert b["configured"] is True
    assert b["summary"] is None


# ── regenerate: configured gate ──────────────────────────────────────────────

def test_regenerate_unconfigured_503(sb):
    r = client.post(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 503


def test_regenerate_returns_none_502(sb, monkeypatch):
    _enable(monkeypatch, gen=lambda ctx, cfg=None: None)
    r = client.post(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 502


# ── regenerate: authz (N3 — owner/admin/lead only) ───────────────────────────

@pytest.mark.parametrize("u", [OWNER, ADMIN, LEAD])
def test_regenerate_allowed_for_owner_admin_lead(sb, monkeypatch, u):
    _enable(monkeypatch)
    _as(u)
    r = client.post(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 201, r.text
    assert "red" in r.json()["summary"]["body"]


def test_regenerate_forbidden_for_plain_member(sb, monkeypatch):
    _enable(monkeypatch)
    _as(MEMBER)
    r = client.post(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 403


def test_regenerate_forbidden_for_outsider(sb, monkeypatch):
    _enable(monkeypatch)
    _as(OUTSIDER)
    r = client.post(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 403


def test_outsider_cannot_read(sb):
    _as(OUTSIDER)
    r = client.get(f"/api/v1/programs/{PROG}/ai-summary")
    assert r.status_code == 403


# ── regenerate → store → read-latest ─────────────────────────────────────────

def test_regenerate_then_member_reads_latest(sb, monkeypatch):
    _enable(monkeypatch)
    _as(OWNER)
    assert client.post(f"/api/v1/programs/{PROG}/ai-summary").status_code == 201
    # stored with the generating user + composite health snapshot
    row = sb.store["program_ai_summaries"][0]
    assert row["generated_by"] == OWNER
    assert row["health"] == "red"          # blocked+overdue+past-target → red
    assert row["business_id"] == BIZ

    _as(MEMBER)
    b = client.get(f"/api/v1/programs/{PROG}/ai-summary").json()
    assert b["summary"]["body"].startswith("## Where things stand")
    assert b["summary"]["generated_by_name"] == "Owner"


# ── the context the model is handed ──────────────────────────────────────────

def test_context_carries_live_signals_and_doc_excerpt(sb, monkeypatch):
    sb.store["workspace_docs"] = [{
        "id": "d1", "business_id": BIZ, "parent_type": "initiative",
        "parent_id": "I1", "title": "Plan", "archived_at": None,
        "body": {"type": "doc", "content": [
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Vendor migration is "},
                {"type": "text", "text": "blocked on procurement."},
            ]},
        ]},
    }]
    captured: dict = {}
    _enable(monkeypatch, captured=captured)
    _as(OWNER)
    assert client.post(f"/api/v1/programs/{PROG}/ai-summary").status_code == 201

    ctx = captured["ctx"]
    assert ctx["health"]["composite"] == "red"
    assert ctx["program"]["name"] == "Cost"
    names = [r["name"] for r in ctx["ranked_initiatives"]]
    assert "Slipping" in names
    excerpts = ctx["work_doc_excerpts"]
    assert excerpts and excerpts[0]["initiative"] == "Slipping"
    assert "blocked on procurement" in excerpts[0]["excerpt"]


# ── TipTap flattening unit ───────────────────────────────────────────────────

def test_doc_text_flattens_tiptap():
    body = {"type": "doc", "content": [
        {"type": "heading", "content": [{"type": "text", "text": "Goals"}]},
        {"type": "paragraph", "content": [
            {"type": "text", "text": "Ship "},
            {"type": "text", "text": "phase one."},
        ]},
    ]}
    out = program_summary.doc_text(body)
    assert "Goals" in out and "Ship phase one." in out


def test_doc_text_empty():
    assert program_summary.doc_text({}) == ""
    assert program_summary.doc_text(None) == ""
