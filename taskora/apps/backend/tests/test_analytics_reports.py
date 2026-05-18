"""Logic tests for the deepened Analytics reporting endpoints:
GET /api/v1/analytics/reports/people and /reports/programs.

Covers: tasks + subtasks ownership, closed_at completion within range,
on-time/late split, reopened, pending-approval, avg_delay_days from
task_date_change_log, program schedule health + milestones + owners/leads,
member-gating, and CSV headers.
"""
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U = "u-1"          # Alice
U2 = "u-2"         # Bob
LEAD = "u-lead"    # program lead
OUTSIDER = "u-x"
BIZ = "BIZ"
INIT = "INIT1"     # under program P1
INIT2 = "INIT2"    # no program -> Unassigned

RANGE = "start_date=2026-05-01&end_date=2026-05-31"


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "users": [
            {"id": U, "name": "Alice", "email": "alice@x.io"},
            {"id": U2, "name": "Bob", "email": "bob@x.io"},
            {"id": LEAD, "name": "Lead Person", "email": "lead@x.io"},
        ],
        "programs": [
            {"id": "P1", "name": "Prog A", "status": "active",
             "business_id": BIZ, "lead_user_id": LEAD},
        ],
        "initiatives": [
            {"id": INIT, "name": "Init One", "status": "active",
             "program_id": "P1", "business_id": BIZ, "owner_id": U,
             "target_end_date": "2020-06-01"},          # past -> overdue
            {"id": INIT2, "name": "Init Two", "status": "active",
             "program_id": None, "business_id": BIZ, "owner_id": U,
             "target_end_date": None},                   # -> no_date
        ],
        "tasks": [
            {"id": "T1", "status": "done", "due_date": "2026-05-15",
             "closed_at": "2026-05-10T00:00:00+00:00",
             "created_at": "2026-05-05T00:00:00+00:00",
             "primary_stakeholder_id": U, "approval_state": "none",
             "initiative_id": INIT},
            {"id": "T2", "status": "blocked", "due_date": None,
             "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
             "primary_stakeholder_id": U, "approval_state": "none",
             "initiative_id": INIT},
            {"id": "T3", "status": "todo", "due_date": "2020-01-01",
             "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
             "primary_stakeholder_id": U2, "approval_state": "none",
             "initiative_id": INIT},
            {"id": "T4", "status": "done", "due_date": None,
             "closed_at": "2026-04-01T00:00:00+00:00",
             "created_at": "2026-03-01T00:00:00+00:00",
             "primary_stakeholder_id": U, "approval_state": "none",
             "initiative_id": INIT2},
        ],
        "task_stakeholders": [
            {"task_id": "T1", "user_id": U2, "role": "secondary"},
        ],
        "subtasks": [
            {"id": "S1", "status": "done", "task_id": "T1", "assignee_id": U2,
             "closed_at": "2026-05-12T00:00:00+00:00",
             "created_at": "2026-05-08T00:00:00+00:00", "approval_state": "none"},
            {"id": "S2", "status": "blocked", "task_id": "T1", "assignee_id": U,
             "closed_at": None, "created_at": "2026-05-03T00:00:00+00:00",
             "approval_state": "none"},
        ],
        "task_date_change_log": [
            {"task_id": "T3", "subtask_id": None, "delay_days": 5},
            {"task_id": None, "subtask_id": "S2", "delay_days": 3},
            {"task_id": "T1", "subtask_id": None, "delay_days": -2},  # pulled in
        ],
        "milestones": [
            {"parent_type": "initiative", "parent_id": INIT,
             "name": "M past", "uniform_date": "2020-01-01"},
            {"parent_type": "initiative", "parent_id": INIT,
             "name": "M future", "uniform_date": "2099-01-01"},
        ],
    }


def _setup(store, who=U):
    app.dependency_overrides[get_current_user] = lambda: {"id": who, "email": "u@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def _people(store=None, who=U):
    _setup(store or _store(), who)
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}")
    assert r.status_code == 200, r.text
    return {row["user_id"]: row for row in r.json()["rows"]}


# --------------------------------------------------------------------------
# People report
# --------------------------------------------------------------------------

def test_people_alice_tasks_and_subtasks():
    a = _people()[U]
    # Alice: primary on T1,T2,T4; assignee of subtask S2.
    assert a["tasks_owned"] == 3
    assert a["subtasks_owned"] == 1
    assert a["tasks_completed"] == 1            # T1 in range; T4 closed April
    assert a["subtasks_completed"] == 0          # S2 is blocked
    assert a["on_time_count"] == 1               # T1 closed 05-10 <= due 05-15
    assert a["late_count"] == 0
    assert a["blocked_count"] == 2               # T2 + subtask S2
    assert a["avg_tat_days"] == 5.0              # T1 only
    assert a["avg_delay_days"] == 3.0            # S2 slip 3 (negative slip ignored)


