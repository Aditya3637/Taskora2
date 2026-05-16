"""Regression tests for the onboarding path (business + initiative).

create_business 500'd in production for *every* new customer (a stray
subscriptions.amount_inr column + bad on_conflict). It also wasn't
transactional, leaving an orphaned business that 409'd forever. These tests
lock in the fix and the compensating cleanup, using the in-memory fake that
enforces the real constraints.
"""
import pytest
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)
UID = "user-onb-1"


@pytest.fixture
def sb():
    s = FakeSupabase({
        "businesses": [], "business_members": [], "subscriptions": [],
        "initiatives": [], "initiative_entities": [],
        "users": [{"id": UID, "name": "Owner", "email": "o@x.io"}],
    })
    app.dependency_overrides[get_current_user] = lambda: {"id": UID,
                                                          "email": "o@x.io"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_create_business_succeeds_without_amount_inr(sb):
    """The exact production-blocking bug: must NOT touch subscriptions with a
    non-existent column / bad upsert. Trial sub is the DB trigger's job."""
    r = client.post("/api/v1/businesses/",
                     json={"name": "Acme", "type": "building",
                           "workspace_mode": "personal"})
    assert r.status_code == 201, r.text
    biz = r.json()
    assert biz["id"] and biz["name"] == "Acme"
    assert len(sb.store["businesses"]) == 1
    assert sb.store["business_members"][0] == {
        **sb.store["business_members"][0],
        "business_id": biz["id"], "user_id": UID, "role": "owner",
    }
    # App must not have written the trial subscription itself.
    assert sb.store["subscriptions"] == []


def test_create_business_conflict_when_one_exists(sb):
    client.post("/api/v1/businesses/",
                json={"name": "Acme", "type": "building"})
    r = client.post("/api/v1/businesses/",
                    json={"name": "Acme 2", "type": "building"})
    assert r.status_code == 409


def test_membership_failure_rolls_back_business(sb):
    """Compensating cleanup: if the owner-membership insert fails, the
    just-created business must be deleted so the user isn't permanently
    409-locked with an orphaned workspace."""
    sb.fail_inserts.add("business_members")
    r = client.post("/api/v1/businesses/",
                    json={"name": "Acme", "type": "building"})
    assert r.status_code == 500
    assert sb.store["businesses"] == []          # rolled back, not orphaned

    # And the user can now successfully create one (no stale 409).
    sb.fail_inserts.clear()
    r2 = client.post("/api/v1/businesses/",
                     json={"name": "Acme", "type": "building"})
    assert r2.status_code == 201
    assert len(sb.store["businesses"]) == 1


def test_get_my_business_and_list(sb):
    cr = client.post("/api/v1/businesses/",
                     json={"name": "Acme", "type": "building"}).json()
    r = client.get("/api/v1/businesses/my")
    assert r.status_code == 200 and r.json()["id"] == cr["id"]
    r2 = client.get("/api/v1/businesses")
    assert r2.status_code == 200 and any(b["id"] == cr["id"] for b in r2.json())


def test_create_initiative_under_business(sb):
    biz = client.post("/api/v1/businesses/",
                       json={"name": "Acme", "type": "building"}).json()
    r = client.post("/api/v1/initiatives/",
                    json={"name": "Q3 Audit", "business_id": biz["id"]})
    assert r.status_code == 201, r.text
    init = r.json()
    assert init["id"] and init["business_id"] == biz["id"]
    assert init["primary_stakeholder_id"] == UID  # defaults to caller


def test_create_initiative_requires_membership(sb):
    """Non-member cannot create an initiative under someone's business."""
    sb.store["businesses"].append({"id": "b-x", "name": "Other",
                                   "type": "building", "owner_id": "someone"})
    r = client.post("/api/v1/initiatives/",
                    json={"name": "X", "business_id": "b-x"})
    assert r.status_code == 403
