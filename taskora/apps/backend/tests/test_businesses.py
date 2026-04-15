import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
FAKE_BIZ = {"id": "biz-456", "name": "Acme Corp", "type": "building", "owner_id": "user-123"}

client = TestClient(app)


def override_auth():
    return FAKE_USER


def test_create_business_returns_201():
    mock_sb = MagicMock()
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [FAKE_BIZ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/businesses/", json={"name": "Acme Corp", "type": "building"})
        assert r.status_code == 201
        assert r.json()["name"] == "Acme Corp"
    finally:
        app.dependency_overrides.clear()


def test_list_businesses_empty():
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/")
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.clear()


def test_list_buildings():
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "b1", "name": "Tower A", "business_id": "biz-456"}
    ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/businesses/biz-456/buildings")
        assert r.status_code == 200
        assert len(r.json()) == 1
    finally:
        app.dependency_overrides.clear()
