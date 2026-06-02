"""Lifecycle-automation tests: events, dispatch dedupe, the three campaign
scans (idempotent), the account-vs-users metric, the cron tick + its auth,
and the campaign kill switch.
"""
import types
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

from automation import events, dispatch, campaigns, runner
import automation.dispatch as dispatch_mod
import routers.internal as internal_mod

client = TestClient(app)

ADMIN = "user-admin"
OWNER = "user-owner"
EMP1 = "user-emp1"
NOW = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def iso(dt):
    return dt.isoformat()


def _seed(**over):
    data = {
        "users": [
            {"id": ADMIN, "name": "Admin", "email": "admin@x.dev"},
            {"id": OWNER, "name": "Owner", "email": "owner@x.dev", "phone": None},
            {"id": EMP1, "name": "Emp", "email": "emp@x.dev"},
        ],
        "platform_admins": [{"user_id": ADMIN}],
        "businesses": [{"id": "biz1", "name": "Acme", "owner_id": OWNER, "created_at": iso(NOW - timedelta(days=20))}],
        "business_members": [
            {"business_id": "biz1", "user_id": OWNER},
            {"business_id": "biz1", "user_id": EMP1},
        ],
        "subscriptions": [],
        "platform_events": [],
        "messages": [],
        "automation_jobs": [],
        "automation_settings": [],
        "initiatives": [{"id": "i1", "business_id": "biz1"}],
    }
    data.update(over)
    return FakeSupabase(data)


@pytest.fixture(autouse=True)
def _no_real_sends(monkeypatch):
    # Make email/push deterministic 'sent' so we can assert behaviour.
    monkeypatch.setattr(dispatch_mod, "send_email", lambda **kw: True)
    monkeypatch.setattr(dispatch_mod, "send_push_to_user", lambda *a, **k: None)


# ── events + dispatch ──────────────────────────────────────────────────────
def test_emit_writes_event():
    sb = _seed()
    events.emit(sb, events.SIGNUP, user_id=OWNER, business_id="biz1", props={"x": 1})
    rows = sb.table("platform_events").select("*").execute().data
    assert len(rows) == 1 and rows[0]["type"] == "user_signed_up"


def test_dispatch_dedupes():
    sb = _seed()
    user = {"id": OWNER, "email": "owner@x.dev"}
    r1 = dispatch.send(sb, channel="inapp", template="welcome", ctx={}, user=user,
                       business_id="biz1", dedupe_key="k1", campaign="welcome")
    r2 = dispatch.send(sb, channel="inapp", template="welcome", ctx={}, user=user,
                       business_id="biz1", dedupe_key="k1", campaign="welcome")
    assert r1["status"] == "sent"
    assert r2["status"] == "suppressed"
    assert len(sb.table("messages").select("*").execute().data) == 1


# ── trial reminders ────────────────────────────────────────────────────────
def test_trial_reminder_sends_once():
    sb = _seed(subscriptions=[
        {"business_id": "biz1", "status": "trialing", "plan": "pro", "trial_end": iso(NOW + timedelta(hours=20))},
    ])
    assert campaigns.run_trial_reminders(sb, NOW) == 1
    msgs = sb.table("messages").select("*").execute().data
    assert len(msgs) == 1 and msgs[0]["template"] == "trial_ending_1" and msgs[0]["status"] == "sent"
    # Idempotent: a second scan sends nothing more.
    assert campaigns.run_trial_reminders(sb, NOW) == 0
    assert len(sb.table("messages").select("*").execute().data) == 1


def test_trial_window_picks_right_template():
    sb = _seed(subscriptions=[
        {"business_id": "biz1", "status": "trialing", "plan": "pro", "trial_end": iso(NOW + timedelta(days=5))},
    ])
    campaigns.run_trial_reminders(sb, NOW)
    assert sb.table("messages").select("*").execute().data[0]["template"] == "trial_ending_7"


