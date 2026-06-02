"""P1 (measurable key results) + P2 (status updates + health snapshots)."""
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from auth import get_current_user
from deps import get_supabase
from main import app
from tests._fake_supabase import FakeSupabase
from automation import campaigns

client = TestClient(app)
ALICE = "user-alice"
BIZ = "biz-1"
PROG = "prog-1"


def _seed(**over):
    data = {
        "users": [{"id": ALICE, "name": "Alice"}],
        "business_members": [{"business_id": BIZ, "user_id": ALICE, "role": "member"}],
        "programs": [{"id": PROG, "business_id": BIZ, "name": "Energy", "status": "active", "manual_health": None}],
        "initiatives": [],
        "tasks": [],
        "program_key_results": [],
        "program_updates": [],
        "program_snapshots": [],
    }
    data.update(over)
    return FakeSupabase(data)


@pytest.fixture
def sb():
    s = _seed()
    app.dependency_overrides[get_current_user] = lambda: {"id": ALICE}
    app.dependency_overrides[get_supabase] = lambda: s
    yield s
    app.dependency_overrides.clear()


# ── P1: key results ────────────────────────────────────────────────────────
def test_key_result_crud_and_progress(sb):
    r = client.post(f"/api/v1/programs/{PROG}/key-results", json={
        "title": "Bacnet live across top 5", "unit": "sites",
        "baseline": 0, "target": 5, "current": 3, "direction": "increase"})
    assert r.status_code == 201
    kr = r.json()
    assert kr["progress_pct"] == 60
    kid = kr["id"]

    assert client.get(f"/api/v1/programs/{PROG}/key-results").json()[0]["progress_pct"] == 60

    # Move current to target → 100%.
    r2 = client.patch(f"/api/v1/programs/{PROG}/key-results/{kid}", json={"current": 5})
    assert r2.json()["progress_pct"] == 100

    # Rollup now reports outcome_pct distinct from task progress.
    roll = client.get(f"/api/v1/programs/{PROG}/rollup").json()
    assert roll["outcome_pct"] == 100
    assert roll["progress_pct"] == 0  # no initiatives done

    assert client.delete(f"/api/v1/programs/{PROG}/key-results/{kid}").status_code == 204
    assert client.get(f"/api/v1/programs/{PROG}/key-results").json() == []
    # No measurable KRs → outcome_pct is None.
    assert client.get(f"/api/v1/programs/{PROG}/rollup").json()["outcome_pct"] is None


def test_kr_progress_decrease_direction(sb):
    # Reduce demand from 100 → target 85; currently 91 → (100-91)/(100-85)=60%.
    r = client.post(f"/api/v1/programs/{PROG}/key-results", json={
        "title": "Cut contract demand", "baseline": 100, "target": 85, "current": 91, "direction": "decrease"})
    assert r.json()["progress_pct"] == 60


def test_kr_progress_clamped(sb):
    # Overshoot stays at 100, not 140.
    r = client.post(f"/api/v1/programs/{PROG}/key-results", json={
        "title": "x", "baseline": 0, "target": 5, "current": 7})
    assert r.json()["progress_pct"] == 100


# ── P2: status updates ──────────────────────────────────────────────────────
def test_status_update_sets_health_and_logs(sb):
    r = client.post(f"/api/v1/programs/{PROG}/updates", json={"status": "amber", "summary": "Vendor delay on Site 3"})
    assert r.status_code == 201
    # The program's manual_health reflects the reported RAG immediately.
    assert sb.table("programs").select("*").eq("id", PROG).execute().data[0]["manual_health"] == "amber"
    updates = client.get(f"/api/v1/programs/{PROG}/updates").json()
    assert len(updates) == 1 and updates[0]["author_name"] == "Alice"
    assert client.get(f"/api/v1/programs/{PROG}/rollup").json()["health"] == "amber"


def test_status_update_validation(sb):
    assert client.post(f"/api/v1/programs/{PROG}/updates", json={"status": "purple", "summary": "x"}).status_code == 422
    assert client.post(f"/api/v1/programs/{PROG}/updates", json={"status": "green", "summary": "  "}).status_code == 422


# ── P2: trend snapshots ─────────────────────────────────────────────────────
def test_trend_returns_snapshots(sb):
    sb.store["program_snapshots"] = [
        {"program_id": PROG, "snapshot_date": "2026-05-30", "health": "amber", "progress_pct": 40, "outcome_pct": 50, "overdue_tasks": 2, "initiatives_total": 5, "initiatives_done": 2},
        {"program_id": PROG, "snapshot_date": "2026-06-01", "health": "green", "progress_pct": 60, "outcome_pct": 70, "overdue_tasks": 0, "initiatives_total": 5, "initiatives_done": 3},
    ]
    trend = client.get(f"/api/v1/programs/{PROG}/trend?days=90").json()
    assert [t["progress_pct"] for t in trend] == [40, 60]  # oldest → newest


def test_snapshot_scan_is_idempotent():
    now = datetime(2026, 6, 2, 8, 0, tzinfo=timezone.utc)
    sb = _seed(
        initiatives=[{"id": "i1", "program_id": PROG, "status": "active", "target_end_date": "2026-05-01"}],
        program_key_results=[{"program_id": PROG, "baseline": 0, "target": 10, "current": 5, "direction": "increase"}],
    )
    assert campaigns.run_program_snapshots(sb, now) == 1
    snap = sb.table("program_snapshots").select("*").execute().data[0]
    # One overdue initiative → amber (red needs ≥2); outcome 5/10 = 50%.
    assert snap["outcome_pct"] == 50 and snap["health"] == "amber"
    # Second run same day → no duplicate.
    assert campaigns.run_program_snapshots(sb, now) == 0
    assert len(sb.table("program_snapshots").select("*").execute().data) == 1
