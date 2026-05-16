"""Tests for the Daily Brief / War Room decision-context overhaul.

Covers the shared enrichment helper, the new brief sections
(awaiting_approval / tat_breaches), scope/filter/group_by, the enriched
War Room queue, and the Battlefield portfolio endpoint — using the
constraint-enforcing in-memory fake.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

ME = "u-me"
MATE = "u-mate"
OUT = "u-out"
_CUR = {"u": ME}

TODAY = date.today()
LONG_AGO = (TODAY - timedelta(days=20)).isoformat()
OVERDUE = (TODAY - timedelta(days=10)).isoformat()
SOON = (TODAY + timedelta(days=2)).isoformat()


def _seed():
    return {
        "users": [
            {"id": ME, "name": "Me", "email": "me@x.io"},
            {"id": MATE, "name": "Mate", "email": "mate@x.io"},
            {"id": OUT, "name": "Out", "email": "out@x.io"},
        ],
        "businesses": [{"id": "BIZ", "name": "Acme", "type": "building"}],
        "business_members": [{"business_id": "BIZ", "user_id": ME, "role": "owner"}],
        "programs": [{"id": "PROG", "name": "Cost Cutting"}],
        "initiatives": [
            {"id": "INI", "name": "Energy", "business_id": "BIZ",
             "program_id": "PROG", "owner_id": ME, "status": "active"},
        ],
        "tasks": [
            {  # overdue + tat breach + has approver + pending approval
                "id": "T1", "title": "Replace meters", "status": "in_progress",
                "priority": "high", "due_date": OVERDUE, "initiative_id": "INI",
                "primary_stakeholder_id": ME, "approval_state": "pending",
                "closed_at": LONG_AGO, "blocker_reason": None,
                "description": "swap 40 meters", "updated_at": LONG_AGO,
                "created_at": LONG_AGO},
            {  # blocked + stale -> tat breach
                "id": "T2", "title": "Vendor PO", "status": "blocked",
                "priority": "urgent", "due_date": SOON, "initiative_id": "INI",
                "primary_stakeholder_id": ME, "approval_state": "none",
                "closed_at": None, "blocker_reason": "awaiting PO #1182",
                "description": None, "updated_at": LONG_AGO,
                "created_at": LONG_AGO},
            {  # pending_decision, due soon
                "id": "T3", "title": "Pick HVAC vendor", "status": "pending_decision",
                "priority": "medium", "due_date": SOON, "initiative_id": "INI",
                "primary_stakeholder_id": ME, "approval_state": "none",
                "closed_at": None, "updated_at": TODAY.isoformat(),
                "created_at": TODAY.isoformat()},
            {  # team-only: ME is not a stakeholder, but is a BIZ member
                "id": "T4", "title": "Audit (someone else's)", "status": "blocked",
                "priority": "low", "due_date": SOON, "initiative_id": "INI",
                "primary_stakeholder_id": OUT, "approval_state": "none",
                "closed_at": None, "updated_at": TODAY.isoformat(),
                "created_at": TODAY.isoformat()},
        ],
        "task_stakeholders": [
            {"task_id": "T1", "user_id": ME, "role": "primary"},
            {"task_id": "T1", "user_id": MATE, "role": "contributor"},
            {"task_id": "T2", "user_id": ME, "role": "primary"},
            {"task_id": "T3", "user_id": ME, "role": "primary"},
        ],
        "task_entities": [],
        "subtasks": [
            {"id": "S1", "task_id": "T1", "status": "done"},
            {"id": "S2", "task_id": "T1", "status": "todo"},
        ],
        "comments": [
            {"id": "C1", "task_id": "T1", "user_id": MATE, "kind": "note",
             "content": "Quote came in 12% under budget", "created_at": LONG_AGO},
            {"id": "C2", "task_id": "T1", "user_id": ME, "kind": "note",
             "content": "Latest: ready for your approval", "created_at": SOON},
        ],
        "item_watchers": [
            {"id": "W1", "task_id": "T1", "user_id": MATE, "role": "approver",
             "scope_type": "task", "subtask_id": None, "entity_id": None},
        ],
    }


@pytest.fixture
def sb():
    s = FakeSupabase(_seed())
    app.dependency_overrides[get_current_user] = lambda: {
        "id": _CUR["u"], "email": f"{_CUR['u']}@x.io"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()
    _CUR["u"] = ME


# ── Daily Brief ──────────────────────────────────────────────────────────────

def test_brief_enriches_each_task(sb):
    _CUR["u"] = ME
    b = client.get("/api/v1/daily-brief").json()
    t1 = next(t for t in b["overdue_tasks"] if t["id"] == "T1")
    assert t1["link"] == {"type": "task", "task_id": "T1", "subtask_id": None,
                          "initiative_id": "INI", "program_id": "PROG"}
    assert t1["initiative_name"] == "Energy"
    assert t1["program_name"] == "Cost Cutting"
    assert t1["primary_stakeholder_name"] == "Me"
    assert t1["days_overdue"] == 10
    assert t1["open_subtasks"] == 1 and t1["done_subtasks"] == 1 and t1["total_subtasks"] == 2
    # newest comment wins, author resolved
    assert t1["last_comment"]["snippet"].startswith("Latest: ready")
    assert t1["last_comment"]["author_name"] == "Me"
    # approver surfaced only while pending
    assert t1["pending_approvers"] == ["Mate"]
    assert {"user_id": MATE, "role": "contributor", "name": "Mate"} in t1["secondary_stakeholders"]


def test_brief_new_sections(sb):
    _CUR["u"] = ME
    b = client.get("/api/v1/daily-brief").json()
    assert {t["id"] for t in b["awaiting_approval"]} == {"T1"}
    breach_ids = {t["id"] for t in b["tat_breaches"]}
    assert "T1" in breach_ids and "T2" in breach_ids   # overdue>7d ; blocked+stale
    assert b["quick_stats"]["awaiting_approval_count"] == 1
    assert b["blocked_tasks"][0]["blocker_reason"] == "awaiting PO #1182"


def test_brief_back_compat_shape(sb):
    _CUR["u"] = OUT  # member of nothing, stakeholder of nothing relevant
    b = client.get("/api/v1/daily-brief").json()
    for k in ("pending_decisions", "overdue_tasks", "stale_tasks",
              "due_this_week", "blocked_tasks", "initiative_progress"):
        assert k in b and isinstance(b[k], list)
    assert b["pending_decisions"] == []


def test_brief_scope_team_includes_others_tasks(sb):
    _CUR["u"] = ME  # owner/member of BIZ
    mine = client.get("/api/v1/daily-brief?scope=mine").json()
    team = client.get("/api/v1/daily-brief?scope=team").json()
    assert "T4" not in {t["id"] for t in mine["blocked_tasks"]}
    assert "T4" in {t["id"] for t in team["blocked_tasks"]}


def test_brief_program_filter_and_groups(sb):
    _CUR["u"] = ME
    b = client.get("/api/v1/daily-brief?scope=team&program=PROG&group_by=program").json()
    assert b["filters"]["program"] == "PROG"
    g = next(g for g in b["groups"] if g["id"] == "PROG")
    assert g["link"] == {"type": "program", "task_id": None, "subtask_id": None,
                         "initiative_id": None, "program_id": "PROG"}
    assert g["blocked"] >= 2  # T2 + T4
    none_match = client.get("/api/v1/daily-brief?scope=team&program=NOPE").json()
    assert none_match["overdue_tasks"] == [] and none_match["blocked_tasks"] == []


def test_brief_initiative_progress_has_link(sb):
    _CUR["u"] = ME
    b = client.get("/api/v1/daily-brief").json()
    ip = next(i for i in b["initiative_progress"] if i["id"] == "INI")
    assert ip["program_name"] == "Cost Cutting"
    assert ip["link"]["type"] == "initiative" and ip["link"]["initiative_id"] == "INI"
    assert ip["blocked"] >= 1 and ip["awaiting_approval"] == 1


# ── War Room ─────────────────────────────────────────────────────────────────

def test_war_room_queue_enriched(sb):
    _CUR["u"] = ME
    q = client.get("/api/v1/war-room/queue").json()
    assert q["counts"]["pending"] >= 1 and q["counts"]["blocked"] >= 1
    t = next(x for x in q["queue"] if x["id"] == "T2")
    assert t["initiative_name"] == "Energy"
    assert t["link"]["task_id"] == "T2"
    assert "age_label" in t and "is_overdue" in t


def test_battlefield_initiatives_portfolio(sb):
    _CUR["u"] = ME
    r = client.get("/api/v1/war-room/battlefield/initiatives").json()
    ini = next(i for i in r["initiatives"] if i["initiative_id"] == "INI")
    assert ini["name"] == "Energy"
    assert ini["program_name"] == "Cost Cutting"
    assert ini["primary_owner_name"] == "Me"
    assert ini["total"] == 4 and ini["blocked"] == 2 and ini["awaiting_approval"] == 1
    assert ini["link"]["initiative_id"] == "INI"
    assert client.get("/api/v1/war-room/battlefield/initiatives?program=NOPE").json()["initiatives"] == []