# ── dunning ────────────────────────────────────────────────────────────────
def test_dunning_escalates_by_days():
    sb = _seed(subscriptions=[
        {"business_id": "biz1", "status": "past_due", "plan": "business",
         "current_period_end": iso(NOW - timedelta(days=4))},
    ])
    assert campaigns.run_dunning(sb, NOW) == 1
    # 4 days past due → stage payment_failed_3 (>=3, <7).
    assert sb.table("messages").select("*").execute().data[0]["template"] == "payment_failed_3"


# ── activation ─────────────────────────────────────────────────────────────
def test_activation_invite_team_on_single_seat():
    sb = _seed(
        businesses=[{"id": "biz1", "name": "Solo", "owner_id": OWNER, "created_at": iso(NOW - timedelta(days=3))}],
        business_members=[{"business_id": "biz1", "user_id": OWNER}],  # 1 seat
    )
    assert campaigns.run_activation(sb, NOW) == 1
    assert sb.table("messages").select("*").execute().data[0]["template"] == "activation_invite_team"


def test_activation_no_initiative_on_day1():
    sb = _seed(
        businesses=[{"id": "biz1", "name": "New", "owner_id": OWNER, "created_at": iso(NOW - timedelta(days=1, hours=2))}],
        initiatives=[],  # none yet
    )
    assert campaigns.run_activation(sb, NOW) == 1
    assert sb.table("messages").select("*").execute().data[0]["template"] == "activation_no_initiative"


# ── kill switch ────────────────────────────────────────────────────────────
def test_campaign_kill_switch():
    sb = _seed(
        subscriptions=[{"business_id": "biz1", "status": "trialing", "plan": "pro", "trial_end": iso(NOW + timedelta(hours=20))}],
        automation_settings=[{"campaign": "trial", "enabled": False}],
    )
    assert campaigns.run_trial_reminders(sb, NOW) == 0


# ── account vs users (the "100 users ≠ 1 sale" guarantee) ──────────────────
def test_account_metrics_separates_users_from_sales():
    sb = _seed(subscriptions=[{"business_id": "biz1", "status": "active", "plan": "pro"}])
    app.dependency_overrides[get_current_user] = lambda: {"id": ADMIN}
    app.dependency_overrides[get_supabase] = lambda: sb
    try:
        r = client.get("/api/v1/admin/metrics/accounts")
        assert r.status_code == 200
        d = r.json()
        # 3 users, but only ONE paying account (one sale) covering all seats.
        assert d["total_users"] == 3
        assert d["paying_accounts"] == 1
        assert d["paid_seats"] == 2
        assert d["mrr"] == 999
        assert d["users_per_paying_account"] == 3.0
    finally:
        app.dependency_overrides.clear()


# ── cron tick + auth + manual run ──────────────────────────────────────────
def test_cron_tick_requires_secret(monkeypatch):
    sb = _seed()
    monkeypatch.setattr(internal_mod, "get_settings", lambda: types.SimpleNamespace(cron_secret="s3cr3t"))
    app.dependency_overrides[get_supabase] = lambda: sb
    try:
        assert client.get("/api/v1/internal/cron/tick").status_code == 401
        ok = client.get("/api/v1/internal/cron/tick", headers={"X-Cron-Secret": "s3cr3t"})
        assert ok.status_code == 200
        body = ok.json()
        assert "trial_reminders" in body and "dunning" in body and "jobs" in body
    finally:
        app.dependency_overrides.clear()


def test_cron_disabled_without_secret(monkeypatch):
    sb = _seed()
    monkeypatch.setattr(internal_mod, "get_settings", lambda: types.SimpleNamespace(cron_secret=None))
    app.dependency_overrides[get_supabase] = lambda: sb
    try:
        assert client.get("/api/v1/internal/cron/tick").status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_runner_tick_runs_all_scans():
    sb = _seed(subscriptions=[
        {"business_id": "biz1", "status": "trialing", "plan": "pro", "trial_end": iso(NOW + timedelta(hours=20))},
    ])
    out = runner.tick(sb, NOW)
    assert out["trial_reminders"] == 1
    assert "dunning" in out and "activation" in out and "jobs" in out
