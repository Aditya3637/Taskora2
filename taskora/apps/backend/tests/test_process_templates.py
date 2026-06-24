"""Process Templates (Playbooks) — generator fan-out logic.

Verifies the core promise: define a 3-step template once, apply to 2 sites →
6 dependency-wired, dated tasks, each anchored to one site + its instance, with
NO fan-out notifications (direct insert path).
"""
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
        "initiatives": [{"id": INIT, "business_id": BIZ, "name": "Metering",
                         "owner_id": U, "primary_stakeholder_id": U}],
        "buildings": [{"id": "B1", "name": "Tower A", "business_id": BIZ},
                      {"id": "B2", "name": "Tower B", "business_id": BIZ}],
        "clients": [],
        "tasks": [],
        "process_templates": [],
        "process_template_steps": [],
        "process_instances": [],
        "messages": [],  # notifications would land here — must stay empty
    }


def _setup(store):
    app.dependency_overrides[get_current_user] = lambda: {"id": U, "email": "u@x.io"}
    app.dependency_overrides[get_supabase] = lambda: FakeSupabase(store)


def teardown_function():
    app.dependency_overrides.clear()


def _make_template():
    return client.post("/api/v1/process-templates", json={
        "business_id": BIZ, "name": "Survey→Install→Test",
        "steps": [
            {"title": "Survey", "duration_days": 2, "depends_on": []},
            {"title": "Install", "duration_days": 5, "depends_on": [0]},
            {"title": "Test", "duration_days": 1, "depends_on": [1]},
        ],
    })


def test_template_create_persists_steps():
    _setup(_store())
    r = _make_template()
    assert r.status_code == 201, r.text
    steps = r.json()["steps"]
    assert [s["title"] for s in steps] == ["Survey", "Install", "Test"]
    assert steps[1]["depends_on"] == [0]


def test_apply_process_fans_out_per_site():
    store = _store()
    _setup(store)
    tpl_id = _make_template().json()["id"]

    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B2", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 200, r.text
    assert r.json()["instances"] == 2
    assert r.json()["tasks"] == 6

    tasks = store["tasks"]
    assert len(tasks) == 6
    # Every generated task is anchored to ONE site + an instance + its step.
    for t in tasks:
        assert t["entity_id"] in ("B1", "B2")
        assert t["process_instance_id"]
        assert t["template_step_id"]

    # Dates chain sequentially within a site: Survey 07-01→07-03, Install
    # 07-03→07-08, Test 07-08→07-09.
    b1 = sorted([t for t in tasks if t["entity_id"] == "B1"], key=lambda t: t["start_date"])
    assert b1[0]["start_date"] == "2026-07-01" and b1[0]["due_date"] == "2026-07-03"
    assert b1[1]["start_date"] == "2026-07-03" and b1[1]["due_date"] == "2026-07-08"
    assert b1[2]["start_date"] == "2026-07-08" and b1[2]["due_date"] == "2026-07-09"

    # Dependencies are wired WITHIN the site only (Install→Survey, Test→Install).
    survey, install, test = b1
    assert install["depends_on"] == [survey["id"]]
    assert test["depends_on"] == [install["id"]]
    # …and never cross to the other building.
    b2_ids = {t["id"] for t in tasks if t["entity_id"] == "B2"}
    assert not (set(install["depends_on"]) & b2_ids)

    # No fan-out notifications were emitted.
    assert store["messages"] == []


def test_apply_process_rejects_unknown_site():
    store = _store()
    _setup(store)
    tpl_id = _make_template().json()["id"]
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "NOPE", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 404


def _apply_two_sites(store):
    """Helper: apply a 3-step template to B1+B2 → returns the store post-apply."""
    _setup(store)
    tpl_id = _make_template().json()["id"]
    client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B2", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    return tpl_id


