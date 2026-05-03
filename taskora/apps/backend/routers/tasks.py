from typing import List, Literal, Optional
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

# Valid status values shared by task-level and per-entity updates
_TASK_STATUSES = Literal["open", "in_progress", "pending_decision", "blocked", "done", "cancelled"]


class TaskEntityCreate(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str
    per_entity_end_date: Optional[date] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    initiative_id: Optional[str] = None
    primary_stakeholder_id: str
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    due_date: Optional[date] = None
    date_mode: Literal["uniform", "per_entity"] = "uniform"
    entity_inheritance: Literal["inherited", "custom"] = "inherited"
    entities: List[TaskEntityCreate] = []


class TaskStatusUpdate(BaseModel):
    status: _TASK_STATUSES
    entity_id: Optional[str] = None   # if None → update task-level status
    blocker_reason: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None
    description: Optional[str] = None


class StakeholderAdd(BaseModel):
    user_id: str
    role: Literal["primary", "secondary", "observer"] = "secondary"


@router.get("/my")
def get_my_tasks(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    primary_ids = [r["id"] for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data]
    secondary_ids = [r["task_id"] for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return []
    tasks = sb.table("tasks").select("*, task_entities(*), task_stakeholders(*)").in_("id", all_ids).order("created_at", desc=True).execute().data
    # Resolve entity names
    for task in tasks:
        entities = task.get("task_entities") or []
        building_ids = [e["entity_id"] for e in entities if e.get("entity_type") == "building"]
        client_ids   = [e["entity_id"] for e in entities if e.get("entity_type") == "client"]
        name_map = {}
        if building_ids:
            for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
                name_map[r["id"]] = r["name"]
        if client_ids:
            for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
                name_map[r["id"]] = r["name"]
        for e in entities:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        task["task_entities"] = entities
    return tasks


@router.post("/", status_code=201)
def create_task(
    body: TaskCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    result = sb.table("tasks").insert({
        "title": body.title,
        "description": body.description,
        "initiative_id": body.initiative_id,
        "primary_stakeholder_id": body.primary_stakeholder_id,
        "priority": body.priority,
        "due_date": body.due_date.isoformat() if body.due_date else None,
        "date_mode": body.date_mode,
        "entity_inheritance": body.entity_inheritance,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create task",
        )

    task = result.data[0]
    task_id = task["id"]

    stakeholder_result = sb.table("task_stakeholders").insert({
        "task_id": task_id,
        "user_id": body.primary_stakeholder_id,
        "role": "primary",
    }).execute()

    if not stakeholder_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign primary stakeholder",
        )

    if body.entities:
        entity_rows = [
            {
                "task_id": task_id,
                "entity_type": te.entity_type,
                "entity_id": te.entity_id,
                "per_entity_end_date": te.per_entity_end_date.isoformat() if te.per_entity_end_date else None,
            }
            for te in body.entities
        ]
        entities_result = sb.table("task_entities").insert(entity_rows).execute()
        if not entities_result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to assign entities to task",
            )

    return task


@router.get("/{task_id}")
def get_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("tasks").select("*, task_entities(*), task_stakeholders(*), subtasks(*), comments(*), attachments(*)").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]

    # Authorization: caller must be primary stakeholder OR in task_stakeholders.
    is_primary = task.get("primary_stakeholder_id") == user["id"]
    if not is_primary:
        stakeholders = task.get("task_stakeholders") or []
        is_stakeholder = any(s.get("user_id") == user["id"] for s in stakeholders)
        if not is_stakeholder:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    # Resolve entity names
    entities = task.get("task_entities") or []
    building_ids = [e["entity_id"] for e in entities if e.get("entity_type") == "building"]
    client_ids   = [e["entity_id"] for e in entities if e.get("entity_type") == "client"]
    name_map = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            name_map[r["id"]] = r["name"]
    for e in entities:
        e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
    task["task_entities"] = entities
    return task


@router.patch("/{task_id}")
def update_task(
    task_id: str,
    body: TaskUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Auth: must be stakeholder
    task_row = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not task_row:
        raise HTTPException(status_code=404, detail="Task not found")
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = task_row[0]["primary_stakeholder_id"] == user["id"] or any(s["user_id"] == user["id"] for s in stakeholders)
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")
    payload = {}
    if body.title is not None: payload["title"] = body.title
    if body.status is not None: payload["status"] = body.status
    if body.priority is not None: payload["priority"] = body.priority
    if body.due_date is not None: payload["due_date"] = body.due_date.isoformat()
    if body.description is not None: payload["description"] = body.description
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = sb.table("tasks").update(payload).eq("id", task_id).execute()
    return result.data[0] if result.data else {}


@router.patch("/{task_id}/status")
def update_task_status(
    task_id: str,
    body: TaskStatusUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    now = datetime.now(timezone.utc).isoformat()

    if body.entity_id is not None:
        result = sb.table("task_entities").update({
            "per_entity_status": body.status,
            "updated_at": now,
        }).eq("task_id", task_id).eq("entity_id", body.entity_id).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task entity not found",
            )
    else:
        update_payload: dict = {"status": body.status, "updated_at": now}
        if body.blocker_reason is not None:
            update_payload["blocker_reason"] = body.blocker_reason
        result = sb.table("tasks").update(update_payload).eq("id", task_id).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )

    return {"ok": True}


@router.post("/{task_id}/stakeholders", status_code=201)
def add_stakeholder(
    task_id: str,
    body: StakeholderAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    task_row = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not task_row:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_row[0]["primary_stakeholder_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the primary stakeholder can add stakeholders")
    result = sb.table("task_stakeholders").upsert(
        {"task_id": task_id, "user_id": body.user_id, "role": body.role},
        on_conflict="task_id,user_id",
    ).execute()
    return result.data[0] if result.data else {}


@router.delete("/{task_id}/stakeholders/{stakeholder_user_id}", status_code=204)
def remove_stakeholder(
    task_id: str,
    stakeholder_user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    task_row = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not task_row:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_row[0]["primary_stakeholder_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Only the primary stakeholder can remove stakeholders")
    sb.table("task_stakeholders").delete().eq("task_id", task_id).eq("user_id", stakeholder_user_id).execute()


# ---------------------------------------------------------------------------
# New endpoints
# ---------------------------------------------------------------------------

class BulkUpdateBody(BaseModel):
    task_ids: List[str]
    status: Optional[str] = None
    priority: Optional[str] = None


@router.post("/bulk-update")
def bulk_update_tasks(
    body: BulkUpdateBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update status and/or priority on tasks where caller is a stakeholder."""
    if not body.task_ids:
        return {"updated_count": 0}
    if body.status is None and body.priority is None:
        raise HTTPException(status_code=422, detail="Provide at least one of status or priority")

    uid = user["id"]

    # Collect task_ids where user is primary stakeholder
    primary_rows = (
        sb.table("tasks")
        .select("id")
        .in_("id", body.task_ids)
        .eq("primary_stakeholder_id", uid)
        .execute()
        .data
    )
    primary_ids = {r["id"] for r in primary_rows}

    # Collect task_ids where user is secondary/observer stakeholder
    secondary_rows = (
        sb.table("task_stakeholders")
        .select("task_id")
        .in_("task_id", body.task_ids)
        .eq("user_id", uid)
        .execute()
        .data
    )
    secondary_ids = {r["task_id"] for r in secondary_rows}

    allowed_ids = list(primary_ids | secondary_ids)
    if not allowed_ids:
        return {"updated_count": 0}

    payload: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.status is not None:
        payload["status"] = body.status
    if body.priority is not None:
        payload["priority"] = body.priority

    result = sb.table("tasks").update(payload).in_("id", allowed_ids).execute()
    return {"updated_count": len(result.data) if result.data else 0}


@router.get("/follow-up-today")
def follow_up_today(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return tasks where follow_up_date = today and user is primary/secondary stakeholder."""
    uid = user["id"]
    today_str = date.today().isoformat()

    # IDs user has access to
    primary_rows = (
        sb.table("tasks")
        .select("id")
        .eq("primary_stakeholder_id", uid)
        .eq("follow_up_date", today_str)
        .execute()
        .data
    )
    primary_ids = [r["id"] for r in primary_rows]

    secondary_rows = (
        sb.table("task_stakeholders")
        .select("task_id")
        .eq("user_id", uid)
        .execute()
        .data
    )
    secondary_task_ids = [r["task_id"] for r in secondary_rows]

    # Get secondary tasks that also have follow_up_date = today
    secondary_today: list = []
    if secondary_task_ids:
        secondary_today_rows = (
            sb.table("tasks")
            .select("id")
            .in_("id", secondary_task_ids)
            .eq("follow_up_date", today_str)
            .execute()
            .data
        )
        secondary_today = [r["id"] for r in secondary_today_rows]

    all_ids = list(set(primary_ids + secondary_today))
    if not all_ids:
        return []

    tasks = (
        sb.table("tasks")
        .select("*, task_entities(*), initiatives(title)")
        .in_("id", all_ids)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Resolve entity names
    for task in tasks:
        entities = task.get("task_entities") or []
        building_ids = [e["entity_id"] for e in entities if e.get("entity_type") == "building"]
        client_ids   = [e["entity_id"] for e in entities if e.get("entity_type") == "client"]
        name_map: dict = {}
        if building_ids:
            for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
                name_map[r["id"]] = r["name"]
        if client_ids:
            for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
                name_map[r["id"]] = r["name"]
        for e in entities:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        task["task_entities"] = entities

    return tasks


_RECURRENCE_DELTAS: dict = {
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "fortnightly": timedelta(days=14),
    "monthly": timedelta(days=30),
}


@router.patch("/{task_id}/recurring/mark-done")
def recurring_mark_done(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Mark a recurring task done for this cycle and advance next_meeting_at."""
    rows = sb.table("tasks").select("primary_stakeholder_id, recurrence, status").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task_row = rows[0]

    # Auth check
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = (
        task_row["primary_stakeholder_id"] == user["id"]
        or any(s["user_id"] == user["id"] for s in stakeholders)
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")

    recurrence = task_row.get("recurrence")
    if not recurrence or recurrence not in _RECURRENCE_DELTAS:
        raise HTTPException(
            status_code=422,
            detail=f"Task recurrence must be one of {list(_RECURRENCE_DELTAS.keys())}",
        )

    now = datetime.now(timezone.utc)
    next_meeting_at = now + _RECURRENCE_DELTAS[recurrence]

    result = sb.table("tasks").update({
        "last_meeting_at": now.isoformat(),
        "next_meeting_at": next_meeting_at.isoformat(),
        "status": "in_progress",
        "updated_at": now.isoformat(),
    }).eq("id", task_id).execute()

    return result.data[0] if result.data else {}


class DependenciesUpdate(BaseModel):
    depends_on: List[str]


@router.get("/{task_id}/dependencies")
def get_task_dependencies(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return tasks this task depends on and tasks that depend on this task."""
    rows = sb.table("tasks").select("primary_stakeholder_id, depends_on").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task_row = rows[0]

    # Auth
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = (
        task_row["primary_stakeholder_id"] == user["id"]
        or any(s["user_id"] == user["id"] for s in stakeholders)
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")

    # Tasks this task depends on
    depends_on_ids: list = task_row.get("depends_on") or []
    depends_on_tasks: list = []
    if depends_on_ids:
        depends_on_tasks = (
            sb.table("tasks")
            .select("id, title, status, priority")
            .in_("id", depends_on_ids)
            .execute()
            .data
        )

    # Tasks that depend ON this task (reverse lookup via RPC or filter)
    # Supabase postgrest: use cs (contains) operator for array column
    reverse_rows = (
        sb.table("tasks")
        .select("id, title, status, priority")
        .cs("depends_on", [task_id])
        .execute()
        .data
    )

    return {
        "depends_on": depends_on_tasks,
        "depended_on_by": reverse_rows,
    }


@router.patch("/{task_id}/dependencies")
def update_task_dependencies(
    task_id: str,
    body: DependenciesUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Replace the full depends_on array for a task."""
    rows = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")

    # Auth
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = (
        rows[0]["primary_stakeholder_id"] == user["id"]
        or any(s["user_id"] == user["id"] for s in stakeholders)
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")

    result = sb.table("tasks").update({
        "depends_on": body.depends_on,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", task_id).execute()

    return result.data[0] if result.data else {}
