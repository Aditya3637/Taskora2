"""Webhook idempotency / replay-guard tests for the Razorpay billing webhook.

The signature check proves authenticity, not freshness — so a captured,
validly-signed event can be replayed to manipulate subscription state. These
tests prove the dedup gate (migration 054 + the SELECT-first guard) refuses to
re-apply an event it has already processed.
"""
import sys
import types
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from main import app
from deps import get_supabase
from config import get_settings
from tests._fake_supabase import FakeSupabase

client = TestClient(app)


# A fake `razorpay` module so the handler's in-function `import razorpay` works
# without the real dependency, and signature verification always passes (we're
# testing the replay guard, not the HMAC).
def _install_fake_razorpay():
    mod = types.ModuleType("razorpay")

    class _Util:
        def verify_webhook_signature(self, payload, signature, secret):
            return True

    class _Client:
        def __init__(self, auth=None):
            self.utility = _Util()

    mod.Client = _Client
    sys.modules["razorpay"] = mod


def _seed():
    return {
        "subscriptions": [
            {
                "id": "S1", "business_id": "BIZ1",
                "razorpay_subscription_id": "sub_X", "status": "created",
                "current_period_end": None,
            }
        ],
        "processed_webhook_events": [],
        "platform_events": [],  # ev.emit target; best-effort
    }


@pytest.fixture(autouse=True)
def _wire():
    _install_fake_razorpay()
    sb = FakeSupabase(_seed())
    app.dependency_overrides[get_supabase] = lambda: sb
    app.dependency_overrides[get_settings] = lambda: SimpleNamespace(
        razorpay_key_id="rzp_test", razorpay_key_secret="secret",
    )
    yield sb
    app.dependency_overrides.clear()


def _charged_body(period_end=1893456000):
    return {
        "event": "subscription.charged",
        "payload": {"subscription": {"entity": {"id": "sub_X", "current_end": period_end}}},
    }


def _post(body, event_id):
    return client.post(
        "/api/v1/billing/razorpay-webhook",
        json=body,
        headers={"X-Razorpay-Signature": "sig", "X-Razorpay-Event-Id": event_id},
    )


def _sub(sb):
    return next(r for r in sb.store["subscriptions"] if r["id"] == "S1")


def test_first_delivery_is_applied(_wire):
    r = _post(_charged_body(), "evt_1")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert _sub(_wire)["status"] == "active"
    # Event recorded so a replay can be detected.
    assert any(e["event_id"] == "evt_1" for e in _wire.store["processed_webhook_events"])


def test_replay_is_refused_and_does_not_reapply(_wire):
    # First delivery activates.
    assert _post(_charged_body(), "evt_1").json() == {"ok": True}
    assert _sub(_wire)["status"] == "active"

    # Simulate the sub later going past_due (e.g. a real failed charge).
    _sub(_wire)["status"] = "past_due"

    # Replaying the captured `activated`/`charged` event must NOT silently
    # re-activate the subscription — the guard short-circuits.
    r = _post(_charged_body(), "evt_1")
    assert r.status_code == 200 and r.json() == {"ok": True, "duplicate": True}
    assert _sub(_wire)["status"] == "past_due"  # unchanged — replay blocked


def test_distinct_events_still_processed(_wire):
    assert _post(_charged_body(), "evt_1").json() == {"ok": True}
    # A genuinely different event id is applied (cancellation here).
    cancel = {"event": "subscription.cancelled",
              "payload": {"subscription": {"entity": {"id": "sub_X"}}}}
    r = _post(cancel, "evt_2")
    assert r.json() == {"ok": True}
    assert _sub(_wire)["status"] == "cancelled"


def test_replay_without_header_dedupes_on_body_hash(_wire):
    """No X-Razorpay-Event-Id → identical bodies still dedupe via body hash."""
    body = _charged_body()
    h = {"X-Razorpay-Signature": "sig"}  # note: no event-id header
    first = client.post("/api/v1/billing/razorpay-webhook", json=body, headers=h)
    assert first.json() == {"ok": True}
    _sub(_wire)["status"] = "past_due"
    second = client.post("/api/v1/billing/razorpay-webhook", json=body, headers=h)
    assert second.json() == {"ok": True, "duplicate": True}
    assert _sub(_wire)["status"] == "past_due"
