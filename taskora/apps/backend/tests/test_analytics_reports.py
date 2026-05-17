"""Logic tests for the rebuilt Analytics reporting endpoints:
GET /api/v1/analytics/reports/people and /reports/programs.

Runs the real handlers against the in-memory fake Supabase. Key things
asserted: completion is measured by closed_at (not the old non-existent
completed_at), the date range filters completion only, secondary
stakeholders are counted, programs roll up with an Unassigned bucket,
access is member-gated, and CSV export works.
"""
from fastapi.testclient import TestClient

from main import app
from auth import get_current_user
from deps import get_supabase
from tests._fake_supabase import FakeSupabase

client = TestClient(app)

U = "u-1"          # Alice — primary on most tasks
U2 = "u-2"         # Bob — secondary on T1, primary on T3
OUTSIDER = "u-x"   # not a member of BIZ
BIZ = "BIZ"
INIT = "INIT1"

# Range used by every report call below.
RANGE = "start_date=2026-05-01&end_date=2026-05-31"


def _store():
    return {
        "business_members": [{"business_id": BIZ, "user_id": U, "role": "owner"}],
        "users": [
            {"id": U, "name": "Alice", "email": "alice@x.io"},
            {"id": U2, "name": "Bob", "email": "bob@x.io"},
        ],
        "programs": [
            {"id": "P1", "name": "Prog A", "status": "active", "business_id": BIZ},
        ],
        "initiatives": [
            {"id": INIT, "name": "Init One", "status": "active",
             "program_id": "P1", "business_id": BIZ},
            {"id": "INIT2", "name": "Init Two", "status": "active",
             "program_id": None, "business_id": BIZ},
        ],
        "tasks": [
            # done & closed inside the range
            {"id": "T1", "status": "done", "due_date": None,
             "closed_at": "2026-05-10T12:00:00+00:00",
             "created_at": "2026-05-05T12:00:00+00:00",
             "primary_stakeholder_id": U, "initiative_id": INIT},
            # blocked, owned by Alice
            {"id": "T2", "status": "blocked", "due_date": None,
             "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
             "primary_stakeholder_id": U, "initiative_id": INIT},
            # Bob's, overdue (past due, not done)
            {"id": "T3", "status": "todo", "due_date": "2020-01-01",
             "closed_at": None, "created_at": "2026-05-02T00:00:00+00:00",
             "primary_stakeholder_id": U2, "initiative_id": INIT},
            # done but closed BEFORE the range -> owned, not completed-in-range
            {"id": "T4", "status": "done", "due_date": None,
             "closed_at": "2026-04-01T00:00:00+00:00",
             "created_at": "2026-03-01T00:00:00+00:00",
             "primary_stakeholder_id": U, "initiative_id": INIT},
            # under the program-less initiative, done out of range
            {"id": "T5", "status": "done", "due_date": None,
             "closed_at": "2026-04-15T00:00:00+00:00",
             "created_at": "2026-04-01T00:00:00+00:00",
             "primary_stakeholder_id": U, "initiative_id": "INIT2"},
        ],
        # Bob is a secondary stakeholder on T1 -> he co-owns it.
        "task_stakeholders": [
            {"task_id": "T1", "user_id": U2, "role": "secondary"},
        ],
    }


def _setup(store, who=U):
    app.dependency_overrides[get_current_user] = lambda: {"id": who, "email": "u@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def _people(store, who=U):
    _setup(store, who)
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}")
    assert r.status_code == 200, r.text
    return {row["user_id"]: row for row in r.json()["rows"]}


# --------------------------------------------------------------------------
# People report
# --------------------------------------------------------------------------

def test_people_completion_uses_closed_at_within_range():
    rows = _people(_store())
    alice = rows[U]
    # Alice is primary on T1,T2,T4 (INIT) and T5 (INIT2) -> owned 4 (the
    # report spans every initiative in the business). Only T1 closed in range.
    assert alice["tasks_owned"] == 4
    assert alice["tasks_completed"] == 1            # T4 & T5 closed in April -> excluded
    assert alice["tasks_blocked"] == 1              # T2
    assert alice["tasks_overdue"] == 0
    # TAT = 2026-05-05 -> 2026-05-10 = 5 days, only the in-range completion.
    assert alice["avg_tat_days"] == 5.0


def test_people_counts_secondary_stakeholder_and_overdue():
    rows = _people(_store())
    bob = rows[U2]
    # Bob is secondary on T1 and primary on T3 -> owns 2.
    assert bob["tasks_owned"] == 2
    assert bob["tasks_completed"] == 1              # shares T1's in-range close
    assert bob["tasks_overdue"] == 1                # T3 due 2020 + not done


def test_people_access_is_member_gated():
    _setup(_store(), who=OUTSIDER)
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}")
    assert r.status_code == 403


def test_people_csv_export():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/people?business_id={BIZ}&{RANGE}&format=csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    body = r.text.splitlines()
    assert body[0] == "user_id,user_name,tasks_owned,tasks_completed,tasks_overdue,tasks_blocked,avg_tat_days"
    assert any("Alice" in line for line in body[1:])


# --------------------------------------------------------------------------
# Program -> Initiative report
# --------------------------------------------------------------------------

def test_programs_rollup_and_unassigned_bucket():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}")
    assert r.status_code == 200, r.text
    blocks = {b["program_name"]: b for b in r.json()["programs"]}

    prog = blocks["Prog A"]
    assert prog["program_id"] == "P1"
    assert len(prog["initiatives"]) == 1
    init = prog["initiatives"][0]
    # INIT has T1..T4: total 4, only T1 done-in-range, T3 overdue, T2 blocked.
    assert init["total_tasks"] == 4
    assert init["done_tasks"] == 1
    assert init["completion_pct"] == 25
    assert init["overdue_count"] == 1
    assert init["blocked_count"] == 1
    # program rollup mirrors its single initiative
    assert prog["total_tasks"] == 4 and prog["done_tasks"] == 1

    un = blocks["Unassigned"]
    assert un["program_id"] is None
    assert un["initiatives"][0]["initiative_name"] == "Init Two"
    # T5 is done but closed in April -> not counted in range.
    assert un["initiatives"][0]["done_tasks"] == 0
    assert un["initiatives"][0]["total_tasks"] == 1


def test_programs_csv_export():
    _setup(_store())
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}&format=csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    head = r.text.splitlines()[0]
    assert head == "program,initiative,initiative_status,total_tasks,done_tasks,completion_pct,overdue_count,blocked_count"


def test_programs_access_is_member_gated():
    _setup(_store(), who=OUTSIDER)
    r = client.get(f"/api/v1/analytics/reports/programs?business_id={BIZ}&{RANGE}")
    assert r.status_code == 403