def test_add_sites_skips_existing():
    store = _store()
    tpl_id = _apply_two_sites(store)
    # Re-apply to B1 (existing) + B3 (new) via add-sites → only B3 generated.
    store["buildings"].append({"id": "B3", "name": "Tower C", "business_id": BIZ})
    r = client.post(f"/api/v1/initiatives/{INIT}/add-sites", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B3", "entity_type": "building"}],
        "start_date": "2026-08-01",
    })
    assert r.status_code == 200, r.text
    assert r.json()["instances"] == 1   # only B3
    assert r.json()["skipped"] == 1     # B1 already had it
    assert r.json()["tasks"] == 3
    assert len([t for t in store["tasks"] if t["entity_id"] == "B3"]) == 3


def test_reschedule_instance_shifts_whole_chain():
    store = _store()
    _apply_two_sites(store)
    inst = next(i for i in store["process_instances"] if i["entity_id"] == "B1")
    before = {t["id"]: t["start_date"] for t in store["tasks"] if t["process_instance_id"] == inst["id"]}
    r = client.post(f"/api/v1/process-instances/{inst['id']}/reschedule", json={"days": 5})
    assert r.status_code == 200, r.text
    assert r.json()["tasks"] == 3
    for t in store["tasks"]:
        if t["process_instance_id"] == inst["id"]:
            # every task moved +5 days
            assert t["start_date"] == _shift5(before[t["id"]])


def _shift5(iso):
    from datetime import date, timedelta
    return (date.fromisoformat(iso) + timedelta(days=5)).isoformat()


def test_shift_step_across_sites():
    store = _store()
    tpl_id = _apply_two_sites(store)
    # Find the 'Install' step id (order_index 1) and shift it across BOTH sites.
    step = next(s for s in store["process_template_steps"] if s["order_index"] == 1)
    installs_before = {t["id"]: t["start_date"] for t in store["tasks"] if t["template_step_id"] == step["id"]}
    assert len(installs_before) == 2  # one Install per site
    r = client.post(f"/api/v1/initiatives/{INIT}/shift-step", json={
        "template_step_id": step["id"], "days": 7,
    })
    assert r.status_code == 200, r.text
    assert r.json()["tasks"] == 2
    for t in store["tasks"]:
        if t["template_step_id"] == step["id"]:
            assert t["start_date"] == _shift7(installs_before[t["id"]])
    # Surveys (step 0) did NOT move.
    survey = next(s for s in store["process_template_steps"] if s["order_index"] == 0)
    for t in store["tasks"]:
        if t["template_step_id"] == survey["id"]:
            assert t["start_date"] == "2026-07-01"


def _shift7(iso):
    from datetime import date, timedelta
    return (date.fromisoformat(iso) + timedelta(days=7)).isoformat()


def test_per_step_owner_and_gate_generation():
    store = _store()
    store["users"] = [{"id": "u-1"}, {"id": "u-2"}]
    _setup(store)
    # Step 2 (Install) is owned by u-2 and GATED (all Surveys before any Install).
    tpl = client.post("/api/v1/process-templates", json={
        "business_id": BIZ, "name": "Gated",
        "steps": [
            {"title": "Survey", "duration_days": 2, "depends_on": []},
            {"title": "Install", "duration_days": 5, "depends_on": [0],
             "default_owner_id": "u-2", "gate": True},
        ],
    }).json()
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl["id"],
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B2", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 200, r.text
    assert r.json()["gates"] == 1
    # 2 sites × 2 steps + 1 gate task = 5
    assert r.json()["tasks"] == 5

    installs = [t for t in store["tasks"] if t["title"] == "Install"]
    assert len(installs) == 2
    assert all(t["primary_stakeholder_id"] == "u-2" for t in installs)   # per-step owner

    gate = next(t for t in store["tasks"] if t["title"].startswith("✓ Gate"))
    surveys = {t["id"] for t in store["tasks"] if t["title"] == "Survey"}
    assert set(gate["depends_on"]) == surveys                            # gate waits on ALL surveys
    for inst in installs:
        assert gate["id"] in (inst.get("depends_on") or [])             # each install waits on the gate


