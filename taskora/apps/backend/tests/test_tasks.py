from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from main import app
from auth import get_current_user
from deps import get_supabase

FAKE_USER = {"id": "user-123", "email": "test@example.com", "role": "authenticated"}
FAKE_TASK = {
    "id": "task-001",
    "title": "Fix HVAC",
    "description": None,
    "initiative_id": "init-789",
    "primary_stakeholder_id": "user-123",
    "priority": "medium",
    "due_date": None,
    "date_mode": "uniform",
    "entity_inheritance": "inherited",
    "status": "open",
    "task_entities": [],
    "task_stakeholders": [{"task_id": "task-001", "user_id": "user-123", "role": "primary"}],
    "subtasks": [],
    "comments": [],
    "attachments": [],
}

client = TestClient(app)


def override_auth():
    return FAKE_USER


def test_create_task_returns_201():
    mock_sb = MagicMock()
    # tasks insert
    mock_sb.table.return_value.insert.return_value.execute.return_value.data = [FAKE_TASK]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.post("/api/v1/tasks/", json={
            "title": "Fix HVAC",
            "initiative_id": "init-789",
            "primary_stakeholder_id": "user-123",
        })
        assert r.status_code == 201
        assert r.json()["id"] == "task-001"
        assert r.json()["title"] == "Fix HVAC"
    finally:
        app.dependency_overrides.clear()


def test_update_task_status_global():
    mock_sb = MagicMock()
    # update returns something (not checked in handler)
    mock_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"id": "task-001", "status": "in_progress"}
    ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.patch("/api/v1/tasks/task-001/status", json={
            "status": "in_progress",
        })
        assert r.status_code == 200
        assert r.json() == {"ok": True}
    finally:
        app.dependency_overrides.clear()


def test_update_task_status_per_entity():
    mock_sb = MagicMock()
    mock_sb.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [
        {"task_id": "task-001", "entity_id": "ent-001", "per_entity_status": "done"}
    ]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.patch("/api/v1/tasks/task-001/status", json={
            "status": "done",
            "entity_id": "ent-001",
        })
        assert r.status_code == 200
        assert r.json() == {"ok": True}
    finally:
        app.dependency_overrides.clear()


def test_get_task_not_found_returns_404():
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/tasks/nonexistent-task")
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_get_task_returns_200():
    mock_sb = MagicMock()
    # fetch task — caller is primary_stakeholder_id so no second query needed
    mock_sb.table.return_value.select.return_value.eq.return_value.execute.return_value.data = [FAKE_TASK]
    app.dependency_overrides[get_current_user] = override_auth
    app.dependency_overrides[get_supabase] = lambda: mock_sb
    try:
        r = client.get("/api/v1/tasks/task-001")
        assert r.status_code == 200
        assert r.json()["id"] == "task-001"
        assert r.json()["title"] == "Fix HVAC"
    finally:
        app.dependency_overrides.clear()
