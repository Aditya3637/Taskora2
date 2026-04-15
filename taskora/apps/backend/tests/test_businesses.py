from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
FAKE_BIZ = {"id": "biz-456", "name": "Acme Corp", "type": "building", "owner_id": "user-123"}

client = TestClient(app)


def override_auth():
    return FAKE_USER


def _make_sb_with_insert(return_data):
    """Mock supabase where insert().execute().data returns return_data."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = return_data
    return mock_sb


def test_create_business_returns_201():
    mock_sb = _make_sb_with_insert([FAKE_BIZ])
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/businesses/", json={"name": "Acme Corp", "type": "building"})
        assert r.status_code == 201
        assert r.json()["name"] == "Acme Corp"
    finally:
        app.dependency_overrides.clear()


def test_create_business_invalid_type_returns_422():
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    try:
        r = client.post("/api/v1/businesses/", json={"name": "Acme", "type": "invalid"})
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_list_businesses_empty():
    mock_sb = MagicMock()
    # first query: business_members returns empty
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/")
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.clear()


def test_list_businesses_with_results():
    mock_sb = MagicMock()
    # First query returns memberships
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [
        {"business_id": "biz-456"}
    ]
    # Second query (in_) returns business
    mock_sb.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [FAKE_BIZ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["id"] == "biz-456"
    finally:
        app.dependency_overrides.clear()


def test_list_buildings_returns_200():
    mock_sb = MagicMock()
    # _require_member check
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"business_id": "biz-456"}
    ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/biz-456/buildings")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_list_buildings_non_member_returns_403():
    mock_sb = MagicMock()
    # _require_member returns empty — not a member
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/other-biz/buildings")
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()
