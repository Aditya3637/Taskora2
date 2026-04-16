from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
FAKE_TASK = {
    "id": "task-001",
    "title": "Pest Inspection",
    "primary_stakeholder_id": "user-123",
    "status": "pending_decision",
    "task_stakeholders": [{"user_id": "user-123", "role": "primary"}],
}

client = TestClient(app)

def override_auth():
    return FAKE_USER

def _mock_sb_with_task(task):
    mock_sb = MagicMock()
    # task fetch returns task
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [task]
    # all updates succeed
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [task]
    # decision_log insert
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [{}]
    return mock_sb

def test_approve_decision_returns_201():
    mock_sb = _mock_sb_with_task(FAKE_TASK)
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/tasks/task-001/decisions/", json={"action": "approve"})
        assert r.status_code == 201
        assert r.json() == {"ok": True}
    finally:
        app.dependency_overrides.clear()

def test_reject_without_reason_returns_422():
    mock_sb = _mock_sb_with_task(FAKE_TASK)
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/tasks/task-001/decisions/", json={"action": "reject"})
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()

def test_non_stakeholder_returns_403():
    task = {**FAKE_TASK, "primary_stakeholder_id": "other-user", "task_stakeholders": []}
    mock_sb = _mock_sb_with_task(task)
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/tasks/task-001/decisions/", json={"action": "approve"})
        assert r.status_code == 403
    finally:
        app.dependency_overrides.clear()

def test_task_not_found_returns_404():
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/tasks/nonexistent/decisions/", json={"action": "approve"})
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()
