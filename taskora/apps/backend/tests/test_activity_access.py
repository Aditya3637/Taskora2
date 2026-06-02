"""Tenant-isolation regression for the activity feed (audit N1 + N11).

Before the fix, GET /api/v1/activity gated only on a valid JWT and filtered
by the caller-supplied initiative_id/task_id — so any authenticated user
could read another workspace's audit trail, and POST could forge entries
into any business_id. These tests lock in membership enforcement.
"""
import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

BIZ = "biz-1"
MEMBER = "u-mem"
OUTSIDER = "u-out"
INIT = "init-1"
TASK = "task-1"


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": MEMBER, "role": "owner"}],
        "users": [{"id": MEMBER, "name": "Mem", "email": "m@x.io"}],
        "initiatives": [{"id": INIT, "business_id": BIZ, "name": "Init"}],
        "tasks": [{"id": TASK, "initiative_id": INIT, "title": "T"}],
        "activity_log": [
            {"id": "a1", "business_id": BIZ, "initiative_id": INIT, "task_id": None,
             "actor_id": MEMBER, "action": "created", "created_at": "2026-05-01T00:00:00+00:00"},
        ],
    }


def _as(user_id):
    app.dependency_overrides[get_current_user] = lambda: {"id": user_id, "email": "x@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(_store())


def teardown_function():
    app.dependency_overrides.clear()


def test_member_can_read_activity():
    _as(MEMBER)
    r = client.get(f"/api/v1/activity?initiative_id={INIT}")
    assert r.status_code == 200, r.text
    assert len(r.json()) >= 1


def test_outsider_cannot_read_activity_by_initiative():
    _as(OUTSIDER)
    r = client.get(f"/api/v1/activity?initiative_id={INIT}")
    assert r.status_code == 403


def test_outsider_cannot_read_activity_by_task():
    _as(OUTSIDER)
    r = client.get(f"/api/v1/activity?task_id={TASK}")
    assert r.status_code == 403


def test_outsider_cannot_forge_activity():
    _as(OUTSIDER)
    r = client.post("/api/v1/activity", json={
        "business_id": BIZ, "initiative_id": INIT, "action": "forged",
    })
    assert r.status_code == 403