def test_people_bob_secondary_and_subtask_completion():
    b = _people()[U2]
    # Bob: secondary on T1, primary on T3; assignee of subtask S1.
    assert b["tasks_owned"] == 2
    assert b["subtasks_owned"] == 1
    assert b["tasks_completed"] == 1             # T1
    assert b["subtasks_completed"] == 1          # S1 done, closed in range
    assert b["on_time_count"] == 1               # shares T1
    assert b["tasks_overdue"] == 1               # T3 due 2020
    # avg TAT over T1 (5d) and S1 (4d) = 4.5
    assert b["avg_tat_days"] == 4.5
    assert b["avg_delay_days"] == 5.0            # T3 slip 5


def test_people_late_completion_split():
    store = _store()
    # Close T1 AFTER its due date -> should count as late, not on-time.
    for t in store["tasks"]:
        if t["id"] == "T1":
            t["closed_at"] = "2026-05-20T00:00:00+00:00"  # due 05-15
    a = _people(store)[U]
    assert a["on_time_count"] == 0
    assert a["late_count"] == 1


def test_people_reopened_and_pending_approval():
    store = _store()
    for t in store["tasks"]:
        if t["id"] == "T2":
            t["status"] = "reopened"
        if t["id"] == "T4":
            t["approval_state"] = "pending"
    a = _people(store)[U]
    assert a["reopened_count"] == 1
    assert a["pending_approval_count"] == 1


def test_people_access_is_member_gated():
    _setup(_store(), who=OUTSIDER)
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}")
    assert r.status_code == 403


def test_people_csv_header():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}&format=csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.text.splitlines()[0] == (
        "user_id,user_name,tasks_owned,subtasks_owned,tasks_completed,"
        "subtasks_completed,on_time_count,late_count,tasks_overdue,"
        "blocked_count,reopened_count,pending_approval_count,avg_tat_days,"
        "avg_delay_days"
    )


# --------------------------------------------------------------------------
# Program -> Initiative report
# --------------------------------------------------------------------------

def test_programs_owner_schedule_milestones():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}")
    assert r.status_code == 200, r.text
    blocks = {b["program_name"]: b for b in r.json()["programs"]}

    prog = blocks["Prog A"]
    assert prog["lead_name"] == "Lead Person"
    assert prog["initiatives_overdue"] == 1
    assert prog["milestones_total"] == 2 and prog["milestones_overdue"] == 1
    it = prog["initiatives"][0]
    assert it["owner_name"] == "Alice"
    assert it["target_end_date"] == "2020-06-01"
    assert it["schedule_health"] == "overdue"     # past target, still active
    assert it["total_tasks"] == 3 and it["done_tasks"] == 1
    assert it["completion_pct"] == 33
    assert it["overdue_count"] == 1 and it["blocked_count"] == 1
    assert it["milestones_total"] == 2 and it["milestones_overdue"] == 1

    un = blocks["Unassigned"]
    assert un["program_id"] is None
    ui = un["initiatives"][0]
    assert ui["initiative_name"] == "Init Two"
    assert ui["schedule_health"] == "no_date"
    assert ui["done_tasks"] == 0 and ui["total_tasks"] == 1


def test_programs_csv_header():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}&format=csv")
    assert r.status_code == 200
    assert r.text.splitlines()[0] == (
        "program,program_lead,initiative,initiative_status,owner,"
        "target_end_date,schedule_health,total_tasks,done_tasks,"
        "completion_pct,overdue_count,blocked_count,milestones_total,"
        "milestones_overdue"
    )


