"""Process Templates ("Playbooks") — reusable multi-step processes applied to
many sites at once (the 50-buildings × 3-steps = one click case).

A template defines ordered STEPS (each becomes a Task) + an intra-step
dependency pattern. Applying it to N buildings/clients fans out N independent,
dependency-wired, dated task chains — one `process_instance` per site.

Fan-out inserts tasks directly (not via create_task), so the 150 "assigned"
notifications are NOT fired — the caller gets one summary instead.
"""
import uuid
from datetime import date, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from supabase import Client

from auth import get_current_user
from automation.notify import notify
from deps import get_supabase, require_member, require_admin_or_owner

router = APIRouter(prefix="/api/v1", tags=["process_templates"])

_PRIORITIES = ("low", "medium", "high", "urgent")


# ── models ──────────────────────────────────────────────────────────────────
class StepIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    duration_days: int = Field(default=1, ge=0, le=3650)
    default_priority: Literal["low", "medium", "high", "urgent"] = "medium"
    depends_on: List[int] = []  # prior order_indexes
    default_owner_id: Optional[str] = None   # P4: per-step owner (handoff)
    gate: bool = False                       # P4: all-sites gate before this step


class TemplateCreate(BaseModel):
    business_id: str
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = None
    steps: List[StepIn] = []


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    description: Optional[str] = None
    steps: Optional[List[StepIn]] = None  # when present, replaces the step list


class SiteIn(BaseModel):
    entity_id: str
    entity_type: Literal["building", "client"]


class ApplyIn(BaseModel):
    template_id: str
    sites: List[SiteIn] = Field(min_length=1)
    start_date: date
    owner_id: Optional[str] = None
    allow_duplicates: bool = False  # re-apply to a site already running this template


