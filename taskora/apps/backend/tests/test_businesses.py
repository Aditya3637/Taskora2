"""Business create/list tests.

Uses the in-memory FakeSupabase (same harness as test_onboarding) so the
real endpoint logic runs — the old hand-rolled MagicMock didn't model
create_business's "one workspace per owner" dedupe SELECT, so every
create 409'd. GET list path is slash-less: with redirect_slashes=False
the trailing-slash form only matches the POST route (-> 405).
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)
UID = "user-123"


@pytest.fixture
def sb():
    s = FakeSupabase({
        "businesses": [], "business_members": [], "subscriptions": [],
        "users": [{"id": UID, "name": "Tester", "email": "test@example.com"}],
    })
    app.dependency_overrides[get_current_user] = lambda: {
        "id": UID, "email": "test@example.com"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_create_business_returns_201(sb):
    r = client.post("/api/v1/businesses/",
                     json={"name": "Acme Corp", "type": "building"})
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Acme Corp"
    assert len(sb.store["businesses"]) == 1
    assert sb.store["business_members"][0]["role"] == "owner"


def test_create_business_invalid_type_returns_422(sb):
    r = client.post("/api/v1/businesses/",
                     json={"name": "Acme", "type": "invalid"})
    assert r.status_code == 422


def test_create_business_conflict_when_one_exists(sb):
    client.post("/api/v1/businesses/", json={"name": "A", "type": "building"})
    r = client.post("/api/v1/businesses/", json={"name": "B", "type": "building"})
    assert r.status_code == 409


def test_list_businesses_empty(sb):
    r = client.get("/api/v1/businesses")
    assert r.status_code == 200
    assert r.json() == []


def test_list_businesses_with_results(sb):
    sb.store["businesses"].append(
        {"id": "biz-456", "name": "Acme Corp", "type": "building",
         "owner_id": UID})
    sb.store["business_members"].append(
        {"business_id": "biz-456", "user_id": UID, "role": "owner"})
    r = client.get("/api/v1/businesses")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["id"] == "biz-456"
