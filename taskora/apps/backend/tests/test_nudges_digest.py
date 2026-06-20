"""Nudges / WhatsApp digest.

The production bug this guards: the digest embedded `initiatives(name, title)`
but `initiatives` has no `title` column → PostgREST 400 → digest always failed →
Nudges showed "Nobody's stuck". The fake Supabase doesn't validate columns, so a
functional test alone wouldn't catch it — hence the source guard.
"""
import inspect

from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U = "u-1"
BIZ = "BIZ"
INIT = "INIT1"


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "users": [{"id": U, "name": "Asha", "email": "asha@x.io", "settings": {}}],
        "initiatives": [{"id": INIT, "business_id": BIZ, "name": "Metering"}],
        "task_stakeholders": [],
        "tasks": [
            {"id": "T1", "title": "Survey", "status": "in_progress", "due_date": "2020-01-01",
             "initiative_id": INIT, "primary_stakeholder_id": U},  # overdue
            {"id": "T2", "title": "Approve", "status": "pending_decision", "due_date": None,
             "initiative_id": INIT, "primary_stakeholder_id": U},  # pending
        ],
    }


def _setup(store):
    app.dependency_overrides[get_current_user] = lambda: {"id": U, "email": "asha@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def test_digest_returns_stuck_people_with_counts():
    _setup(_store())
    r = client.post("/api/v1/whatsapp/digest", json={"business_id": BIZ})
    assert r.status_code == 200, r.text
    msgs = r.json()["messages"]
    me = next(m for m in msgs if m["user_id"] == U)
    assert me["user_name"] == "Asha"           # resolved from users.name, not uid
    assert me["counts"]["overdue"] == 1
    assert me["counts"]["pending"] == 1
    assert "wa.me" in me["wa_link"]


def test_no_phantom_initiative_title_embed():
    """`initiatives` has only `name`. Embedding a non-existent `title` 400s in
    real PostgREST. Keep these selects clean."""
    import routers.whatsapp as w
    import routers.tasks as t
    for mod in (w, t):
        src = inspect.getsource(mod)
        assert "initiatives(name, title)" not in src
        assert "initiatives(title)" not in src
