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


def test_second_workspace_joins_same_company(sb):
    """A company owns many workspaces: a 2nd owned workspace is allowed (no
    cap) and auto-joins the company created for the 1st."""
    r1 = client.post("/api/v1/businesses/", json={"name": "A", "type": "building"})
    assert r1.status_code == 201
    r2 = client.post("/api/v1/businesses/", json={"name": "B", "type": "building"})
    assert r2.status_code == 201, r2.text
    # Exactly one company; both workspaces roll under it.
    assert len(sb.store.get("companies", [])) == 1
    mine = client.get("/api/v1/businesses/mine").json()
    company_ids = {m.get("company_id") for m in mine}
    assert len(company_ids) == 1 and None not in company_ids


def test_delete_workspace_requires_owner(sb):
    """Non-owner gets 403 even if they're an admin member."""
    r = client.post("/api/v1/businesses/", json={"name": "Owned", "type": "building"})
    biz_id = r.json()["id"]
    # Pretend we're a different user
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "other-user", "email": "other@example.com"}
    sb.store["business_members"].append(
        {"business_id": biz_id, "user_id": "other-user", "role": "admin"}
    )
    r = client.delete(f"/api/v1/businesses/{biz_id}?confirm_name=Owned")
    assert r.status_code == 403


def test_delete_workspace_requires_name_echo(sb):
    r = client.post("/api/v1/businesses/", json={"name": "Real Name", "type": "building"})
    biz_id = r.json()["id"]
    r = client.delete(f"/api/v1/businesses/{biz_id}?confirm_name=Wrong")
    assert r.status_code == 400


def test_delete_workspace_cascades(sb):
    """Owner with correct name confirmation deletes the workspace and
    its membership rows (cascade verified by FakeSupabase manual cleanup
    + the prod FK audit recorded in the migration plan)."""
    r = client.post("/api/v1/businesses/", json={"name": "Doomed", "type": "building"})
    biz_id = r.json()["id"]
    assert len(sb.store["business_members"]) == 1
    r = client.delete(f"/api/v1/businesses/{biz_id}?confirm_name=Doomed")
    assert r.status_code == 204
    assert len(sb.store["businesses"]) == 0


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
