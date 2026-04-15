from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
FAKE_INIT = {"id": "init-789", "name": "Pest Control Q2", "business_id": "biz-456", "owner_id": "user-123", "date_mode": "uniform"}

client = TestClient(app)

def override_auth():
    return FAKE_USER

def test_create_initiative_returns_201():
    mock_sb = MagicMock()
    # _require_member passes (member exists)
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"business_id": "biz-456"}]
    # insert returns initiative
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [FAKE_INIT]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/initiatives/", json={
            "name": "Pest Control Q2",
            "business_id": "biz-456",
            "date_mode": "uniform",
        })
        assert r.status_code == 201
        assert r.json()["name"] == "Pest Control Q2"
    finally:
        app.dependency_overrides.clear()

def test_create_initiative_non_member_returns_403():
    mock_sb = MagicMock()
    # _require_member fails (no rows)
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/initiatives/", json={
            "name": "X",
            "business_id": "other-biz",
            "date_mode": "uniform",
        })
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()

def test_list_initiatives_for_business():
    mock_sb = MagicMock()
    # membership check
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"business_id": "biz-456"}]
    # list query
    mock_sb.table.return_value.select.return_value.eq.return_value.neq.return_value.execute.return_value.data = [FAKE_INIT]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/initiatives/business/biz-456")
        assert r.status_code == 200
    finally:
        app.dependency_overrides.clear()
