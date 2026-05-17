from typing import List, Literal, Optional
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase, require_member, get_member_role

router = APIRouter(prefix="/api/v1/initiatives", tags=["initiatives"])


class EntityAssignment(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str
    per_entity_end_date: Optional[date] = None


class InitiativeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    business_id: str
    program_id: Optional[str] = None
    theme_id: Optional[str] = None
    primary_stakeholder_id: Optional[str] = None
    impact: Optional[str] = None
    impact_metric: Optional[str] = None
    impact_category: Optional[str] = "other"
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None
    date_mode: Literal["uniform", "per_entity"] = "uniform"
    entities: List[EntityAssignment] = []


@router.get("/my")
def get_my_initiatives(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return initiatives where the current user is the primary stakeholder or owner."""
    uid = user["id"]
    rows = (
        sb.table("initiatives")
        .select("id, name, status, impact, impact_category, primary_stakeholder_id, owner_id, program_id, target_end_date, programs(id, name, color)")
        .or_(f"primary_stakeholder_id.eq.{uid},owner_id.eq.{uid}")
        .neq("status", "cancelled")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    # Resolve primary stakeholder names
    ps_ids = list({r["primary_stakeholder_id"] for r in rows if r.get("primary_stakeholder_id")})
    ps_map: dict = {}
    if ps_ids:
        users_rows = sb.table("users").select("id, name").in_("id", ps_ids).execute().data
        ps_map = {u["id"]: u["name"] for u in users_rows}
    for r in rows:
        r["primary_stakeholder_name"] = ps_map.get(r.get("primary_stakeholder_id") or "", "")
    return rows


@router.post("/", status_code=201)
@router.post("", status_code=201, include_in_schema=False)
def create_initiative(
    body: InitiativeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, body.business_id, user["id"])

    primary_stakeholder_id = body.primary_stakeholder_id or user["id"]

    result = sb.table("initiatives").insert({
        "name": body.name,
        "description": body.description,
        "business_id": body.business_id,
        "owner_id": user["id"],
        "primary_stakeholder_id": primary_stakeholder_id,
        "program_id": body.program_id,
        "theme_id": body.theme_id,
        "impact": body.impact,
        "impact_metric": body.impact_metric,
        "impact_category": body.impact_category or "other",
        "start_date": body.start_date.isoformat() if body.start_date else None,
        "target_end_date": body.target_end_date.isoformat() if body.target_end_date else None,
        "date_mode": body.date_mode,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create initiative",
        )

    initiative = result.data[0]

    if body.entities:
        initiative_id = initiative["id"]
        entity_rows = [
            {
                "initiative_id": initiative_id,
                "entity_type": ea.entity_type,
                "entity_id": ea.entity_id,
                "per_entity_end_date": ea.per_entity_end_date.isoformat() if ea.per_entity_end_date else None,
            }
            for ea in body.entities
        ]
        entities_result = sb.table("initiative_entities").insert(entity_rows).execute()
        if not entities_result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to assign entities to initiative",
            )

    return initiative


@router.get("/business/{business_id}")
def list_initiatives_for_business(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    initiatives = (
        sb.table("initiatives")
        .select("*, initiative_entities(*), programs(id, name), themes!fk_initiative_theme(id, name, color, program_id)")
        .eq("business_id", business_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )
    # Resolve owner names
    owner_ids = list({i["owner_id"] for i in initiatives if i.get("owner_id")})
    owner_map: dict = {}
    if owner_ids:
        rows = sb.table("users").select("id, name").in_("id", owner_ids).execute().data
        owner_map = {r["id"]: r["name"] for r in rows}
    for init in initiatives:
        init["owner_name"] = owner_map.get(init.get("owner_id") or "", "")
    return initiatives


@router.get("/{initiative_id}")
def get_initiative(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    data = (
        sb.table("initiatives")
        .select("*, initiative_entities(*), programs(id, name), themes!fk_initiative_theme(id, name, color, program_id)")
        .eq("id", initiative_id)
        .execute()
        .data
    )
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Initiative not found",
        )
    initiative = data[0]
    require_member(sb, initiative["business_id"], user["id"])
    # Resolve owner name
    if initiative.get("owner_id"):
        owner = sb.table("users").select("id, name").eq("id", initiative["owner_id"]).execute().data
        initiative["owner_name"] = owner[0]["name"] if owner else ""
    return initiative


class InitiativeEntityAdd(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str


@router.get("/business/{business_id}/with-tasks")
def list_initiatives_with_tasks(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return all initiatives for a business with their entities and tasks (used by Tasks page)."""
    require_member(sb, business_id, user["id"])

    # Check if user is owner or admin
    member_row = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    member_role = member_row[0]["role"] if member_row else "member"
    is_privileged = member_role in ("owner", "admin")

    # Fetch initiatives
    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, program_id, target_end_date")
        .eq("business_id", business_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    if not initiatives:
        return []

    init_ids = [i["id"] for i in initiatives]
    program_ids = list({i["program_id"] for i in initiatives if i.get("program_id")})

    # Resolve program names
    program_map: dict = {}
    if program_ids:
        progs = sb.table("programs").select("id, name, color").in_("id", program_ids).execute().data
        program_map = {p["id"]: p for p in progs}

    # Fetch initiative entities with names
    entity_rows = (
        sb.table("initiative_entities")
        .select("initiative_id, entity_type, entity_id")
        .in_("initiative_id", init_ids)
        .execute()
        .data
    )
    building_ids = list({e["entity_id"] for e in entity_rows if e["entity_type"] == "building"})
    client_ids   = list({e["entity_id"] for e in entity_rows if e["entity_type"] == "client"})
    entity_name_map: dict = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            entity_name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            entity_name_map[r["id"]] = r["name"]
    for e in entity_rows:
        e["entity_name"] = entity_name_map.get(e["entity_id"], e["entity_id"])

    entities_by_init: dict = {}
    for e in entity_rows:
        entities_by_init.setdefault(e["initiative_id"], []).append(e)

    # Fetch tasks
    tasks = (
        sb.table("tasks")
        .select("id, title, status, due_date, description, primary_stakeholder_id, initiative_id")
        .in_("initiative_id", init_ids)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Resolve task assignee names + collect stakeholder task_ids for current user
    all_stakeholder_rows = []
    if init_ids:
        task_ids = [t["id"] for t in tasks]
        if task_ids:
            all_stakeholder_rows = (
                sb.table("task_stakeholders")
                .select("task_id, user_id, role")
                .in_("task_id", task_ids)
                .execute()
                .data
            )

    # Tasks this user has stake in (for edit access on non-privileged users)
    user_stakeholder_task_ids = {
        s["task_id"] for s in all_stakeholder_rows if s["user_id"] == user["id"]
    }
    user_primary_task_ids = {t["id"] for t in tasks if t.get("primary_stakeholder_id") == user["id"]}
    user_task_ids = user_primary_task_ids | user_stakeholder_task_ids

    assignee_ids = list({t["primary_stakeholder_id"] for t in tasks if t.get("primary_stakeholder_id")})
    assignee_map: dict = {}
    if assignee_ids:
        rows = sb.table("users").select("id, name").in_("id", assignee_ids).execute().data
        assignee_map = {r["id"]: r["name"] for r in rows}

    for t in tasks:
        t["assignee_name"] = assignee_map.get(t.get("primary_stakeholder_id") or "", "")

    tasks_by_init: dict = {}
    for t in tasks:
        tasks_by_init.setdefault(t["initiative_id"], []).append(t)

    # Assemble result
    result = []
    for init in initiatives:
        iid = init["id"]
        init_tasks = tasks_by_init.get(iid, [])

        # viewer_can_edit: owner/admin always; member if they're stakeholder on any task here
        if is_privileged:
            can_edit = True
        else:
            init_task_ids = {t["id"] for t in init_tasks}
            can_edit = bool(init_task_ids & user_task_ids)

        prog = program_map.get(init.get("program_id") or "", {})
        result.append({
            **init,
            "program_name": prog.get("name", ""),
            "program_color": prog.get("color", "#E53E3E"),
            "entities": entities_by_init.get(iid, []),
            "tasks": init_tasks,
            "viewer_can_edit": can_edit,
        })

    return result


@router.get("/{initiative_id}/initiative-entities")
def list_initiative_entities_detail(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, init["business_id"], user["id"])
    rows = (
        sb.table("initiative_entities")
        .select("entity_type, entity_id")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )
    building_ids = [r["entity_id"] for r in rows if r["entity_type"] == "building"]
    client_ids   = [r["entity_id"] for r in rows if r["entity_type"] == "client"]
    name_map: dict = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            name_map[r["id"]] = r["name"]
    for r in rows:
        r["entity_name"] = name_map.get(r["entity_id"], r["entity_id"])
    return rows


@router.post("/{initiative_id}/initiative-entities", status_code=201)
def add_initiative_entity(
    initiative_id: str,
    body: InitiativeEntityAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, init["business_id"], user["id"])
    result = sb.table("initiative_entities").upsert(
        {"initiative_id": initiative_id, "entity_type": body.entity_type, "entity_id": body.entity_id},
        on_conflict="initiative_id,entity_type,entity_id",
    ).execute()
    return result.data[0] if result.data else {}


@router.delete("/{initiative_id}/initiative-entities/{entity_type}/{entity_id}", status_code=204)
def remove_initiative_entity(
    initiative_id: str,
    entity_type: str,
    entity_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, init["business_id"], user["id"])
    sb.table("initiative_entities").delete().eq("initiative_id", initiative_id).eq("entity_type", entity_type).eq("entity_id", entity_id).execute()


class InitiativeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    target_end_date: Optional[date] = None
    program_id: Optional[str] = None
    theme_id: Optional[str] = None
    impact: Optional[str] = None
    impact_metric: Optional[str] = None
    impact_category: Optional[str] = None

@router.delete("/{initiative_id}", status_code=204)
def delete_initiative(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    data = sb.table("initiatives").select("business_id, primary_stakeholder_id, owner_id").eq("id", initiative_id).execute().data
    if not data:
        raise HTTPException(status_code=404, detail="Initiative not found")
    init = data[0]
    uid = user["id"]

    is_primary = init.get("primary_stakeholder_id") == uid or init.get("owner_id") == uid
    if not is_primary:
        role = get_member_role(sb, init["business_id"], uid)
        if role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only the primary stakeholder or a workspace admin can delete this initiative")

    # Delete milestones (polymorphic parent_id — no DB cascade from initiatives)
    milestone_rows = (
        sb.table("milestones")
        .select("id")
        .eq("parent_type", "initiative")
        .eq("parent_id", initiative_id)
        .execute()
        .data
    )
    if milestone_rows:
        milestone_ids = [m["id"] for m in milestone_rows]
        # milestone_entities cascade from milestones, but delete explicitly to be safe
        sb.table("milestone_entities").delete().in_("milestone_id", milestone_ids).execute()
        sb.table("milestones").delete().in_("id", milestone_ids).execute()

    # Delete the initiative — DB cascades to tasks, task_stakeholders, task_entities,
    # subtasks, task_date_change_log, comments, attachments, initiative_entities
    sb.table("initiatives").delete().eq("id", initiative_id).execute()


@router.patch("/{initiative_id}")
def update_initiative(
    initiative_id: str,
    body: InitiativeUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    data = sb.table("initiatives").select("business_id").eq("id", initiative_id).execute().data
    if not data:
        raise HTTPException(status_code=404, detail="Initiative not found")
    require_member(sb, data[0]["business_id"], user["id"])
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if "target_end_date" in payload and payload["target_end_date"]:
        payload["target_end_date"] = payload["target_end_date"].isoformat()
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    result = sb.table("initiatives").update(payload).eq("id", initiative_id).execute()
    return result.data[0] if result.data else {}


# ---------------------------------------------------------------------------
# New endpoints: activity, attachments, gantt
# ---------------------------------------------------------------------------

def _get_initiative_or_404(sb: Client, initiative_id: str) -> dict:
    rows = sb.table("initiatives").select("id, business_id, name, start_date, target_end_date").eq("id", initiative_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Initiative not found")
    return rows[0]


@router.get("/{initiative_id}/activity")
def get_initiative_activity(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return activity_log entries for this initiative, sorted newest first."""
    initiative = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, initiative["business_id"], user["id"])

    logs = (
        sb.table("activity_log")
        .select("*, users(email)")
        .eq("initiative_id", initiative_id)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )

    # Flatten actor_email for convenience
    for log in logs:
        user_obj = log.pop("users", None) or {}
        log["actor_email"] = user_obj.get("email")

    return logs


@router.get("/{initiative_id}/attachments")
def list_initiative_attachments(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return all attachments for tasks within this initiative."""
    initiative = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, initiative["business_id"], user["id"])

    # Get task IDs for this initiative
    task_rows = (
        sb.table("tasks")
        .select("id, title")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )
    task_map = {t["id"]: t["title"] for t in task_rows}
    task_ids = list(task_map.keys())

    if not task_ids:
        return []

    attachments = (
        sb.table("attachments")
        .select("id, task_id, entity_id, doc_status, notes, file_url, file_name, created_at")
        .in_("task_id", task_ids)
        .execute()
        .data
    )

    for att in attachments:
        att["task_title"] = task_map.get(att.get("task_id"), "")

    return attachments


class AttachmentUpdate(BaseModel):
    doc_status: Optional[Literal["pending", "received", "rejected"]] = None
    notes: Optional[str] = None


@router.patch("/{initiative_id}/attachments/{attachment_id}")
def update_initiative_attachment(
    initiative_id: str,
    attachment_id: str,
    body: AttachmentUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update doc_status and/or notes on an attachment belonging to this initiative."""
    initiative = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, initiative["business_id"], user["id"])

    # Verify attachment belongs to a task in this initiative
    att_rows = sb.table("attachments").select("id, task_id").eq("id", attachment_id).execute().data
    if not att_rows:
        raise HTTPException(status_code=404, detail="Attachment not found")

    task_row = (
        sb.table("tasks")
        .select("id")
        .eq("id", att_rows[0]["task_id"])
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )
    if not task_row:
        raise HTTPException(status_code=404, detail="Attachment does not belong to this initiative")

    payload = {}
    if body.doc_status is not None:
        payload["doc_status"] = body.doc_status
    if body.notes is not None:
        payload["notes"] = body.notes
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = sb.table("attachments").update(payload).eq("id", attachment_id).execute()
    return result.data[0] if result.data else {}


@router.get("/{initiative_id}/gantt")
def get_initiative_gantt(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return a flat, ordered, hierarchical row list for the initiative Gantt.

    Rows = tasks → their (recursively nested) subtasks → milestones. Every
    task/subtask is emitted even when it has no date, so the chart shows the
    label row with no bar. When date_mode='per_entity', the parent row gets no
    bar of its own and one child row per entity (building & client) is emitted
    using that entity's per_entity_end_date. Since there is no planned-start
    column, a row's start is derived from the initiative start (clamped to be
    on/before the row's end); a row with no end gets no start either.
    """
    initiative = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, initiative["business_id"], user["id"])

    init_start = initiative.get("start_date")

    def _derive_start(end):
        """Initiative start, but never after the row's end. None if no end."""
        if not end or not init_start:
            return None
        return init_start if init_start <= end else None

    tasks = (
        sb.table("tasks")
        .select("id, title, due_date, status, priority, depends_on, date_mode, "
                "created_at, task_entities(entity_type, entity_id, per_entity_end_date)")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )
    tasks.sort(key=lambda t: t.get("created_at") or "")
    task_ids = [t["id"] for t in tasks]

    subtasks = []
    if task_ids:
        subtasks = (
            sb.table("subtasks")
            .select("id, title, status, task_id, parent_subtask_id, date_mode, "
                    "created_at, subtask_entities(entity_type, entity_id, per_entity_end_date)")
            .in_("task_id", task_ids)
            .execute()
            .data
        )
    subtasks.sort(key=lambda s: s.get("created_at") or "")

    # milestones is polymorphic: (parent_type, parent_id) + name + uniform_date
    # (no title/due_date/initiative_id columns).
    milestones = (
        sb.table("milestones")
        .select("id, name, uniform_date")
        .eq("parent_type", "initiative")
        .eq("parent_id", initiative_id)
        .execute()
        .data
    )

    # Resolve building + client names in bulk (across task AND subtask entities).
    building_ids: set = set()
    client_ids: set = set()
    for holder in (*tasks, *subtasks):
        ents = holder.get("task_entities") or holder.get("subtask_entities") or []
        for e in ents:
            if e.get("entity_type") == "building":
                building_ids.add(e["entity_id"])
            elif e.get("entity_type") == "client":
                client_ids.add(e["entity_id"])
    name_map: dict = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", list(building_ids)).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", list(client_ids)).execute().data:
            name_map[r["id"]] = r["name"]

    def _entities(holder):
        ents = holder.get("task_entities") or holder.get("subtask_entities") or []
        return [
            {
                "type": e.get("entity_type"),
                "name": name_map.get(e["entity_id"], e["entity_id"]),
                "end_date": e.get("per_entity_end_date"),
            }
            for e in ents
        ]

    rows: list = []

    def _emit(holder, *, kind, parent_id, depth, inherited_end):
        """Append a node's row (+ per-entity child rows) and return its end."""
        ents = _entities(holder)
        if kind == "task":
            own_end = holder.get("due_date")
        else:  # subtask: no date column — use per-entity max, else inherit task
            per = [e["end_date"] for e in ents if e.get("end_date")]
            own_end = max(per) if per else inherited_end

        per_entity = holder.get("date_mode") == "per_entity" and any(
            e.get("end_date") for e in ents
        )
        # In per-entity mode the parent itself spans nothing; entity rows carry
        # the dates. Otherwise the parent row holds the bar.
        row_end = None if per_entity else own_end
        rows.append({
            "id": holder["id"],
            "kind": kind,
            "parent_id": parent_id,
            "depth": depth,
            "title": holder["title"],
            "status": holder.get("status"),
            "priority": holder.get("priority"),
            "start_date": _derive_start(row_end),
            "end_date": row_end,
            "is_milestone": False,
            "depends_on": holder.get("depends_on") or [],
            "entities": ents,
        })
        if per_entity:
            for e in ents:
                if not e.get("end_date"):
                    continue
                rows.append({
                    "id": f"{holder['id']}::{e['type']}:{e['name']}",
                    "kind": "entity",
                    "parent_id": holder["id"],
                    "depth": depth + 1,
                    "title": e["name"],
                    "status": holder.get("status"),
                    "priority": holder.get("priority"),
                    "start_date": _derive_start(e["end_date"]),
                    "end_date": e["end_date"],
                    "is_milestone": False,
                    "depends_on": [],
                    "entities": [e],
                })
        return own_end

    # Index subtasks by their parent (task id or parent_subtask_id) for nesting.
    kids_of: dict = {}
    for s in subtasks:
        key = s.get("parent_subtask_id") or s["task_id"]
        kids_of.setdefault(key, []).append(s)

    def _emit_subtree(node_id, depth, inherited_end):
        for s in kids_of.get(node_id, []):
            _emit(s, kind="subtask", parent_id=node_id, depth=depth,
                   inherited_end=inherited_end)
            _emit_subtree(s["id"], depth + 1, inherited_end)

    for t in tasks:
        task_end = _emit(t, kind="task", parent_id=None, depth=0,
                         inherited_end=None)
        _emit_subtree(t["id"], 1, task_end)

    for m in milestones:
        rows.append({
            "id": m["id"],
            "kind": "milestone",
            "parent_id": None,
            "depth": 0,
            "title": m["name"],
            "status": None,
            "priority": None,
            "start_date": None,
            "end_date": m.get("uniform_date"),
            "is_milestone": True,
            "depends_on": [],
            "entities": [],
        })

    return {
        "initiative": {
            "id": initiative["id"],
            "title": initiative["name"],
            "start_date": init_start,
            "end_date": initiative.get("target_end_date"),
        },
        "start_date": init_start,
        "end_date": initiative.get("target_end_date"),
        "rows": rows,
    }