def test_step_rollup_counts_completion_across_sites():
    store = _store()
    tpl_id = _apply_two_sites(store)   # 3 steps × 2 sites = 6 tasks
    # Mark B1's Survey done and B1's Install in_progress; leave everything else.
    survey = next(s for s in store["process_template_steps"] if s["order_index"] == 0)
    install = next(s for s in store["process_template_steps"] if s["order_index"] == 1)
    for t in store["tasks"]:
        if t["entity_id"] == "B1" and t["template_step_id"] == survey["id"]:
            t["status"] = "done"
        if t["entity_id"] == "B1" and t["template_step_id"] == install["id"]:
            t["status"] = "in_progress"

    r = client.get(f"/api/v1/initiatives/{INIT}/step-rollup")
    assert r.status_code == 200, r.text
    body = r.json()["templates"]
    assert len(body) == 1
    tpl = body[0]
    assert tpl["template_id"] == tpl_id
    assert tpl["sites"] == 2
    steps = tpl["steps"]
    # Ordered by step order_index.
    assert [s["title"] for s in steps] == ["Survey", "Install", "Test"]
    assert (steps[0]["done"], steps[0]["total"]) == (1, 2)          # Survey 1/2
    assert steps[1]["in_progress"] == 1 and steps[1]["done"] == 0   # Install 0/2, 1 active
    assert (steps[2]["done"], steps[2]["not_started"]) == (0, 2)    # Test 0/2
    # Drill-in: which sites are behind on each step (done ones excluded).
    assert len(steps[0]["behind"]) == 1                             # Survey: only B2 left
    assert {b["status"] for b in steps[1]["behind"]} == {"in_progress", "backlog"}
    assert len(steps[2]["behind"]) == 2                             # Test: both sites


def test_step_rollup_empty_when_no_process_tasks():
    store = _store()
    _setup(store)
    r = client.get(f"/api/v1/initiatives/{INIT}/step-rollup")
    assert r.status_code == 200, r.text
    assert r.json()["templates"] == []


def test_save_initiative_as_template():
    store = _store()
    store["tasks"] = [
        {"id": "TA", "title": "Plan", "initiative_id": INIT, "start_date": "2026-07-01",
         "due_date": "2026-07-03", "priority": "high", "depends_on": [],
         "created_at": "2026-07-01T00:00:00+00:00"},
        {"id": "TB", "title": "Execute", "initiative_id": INIT, "start_date": "2026-07-03",
         "due_date": "2026-07-10", "priority": "medium", "depends_on": ["TA"],
         "created_at": "2026-07-02T00:00:00+00:00"},
    ]
    _setup(store)
    r = client.post(f"/api/v1/initiatives/{INIT}/save-as-template", json={"name": "From init"})
    assert r.status_code == 201, r.text
    steps = r.json()["steps"]
    assert [s["title"] for s in steps] == ["Plan", "Execute"]
    assert steps[0]["duration_days"] == 2 and steps[1]["duration_days"] == 7
    assert steps[1]["depends_on"] == [0]   # Execute depends on Plan (order 0)


# ── #1 atomicity ─────────────────────────────────────────────────────────────
def test_apply_is_atomic_when_task_batch_fails():
    """If the task batch insert fails, the just-created instances are rolled back
    → net no-op (no half-applied process)."""
    store = _store()
    fake = FakeSupabase(store)
    fake.fail_inserts.add("tasks")
    app.dependency_overrides[get_current_user] = lambda: {"id": U, "email": "u@x.io"}
    app.dependency_overrides[get_supabase] = lambda: fake
    tpl_id = _make_template().json()["id"]   # template steps insert OK (only tasks fail)

    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B2", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 500
    assert store["tasks"] == []                 # no tasks
    assert store["process_instances"] == []     # instances rolled back


def test_apply_rejects_unknown_site_before_any_write():
    """Validation is fail-fast: an unknown site at position 2 leaves position 1
    un-written (the old per-row loop orphaned the first site)."""
    store = _store()
    _setup(store)
    tpl_id = _make_template().json()["id"]
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "NOPE", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 404
    assert store["tasks"] == []
    assert store["process_instances"] == []


