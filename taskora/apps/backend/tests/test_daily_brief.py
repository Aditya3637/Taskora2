from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
client = TestClient(app)


def override_auth():
    return FAKE_USER


def test_daily_brief_empty():
    """All queries return empty — should return empty arrays, not error."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.order.return_value.execute.return_value.data = []
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/daily-brief/")
        assert r.status_code == 200
        body = r.json()
        assert body["user_id"] == "user-123"
        assert body["decisions_pending"] == []
        assert body["overdue"] == []
        assert body["stale"] == []
        assert body["due_this_week"] == []
        assert body["blocked"] == []
    finally:
        app.dependency_overrides.clear()