# ── helpers ─────────────────────────────────────────────────────────────────
def _initiative_or_404(sb: Client, initiative_id: str) -> dict:
    rows = sb.table("initiatives").select("*").eq("id", initiative_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Initiative not found")
    return rows[0]


def _template_with_steps(sb: Client, template_id: str, business_id: str) -> dict:
    rows = (
        sb.table("process_templates").select("*")
        .eq("id", template_id).eq("business_id", business_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    tpl = rows[0]
    steps = (
        sb.table("process_template_steps").select("*")
        .eq("template_id", template_id).order("order_index").execute().data
    )
    tpl["steps"] = steps
    return tpl


def _site_in_business_or_404(sb: Client, site: SiteIn, business_id: str) -> str:
    tbl = "buildings" if site.entity_type == "building" else "clients"
    rows = (
        sb.table(tbl).select("id, name").eq("id", site.entity_id)
        .eq("business_id", business_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Site not found in this workspace")
    return rows[0].get("name") or "Site"


def _step_fields(s: StepIn, order_index: int, n_steps: int) -> dict:
    """The persisted shape of one step (sans template_id), shared by create + edit."""
    return {
        "order_index": order_index,
        "title": s.title.strip(), "description": s.description,
        "duration_days": s.duration_days, "default_priority": s.default_priority,
        "depends_on": [d for d in s.depends_on if 0 <= d < n_steps],
        "default_owner_id": s.default_owner_id,
        "gate": bool(s.gate),
    }


def _insert_steps(sb: Client, template_id: str, steps: List[StepIn]) -> None:
    if not steps:
        return
    payload = [{"template_id": template_id, **_step_fields(s, i, len(steps))}
               for i, s in enumerate(steps)]
    sb.table("process_template_steps").insert(payload).execute()


# ── template CRUD ───────────────────────────────────────────────────────────
@router.get("/process-templates")
def list_templates(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    tpls = (
        sb.table("process_templates").select("*")
        .eq("business_id", business_id).is_("archived_at", "null")
        .order("created_at", desc=True).execute().data
    )
    if not tpls:
        return []
    ids = [t["id"] for t in tpls]
    steps = (
        sb.table("process_template_steps").select("*")
        .in_("template_id", ids).order("order_index").execute().data
    )
    by_tpl: dict = {}
    for s in steps:
        by_tpl.setdefault(s["template_id"], []).append(s)
    for t in tpls:
        t["steps"] = by_tpl.get(t["id"], [])
    return tpls


@router.post("/process-templates", status_code=201)
def create_template(
    body: TemplateCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_admin_or_owner(sb, body.business_id, user["id"])
    rows = sb.table("process_templates").insert({
        "business_id": body.business_id, "name": body.name.strip(),
        "description": body.description, "created_by": user["id"],
    }).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to create template")
    tpl = rows[0]
    _insert_steps(sb, tpl["id"], body.steps)
    return _template_with_steps(sb, tpl["id"], body.business_id)


class FromInitiativeIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: Optional[str] = None


@router.post("/initiatives/{initiative_id}/save-as-template", status_code=201)
def save_initiative_as_template(
    initiative_id: str,
    body: FromInitiativeIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Clone an initiative's UN-SITED tasks into a reusable template (the
    'save as Playbook' authoring path). Each top-level task → a step; its
    duration is derived from its date span; task-level depends_on is mapped to
    step order-indexes. Site-owned (entity_id) tasks are skipped (they're
    instances of a process, not the definition)."""
    init = _initiative_or_404(sb, initiative_id)
    biz = init["business_id"]
    require_admin_or_owner(sb, biz, user["id"])
    tasks = (
        sb.table("tasks")
        .select("id, title, description, start_date, due_date, priority, depends_on, created_at, entity_id")
        .eq("initiative_id", initiative_id).is_("archived_at", "null").execute().data
    )
    tasks = [t for t in tasks if not t.get("entity_id")]
    tasks.sort(key=lambda t: (t.get("start_date") or t.get("created_at") or ""))
    if not tasks:
        raise HTTPException(status_code=400, detail="This initiative has no un-sited tasks to template")

    idx_of = {t["id"]: i for i, t in enumerate(tasks)}
    steps: List[StepIn] = []
    for t in tasks:
        dur = 1
        if t.get("start_date") and t.get("due_date"):
            try:
                dur = max(0, (date.fromisoformat(t["due_date"][:10]) - date.fromisoformat(t["start_date"][:10])).days)
            except Exception:
                dur = 1
        deps = [idx_of[d] for d in (t.get("depends_on") or []) if d in idx_of and idx_of[d] < idx_of[t["id"]]]
        steps.append(StepIn(
            title=t["title"], description=t.get("description"),
            duration_days=dur or 1,
            default_priority=t.get("priority") if t.get("priority") in _PRIORITIES else "medium",
            depends_on=deps,
        ))

    rows = sb.table("process_templates").insert({
        "business_id": biz, "name": body.name.strip(),
        "description": body.description, "created_by": user["id"],
    }).execute().data
    tpl = rows[0]
    _insert_steps(sb, tpl["id"], steps)
    return _template_with_steps(sb, tpl["id"], biz)


@router.patch("/process-templates/{template_id}")
def update_template(
    template_id: str,
    body: TemplateUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("process_templates").select("*").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    tpl = rows[0]
    require_admin_or_owner(sb, tpl["business_id"], user["id"])
    patch: dict = {}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.description is not None:
        patch["description"] = body.description
    if patch:
        sb.table("process_templates").update(patch).eq("id", template_id).execute()
    if body.steps is not None:
        _sync_steps(sb, template_id, body.steps)
    return _template_with_steps(sb, template_id, tpl["business_id"])


def _sync_steps(sb: Client, template_id: str, steps: List[StepIn]) -> None:
    """Reconcile a template's steps WITHOUT churning step IDs — generated tasks
    carry template_step_id, so blowing the rows away (old behaviour) silently
    orphaned every running instance. We update existing steps in place (matched
    by position), append new ones, and delete only the trailing steps that no
    longer exist. IDs for surviving steps are preserved → live tasks stay linked.
    """
    existing = (
        sb.table("process_template_steps").select("id, order_index")
        .eq("template_id", template_id).order("order_index").execute().data
    )
    by_oi = {e["order_index"]: e["id"] for e in existing}
    n = len(steps)
    for i, s in enumerate(steps):
        fields = _step_fields(s, i, n)
        if i in by_oi:
            sb.table("process_template_steps").update(fields).eq("id", by_oi[i]).execute()
        else:
            sb.table("process_template_steps").insert({"template_id": template_id, **fields}).execute()
    stale = [oi for oi in by_oi if oi >= n]
    if stale:
        (sb.table("process_template_steps").delete()
         .eq("template_id", template_id).in_("order_index", stale).execute())


@router.delete("/process-templates/{template_id}", status_code=204)
def delete_template(
    template_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("process_templates").select("business_id").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Template not found")
    require_admin_or_owner(sb, rows[0]["business_id"], user["id"])
    from datetime import datetime, timezone
    sb.table("process_templates").update(
        {"archived_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", template_id).execute()
    return


# ── the generator ───────────────────────────────────────────────────────────
def _notify_process_applied(sb, *, biz, actor_id, initiative_id, init_name,
                            tpl_name, owners: set, tasks: int, sites: int) -> None:
    """ONE summary per distinct assigned owner (not 150 per-task pings). The
    actor is dropped + dupes collapsed by notify(); we skip the call entirely
    when nobody else is involved so a self-assigned fan-out stays silent."""
    recipients = {o for o in owners if o and o != actor_id}
    if not recipients:
        return
    s = "" if sites == 1 else "s"
    notify(
        sb, type="process_applied", business_id=biz, actor_id=actor_id,
        recipients=recipients,
        title=f"{tpl_name} applied to {sites} site{s}",
        body=f"{tasks} tasks were created across {sites} site{s} in “{init_name}”. "
             f"Some are assigned to you.",
        entity_type="initiative", entity_id=initiative_id,
        props={"template": tpl_name, "tasks": tasks, "sites": sites},
    )


def _apply_to_sites(sb, user, initiative_id, body: "ApplyIn", *, allow_duplicates: bool):
    """Shared fan-out used by apply-process + add-sites. Three guarantees the
    earlier per-row version lacked:

    1. **Fail-fast** — EVERY requested site is validated before a single row is
       written (an unknown site can no longer leave a half-applied process).
    2. **Atomic + cheap** — all task IDs are generated client-side so the whole
       fan-out (chains + cross-site gates, fully dependency-wired) is TWO batch
       inserts regardless of site count, not ~3 round-trips per task. If the task
       batch fails, the just-created instances are removed → net no-op.
    3. **No silent duplicates** — sites already running this template are skipped
       (unless allow_duplicates) and reported back, so re-applying is safe.
    """
    init = _initiative_or_404(sb, initiative_id)
    biz = init["business_id"]
    require_admin_or_owner(sb, biz, user["id"])
    tpl = _template_with_steps(sb, body.template_id, biz)
    steps = tpl["steps"]
    if not steps:
        raise HTTPException(status_code=400, detail="This template has no steps")
    owner = body.owner_id or init.get("primary_stakeholder_id") or init.get("owner_id")
    if not owner:
        raise HTTPException(status_code=400, detail="No owner could be resolved for the tasks")

    existing_sites: set = set()
    if not allow_duplicates:
        for r in (sb.table("process_instances").select("entity_id, template_id")
                  .eq("initiative_id", initiative_id).is_("archived_at", "null").execute().data):
            if r.get("template_id") == body.template_id:
                existing_sites.add(r.get("entity_id"))

    # ── validate ALL sites up front (read-only) → fail before any write ──
    targets: list = []        # (SiteIn, name) to generate
    skipped_sites: list = []  # names already running this template
    for site in body.sites:
        name = _site_in_business_or_404(sb, site, biz)
        if not allow_duplicates and site.entity_id in existing_sites:
            skipped_sites.append(name)
        else:
            targets.append((site, name))

    if not targets:
        return {"instances": 0, "tasks": 0, "sites": 0, "template": tpl["name"],
                "skipped": len(skipped_sites), "skipped_sites": skipped_sites,
                "gates": 0, "instance_ids": []}

    # ── build everything in memory with client-generated UUIDs ──
    instance_rows: list = []
    task_rows: list = []
    by_step: dict = {}        # order_index -> [task_id across all sites] (gates)
    owners_assigned: set = set()
    sd_iso = body.start_date.isoformat()

    for site, name in targets:
        inst_id = str(uuid.uuid4())
        instance_rows.append({
            "id": inst_id, "business_id": biz, "initiative_id": initiative_id,
            "template_id": body.template_id, "entity_id": site.entity_id,
            "entity_type": site.entity_type, "label": f"{tpl['name']} · {name}",
            "start_date": sd_iso,
        })
        cursor = body.start_date
        step_task: dict = {}      # order_index -> task_id (this site)
        site_rows: list = []
        for step in steps:
            tid = str(uuid.uuid4())
            start = cursor
            due = start + timedelta(days=int(step.get("duration_days") or 1))
            t_owner = step.get("default_owner_id") or owner
            owners_assigned.add(t_owner)
            site_rows.append((step, {
                "id": tid,
                "title": step["title"], "description": step.get("description"),
                "initiative_id": initiative_id,
                "primary_stakeholder_id": t_owner, "created_by": user["id"],
                "priority": step.get("default_priority") or "medium",
                "status": "backlog",
                "start_date": start.isoformat(), "due_date": due.isoformat(),
                "baseline_start_date": start.isoformat(), "baseline_due_date": due.isoformat(),
                "date_mode": "uniform", "entity_inheritance": "inherited",
                "entity_id": site.entity_id, "entity_type": site.entity_type,
                "process_instance_id": inst_id, "template_step_id": step["id"],
                "depends_on": [],
            }))
            step_task[step["order_index"]] = tid
            by_step.setdefault(step["order_index"], []).append(tid)
            cursor = due
        # wire intra-site deps now that all this site's task IDs exist
        for step, row in site_rows:
            row["depends_on"] = [step_task[i] for i in (step.get("depends_on") or []) if i in step_task]
            task_rows.append(row)

    # ── P4 gates: one gate task per gated boundary (O(2·sites), not O(sites²)).
    # Gate depends on the previous step at EVERY site; each gated-step task gains
    # the gate as a dep. Unsited (no entity) → a coordination row on the timeline.
    gates = 0
    due_by_id = {r["id"]: r["due_date"] for r in task_rows}
    for step in steps:
        oi = step["order_index"]
        if not step.get("gate") or oi == 0:
            continue
        prev_ids = by_step.get(oi - 1, [])
        cur_ids = by_step.get(oi, [])
        if not prev_ids or not cur_ids:
            continue
        gate_due = max((due_by_id[i] for i in prev_ids if i in due_by_id), default=sd_iso)
        gate_id = str(uuid.uuid4())
        task_rows.append({
            "id": gate_id,
            "title": f"✓ Gate: all '{steps[oi - 1]['title']}' complete",
            "initiative_id": initiative_id,
            "primary_stakeholder_id": owner, "created_by": user["id"],
            "priority": "high", "status": "backlog",
            "start_date": gate_due, "due_date": gate_due,
            "baseline_start_date": gate_due, "baseline_due_date": gate_due,
            "date_mode": "uniform", "entity_inheritance": "inherited",
            "depends_on": list(prev_ids),
        })
        cur_set = set(cur_ids)
        for r in task_rows:
            if r["id"] in cur_set:
                r["depends_on"] = list({*r["depends_on"], gate_id})
        gates += 1

    # ── write: instances first (FK target), then ALL tasks in one batch.
    # A list insert is a single atomic statement; if it fails, undo the instances.
    instance_ids = [r["id"] for r in instance_rows]
    sb.table("process_instances").insert(instance_rows).execute()
    try:
        sb.table("tasks").insert(task_rows).execute()
    except Exception:
        sb.table("process_instances").delete().in_("id", instance_ids).execute()
        raise HTTPException(status_code=500,
                            detail="Couldn't generate the process — no changes were made.")

    _notify_process_applied(
        sb, biz=biz, actor_id=user["id"], initiative_id=initiative_id,
        init_name=init.get("name") or "this initiative", tpl_name=tpl["name"],
        owners=owners_assigned, tasks=len(task_rows), sites=len(targets))

    return {"instances": len(instance_rows), "tasks": len(task_rows),
            "sites": len(targets), "template": tpl["name"],
            "skipped": len(skipped_sites), "skipped_sites": skipped_sites,
            "gates": gates, "instance_ids": instance_ids}


@router.post("/initiatives/{initiative_id}/apply-process")
def apply_process(
    initiative_id: str,
    body: ApplyIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Fan out a template across sites → one task chain per site. Admin/lead
    only. Per-task 'assigned' pings are suppressed; assigned owners get ONE
    summary instead. Sites already running this template are skipped + reported
    (pass allow_duplicates=true to force a second chain)."""
    return _apply_to_sites(sb, user, initiative_id, body, allow_duplicates=body.allow_duplicates)


@router.post("/initiatives/{initiative_id}/add-sites")
def add_sites(
    initiative_id: str,
    body: ApplyIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Apply a process to NEW sites only — sites already running this template
    are skipped (idempotent add). Returns counts incl. how many were skipped."""
    return _apply_to_sites(sb, user, initiative_id, body, allow_duplicates=False)


@router.get("/initiatives/{initiative_id}/process-instances")
def list_instances(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init = _initiative_or_404(sb, initiative_id)
    require_member(sb, init["business_id"], user["id"])
    rows = (
        sb.table("process_instances").select("*")
        .eq("initiative_id", initiative_id).is_("archived_at", "null")
        .order("created_at", desc=True).execute().data
    )
    return rows


@router.get("/initiatives/{initiative_id}/step-rollup")
def step_rollup(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """The 'killer report' at scale: per-step completion across every site —
    `Survey 50/50 · Install 12/50 · Test 0/50`. Aggregates the process-generated
    tasks (those carrying a template_step_id) of this initiative, grouped by the
    template they came from then by step order. Gate tasks (no template_step_id)
    are excluded — they're coordination rows, not steps. Members can read."""
    init = _initiative_or_404(sb, initiative_id)
    require_member(sb, init["business_id"], user["id"])

    tasks = (
        sb.table("tasks")
        .select("id, status, template_step_id, entity_id, process_instance_id, due_date")
        .eq("initiative_id", initiative_id).is_("archived_at", "null").execute().data
    )
    tasks = [t for t in tasks if t.get("template_step_id")]
    if not tasks:
        return {"templates": []}

    step_ids = list({t["template_step_id"] for t in tasks})
    steps = (
        sb.table("process_template_steps").select("*")
        .in_("id", step_ids).execute().data
    )
    step_map = {s["id"]: s for s in steps}
    tpl_ids = list({s["template_id"] for s in step_map.values()})
    tpls = (
        sb.table("process_templates").select("id, name")
        .in_("id", tpl_ids).execute().data
    ) if tpl_ids else []
    tpl_name = {t["id"]: t["name"] for t in tpls}

    # Instance labels → so drill-in can name WHICH sites are behind on a step.
    inst_ids = list({t.get("process_instance_id") for t in tasks if t.get("process_instance_id")})
    insts = (
        sb.table("process_instances").select("id, label, entity_id")
        .in_("id", inst_ids).execute().data
    ) if inst_ids else []
    inst_label = {i["id"]: (i.get("label") or "Site") for i in insts}

    today = date.today().isoformat()
    # template_id -> {step_id -> agg}, plus distinct sites per template
    by_tpl: dict = {}
    sites_by_tpl: dict = {}
    finish_by_tpl: dict = {}   # tid -> (max_due, instance_id) → slowest/critical site
    for t in tasks:
        st = step_map.get(t["template_step_id"])
        if not st:
            continue
        tid = st["template_id"]
        due = (t.get("due_date") or "")[:10]
        if due and due > finish_by_tpl.get(tid, ("", None))[0]:
            finish_by_tpl[tid] = (due, t.get("process_instance_id"))
        steps_agg = by_tpl.setdefault(tid, {})
        a = steps_agg.setdefault(st["id"], {
            "step_id": st["id"], "title": st["title"],
            "order_index": st["order_index"],
            "total": 0, "done": 0, "in_progress": 0, "blocked": 0,
            "not_started": 0, "overdue": 0,
            "behind": [],  # sites not yet done on this step (drill-in)
        })
        a["total"] += 1
        status = t.get("status")
        overdue = status != "done" and bool(t.get("due_date")) and t["due_date"][:10] < today
        if status == "done":
            a["done"] += 1
        elif status == "blocked":
            a["blocked"] += 1
        elif status == "in_progress":
            a["in_progress"] += 1
        else:  # backlog | todo
            a["not_started"] += 1
        if overdue:
            a["overdue"] += 1
        if status != "done":
            a["behind"].append({
                "label": inst_label.get(t.get("process_instance_id"), "Site"),
                "status": status, "overdue": overdue,
            })
        sites_by_tpl.setdefault(tid, set()).add(t.get("process_instance_id"))

    # Surface the most-stuck sites first within each step (overdue, then blocked).
    _rank = {"blocked": 0, "todo": 2, "backlog": 2, "in_progress": 3}
    for steps_agg in by_tpl.values():
        for a in steps_agg.values():
            a["behind"].sort(key=lambda b: (not b["overdue"], _rank.get(b["status"], 4), b["label"].lower()))

    out = []
    for tid, steps_agg in by_tpl.items():
        rows = sorted(steps_agg.values(), key=lambda r: r["order_index"])
        fin_due, fin_inst = finish_by_tpl.get(tid, (None, None))
        out.append({
            "template_id": tid,
            "name": tpl_name.get(tid) or "(deleted template)",
            "sites": len(sites_by_tpl.get(tid, set())),
            "steps": rows,
            # Critical path: the latest-finishing site sets the whole rollout's end.
            "finish_date": fin_due,
            "slowest_site": inst_label.get(fin_inst) if fin_inst else None,
        })
    out.sort(key=lambda r: r["name"].lower())
    return {"templates": out}


@router.delete("/process-instances/{instance_id}", status_code=204)
def delete_instance(
    instance_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Remove a site's generated chain — CASCADE drops its tasks."""
    rows = sb.table("process_instances").select("business_id").eq("id", instance_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Instance not found")
    require_admin_or_owner(sb, rows[0]["business_id"], user["id"])
    sb.table("process_instances").delete().eq("id", instance_id).execute()
    return


# ── P3: manage at scale ─────────────────────────────────────────────────────
class ShiftIn(BaseModel):
    days: int  # +/- whole days


def _shift_iso(d: Optional[str], days: int) -> Optional[str]:
    if not d:
        return d
    try:
        return (date.fromisoformat(d[:10]) + timedelta(days=days)).isoformat()
    except Exception:
        return d


def _shift_tasks(sb: Client, tasks: list, days: int) -> int:
    """Shift each task's start+due by N days in ONE batch upsert (was a per-task
    update loop). Each row keeps its own absolute dates; only those columns are
    written, so nothing else on the task is touched."""
    payload = [{
        "id": t["id"],
        "start_date": _shift_iso(t.get("start_date"), days),
        "due_date": _shift_iso(t.get("due_date"), days),
    } for t in tasks]
    if payload:
        sb.table("tasks").upsert(payload, on_conflict="id").execute()
    return len(payload)


@router.post("/process-instances/{instance_id}/reschedule")
def reschedule_instance(
    instance_id: str,
    body: ShiftIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Shift an ENTIRE site's chain by N days (drag-the-lane). Moves every task's
    start + due together so the dependency sequence stays intact."""
    rows = sb.table("process_instances").select("*").eq("id", instance_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Instance not found")
    inst = rows[0]
    require_admin_or_owner(sb, inst["business_id"], user["id"])
    tasks = sb.table("tasks").select("id, start_date, due_date").eq("process_instance_id", instance_id).execute().data
    _shift_tasks(sb, tasks, body.days)
    if inst.get("start_date"):
        sb.table("process_instances").update(
            {"start_date": _shift_iso(inst["start_date"], body.days)}
        ).eq("id", instance_id).execute()
    return {"tasks": len(tasks), "days": body.days}


class ShiftStepIn(BaseModel):
    template_step_id: str
    days: int


@router.post("/initiatives/{initiative_id}/shift-step")
def shift_step_across_sites(
    initiative_id: str,
    body: ShiftStepIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Shift ONE step across EVERY site by N days (e.g. 'all Installs slip a
    week'). Moves only the tasks carrying that template_step_id in this
    initiative."""
    init = _initiative_or_404(sb, initiative_id)
    require_admin_or_owner(sb, init["business_id"], user["id"])
    tasks = (
        sb.table("tasks").select("id, start_date, due_date")
        .eq("initiative_id", initiative_id)
        .eq("template_step_id", body.template_step_id).execute().data
    )
    n = _shift_tasks(sb, tasks, body.days)
    return {"tasks": n, "days": body.days}