# ── #4 no silent duplicates ──────────────────────────────────────────────────
def test_apply_skips_duplicate_sites_and_reports_them():
    store = _store()
    tpl_id = _apply_two_sites(store)   # B1 + B2
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"}],
        "start_date": "2026-09-01",
    })
    assert r.status_code == 200, r.text
    assert r.json()["instances"] == 0
    assert r.json()["skipped"] == 1
    assert r.json()["skipped_sites"] == ["Tower A"]   # reported by name
    assert len(store["tasks"]) == 6                    # unchanged


def test_apply_allow_duplicates_forces_a_second_chain():
    store = _store()
    tpl_id = _apply_two_sites(store)
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl_id,
        "sites": [{"entity_id": "B1", "entity_type": "building"}],
        "start_date": "2026-09-01",
        "allow_duplicates": True,
    })
    assert r.status_code == 200, r.text
    assert r.json()["instances"] == 1 and r.json()["skipped"] == 0
    assert len(store["tasks"]) == 9   # 6 + a second B1 chain


# ── #2 summary notification ──────────────────────────────────────────────────
def test_apply_sends_one_summary_to_assigned_owners_not_per_task():
    store = _store()
    store["users"] = [{"id": "u-1"}, {"id": "u-2"}]
    _setup(store)
    tpl = client.post("/api/v1/process-templates", json={
        "business_id": BIZ, "name": "Handoff",
        "steps": [
            {"title": "Survey", "duration_days": 1, "depends_on": []},
            {"title": "Install", "duration_days": 1, "depends_on": [0], "default_owner_id": "u-2"},
        ],
    }).json()
    r = client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl["id"],
        "sites": [{"entity_id": "B1", "entity_type": "building"},
                  {"entity_id": "B2", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    assert r.status_code == 200, r.text
    assert r.json()["tasks"] == 4
    # 4 tasks created, but u-2 gets ONE summary — not one ping per task.
    msgs = store["messages"]
    assert len(msgs) == 1
    assert msgs[0]["user_id"] == "u-2"
    assert msgs[0]["template"] == "process_applied"


# ── #3 template-edit keeps step IDs (live tasks stay linked) ──────────────────
def test_template_edit_preserves_step_ids():
    store = _store()
    _setup(store)
    tpl = _make_template().json()
    ids_before = [s["id"] for s in tpl["steps"]]
    client.post(f"/api/v1/initiatives/{INIT}/apply-process", json={
        "template_id": tpl["id"],
        "sites": [{"entity_id": "B1", "entity_type": "building"}],
        "start_date": "2026-07-01",
    })
    r = client.patch(f"/api/v1/process-templates/{tpl['id']}", json={
        "steps": [
            {"title": "Survey v2", "duration_days": 3, "depends_on": []},
            {"title": "Install v2", "duration_days": 6, "depends_on": [0]},
            {"title": "Test v2", "duration_days": 2, "depends_on": [1]},
        ],
    })
    assert r.status_code == 200, r.text
    assert [s["id"] for s in r.json()["steps"]] == ids_before   # IDs preserved
    assert [s["title"] for s in r.json()["steps"]] == ["Survey v2", "Install v2", "Test v2"]
    # the generated task still resolves to a live step (not orphaned).
    linked = [t for t in store["tasks"] if t.get("template_step_id") == ids_before[0]]
    assert len(linked) == 1


def test_template_edit_fewer_steps_drops_only_trailing():
    store = _store()
    _setup(store)
    tpl = _make_template().json()
    ids_before = [s["id"] for s in tpl["steps"]]
    r = client.patch(f"/api/v1/process-templates/{tpl['id']}", json={
        "steps": [
            {"title": "Survey", "duration_days": 2, "depends_on": []},
            {"title": "Install", "duration_days": 5, "depends_on": [0]},
        ],
    })
    assert r.status_code == 200, r.text
    steps = r.json()["steps"]
    assert len(steps) == 2
    assert [s["id"] for s in steps] == ids_before[:2]   # first two kept, third removed
