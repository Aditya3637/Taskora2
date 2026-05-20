"""Daily brief tests.

Uses the in-memory FakeSupabase (same harness as test_onboarding /
test_businesses) so the real endpoint logic runs. The old MagicMock
chain didn't model `in_()` / embeds / `task_stakeholders` and broke
when the route was parallelised. Route is mounted slash-less
(`/api/v1/daily-brief`) — with redirect_slashes=False the trailing-slash
form 404s.
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
        "business_members": [],
        "businesses": [],
        "initiatives": [],
        "programs": [],
        "tasks": [],
        "task_stakeholders": [],
        "task_entities": [],
        "subtasks": [],
        "buildings": [],
        "clients": [],
    })
    app.dependency_overrides[get_current_user] = lambda: {
        "id": UID, "email": "test@example.com", "role": "authenticated"}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


def test_daily_brief_empty(sb):
    """All queries return empty -> empty buckets, not error."""
    r = client.get("/api/v1/daily-brief")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user_id"] == UID
    assert body["pending_decisions"] == []
    assert body["overdue_tasks"] == []
    assert body["stale_tasks"] == []
    assert body["due_this_week"] == []
    assert body["blocked_tasks"] == []
    assert body["awaiting_approval"] == []
    assert body["initiative_progress"] == []
    assert body["quick_stats"]["open_tasks"] == 0