def test_programs_access_is_member_gated():
    _setup(_store(), who=OUTSIDER)
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}")
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Business Overview — subtasks must be folded into the counts (bug #5)
# --------------------------------------------------------------------------

def test_business_overview_includes_subtasks():
    _setup(_store(), who=U)
    # days=365 so the April-closed items are inside the window and the
    # subtask contribution to `completed` is unambiguous.
    r = client.get(f"/api/v1/analytics/business/{BIZ}?days=365")
    assert r.status_code == 200, r.text
    b = r.json()
    # Tasks stay tasks-only for comparability; subtasks reported separately.
    assert b["total_tasks"] == 4
    assert b["total_subtasks"] == 2          # S1 + S2 under T1
    assert b["total_items"] == 6
    # S1 (done, in range) is counted alongside T1 + T4 — proves subtasks
    # reach `completed_count`, the heart of bug #5.
    assert b["completed_count"] == 3         # T1 + T4 + S1
    # S2 is blocked -> must lift blocked beyond the task-only count of 1.
    assert b["blocked_count"] == 2           # T2 + S2


def test_business_overview_member_gated():
    _setup(_store(), who=OUTSIDER)
    r = client.get(f"/api/v1/analytics/business/{BIZ}?days=30")
    assert r.status_code == 403


# --------------------------------------------------------------------------
# my_performance — bugs #3 (closed_at, not updated_at) and #4 (secondary
# stakeholders count). today is 2026-05-18; default window is 30 days
# (since_date = 2026-04-18).
# --------------------------------------------------------------------------

def _perf_store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "tasks": [
            # MP1: done, closed in range. Edited *after* closing (updated_at
            # is recent) — old code measured TAT off updated_at; correct TAT
            # is created->closed = 5 days.
            {"id": "MP1", "status": "done", "due_date": "2026-05-15",
             "closed_at": "2026-05-10T00:00:00+00:00",
             "created_at": "2026-05-05T00:00:00+00:00",
             "updated_at": "2026-05-17T00:00:00+00:00",
             "primary_stakeholder_id": U},
            # MP2: done but closed 03-01, OUTSIDE the 30-day window. Its
            # updated_at is recent — the old `gte(updated_at, since)` bug
            # would wrongly count it as completed.
            {"id": "MP2", "status": "done", "due_date": None,
             "closed_at": "2026-03-01T00:00:00+00:00",
             "created_at": "2026-02-20T00:00:00+00:00",
             "updated_at": "2026-05-17T00:00:00+00:00",
             "primary_stakeholder_id": U},
            # MP3: U is only a SECONDARY stakeholder (primary is someone
            # else). Old code counted primary only -> bug #4.
            {"id": "MP3", "status": "done", "due_date": None,
             "closed_at": "2026-05-12T00:00:00+00:00",
             "created_at": "2026-05-09T00:00:00+00:00",
             "updated_at": "2026-05-12T00:00:00+00:00",
             "primary_stakeholder_id": "someone-else"},
            # MP4: open + overdue, recently touched -> overdue but NOT stale.
            {"id": "MP4", "status": "todo", "due_date": "2020-01-01",
             "closed_at": None, "created_at": "2026-05-01T00:00:00+00:00",
             "updated_at": "2026-05-17T00:00:00+00:00",
             "primary_stakeholder_id": U},
        ],
        "task_stakeholders": [
            {"task_id": "MP3", "user_id": U, "role": "secondary"},
        ],
        "subtasks": [],
        "decision_log": [
            {"user_id": U, "action": "delegate",
             "created_at": "2026-05-15T00:00:00+00:00"},
            # Old decision outside the window — must be filtered by gte.
            {"user_id": U, "action": "approve",
             "created_at": "2025-01-01T00:00:00+00:00"},
        ],
    }


def test_my_performance_closed_at_and_secondary():
    _setup(_perf_store(), who=U)
    r = client.get("/api/v1/analytics/my-performance?days=30")
    assert r.status_code == 200, r.text
    p = r.json()
    # MP1 (in range) + MP3 (secondary, in range). MP2 excluded despite a
    # recent updated_at -> proves completion keys off closed_at (bug #3)
    # and secondary ownership counts (bug #4).
    assert p["tasks_completed"] == 2
    # TAT: MP1 = 5d, MP3 = 3d -> avg 4d -> 96h. Off updated_at it'd differ.
    assert p["avg_tat_hours"] == 96.0
    assert p["overdue_count"] == 1            # MP4
    assert p["stale_count"] == 0             # MP4 recently updated
    assert p["blocked_count"] == 0
    assert p["decisions_made"] == 1          # old decision filtered by gte
    assert p["delegation_count"] == 1
    assert p["timeframe_days"] == 30


# --------------------------------------------------------------------------
# Business Overview — bug #1 (stale not auto-inflated when updated_at is
# fresh) and bug #2 (the `days` param actually filters completion).
# --------------------------------------------------------------------------

def _biz_bug_store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "initiatives": [{"id": "BI", "business_id": BIZ}],
        "tasks": [
            # Open but freshly updated -> must NOT be stale (bug #1).
            {"id": "B1", "status": "todo", "closed_at": None,
             "updated_at": "2026-05-17T00:00:00+00:00", "initiative_id": "BI"},
            # Open and untouched for months -> stale.
            {"id": "B2", "status": "todo", "closed_at": None,
             "updated_at": "2026-01-01T00:00:00+00:00", "initiative_id": "BI"},
            # Done recently -> completed for any reasonable window.
            {"id": "B3", "status": "done",
             "closed_at": "2026-05-15T00:00:00+00:00",
             "updated_at": "2026-05-15T00:00:00+00:00", "initiative_id": "BI"},
            # Done long ago -> only inside a wide window (bug #2).
            {"id": "B4", "status": "done",
             "closed_at": "2026-01-15T00:00:00+00:00",
             "updated_at": "2026-01-15T00:00:00+00:00", "initiative_id": "BI"},
        ],
        "subtasks": [],
    }


def test_business_overview_stale_not_inflated_bug1():
    _setup(_biz_bug_store(), who=U)
    r = client.get(f"/api/v1/analytics/business/{BIZ}?days=30")
    assert r.status_code == 200, r.text
    b = r.json()
    # Only B2 is stale; B1 is open but fresh. Pre-fix this returned 2
    # because updated_at was never selected (always None < threshold).
    assert b["stale_count"] == 1


def test_business_overview_days_filters_completion_bug2():
    _setup(_biz_bug_store(), who=U)
    narrow = client.get(f"/api/v1/analytics/business/{BIZ}?days=30").json()
    wide = client.get(f"/api/v1/analytics/business/{BIZ}?days=365").json()
    # 30d -> only B3. 365d -> B3 + B4. Pre-fix `days` was ignored so both
    # would have returned the same number.
    assert narrow["completed_count"] == 1
    assert wide["completed_count"] == 2
