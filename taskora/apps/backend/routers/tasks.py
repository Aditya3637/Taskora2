from typing import List, Literal, Optional
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase, get_member_role

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

# Valid status values shared by task-level and per-entity updates.
# Source of truth — matches the CHECK constraint on tasks.status (migration 002)
# and the constraint on task_entities.per_entity_status (also migration 002,
# minus 'archived' which only applies at the task level).
_TASK_STATUSES = Literal[
    "backlog",
    "todo",
    "in_progress",
    "pending_decision",
    "blocked",
    "done",
    "archived",
]

# Status values valid on subtasks and entity-scoped rows (no 'archived').
_SUBTASK_STATUSES = Literal[
    "backlog",
    "todo",
    "in_progress",
    "pending_decision",
    "blocked",
    "done",
]


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
    role: Literal["primary", "secondary", "follower"] = "secondary"


def _hydrate_tasks_with_entities(sb: Client, tasks: list) -> list:
    """Attach task_entities (with resolved building/client names) to each task."""
    if not tasks:
        return tasks
    task_ids = [t["id"] for t in tasks]
    all_entities = sb.table("task_entities").select("*").in_("task_id", task_ids).execute().data
    entities_by_task: dict = {}
    for e in all_entities:
        entities_by_task.setdefault(e["task_id"], []).append(e)

    building_ids = list({e["entity_id"] for e in all_entities if e.get("entity_type") == "building"})
    client_ids = list({e["entity_id"] for e in all_entities if e.get("entity_type") == "client"})
    name_map: dict = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            name_map[r["id"]] = r["name"]

    for task in tasks:
        entities = entities_by_task.get(task["id"], [])
        for e in entities:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        task["task_entities"] = entities
    return tasks


@router.get("/my")
def get_my_tasks(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Flat list of tasks the caller is a stakeholder on (used by mobile).
    For the paginated web flow, see /my/page.
    """
    uid = user["id"]
    primary_ids = [r["id"] for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data]
    secondary_ids = [r["task_id"] for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return []
    tasks = sb.table("tasks").select("*").in_("id", all_ids).order("created_at", desc=True).execute().data
    return _hydrate_tasks_with_entities(sb, tasks)


@router.get("/my/page")
def get_my_tasks_page(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(
        default=None,
        description="ISO timestamp of the last task's created_at — return tasks older than this",
    ),
    status: Optional[str] = Query(default=None, description="Filter by exact task status"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """B5: Cursor-paginated list of tasks the caller is a stakeholder on.

    Returns: {"items": [...tasks], "next_cursor": "<iso>" | None}
    """
    uid = user["id"]
    primary_ids = [
        r["id"]
        for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data
    ]
    secondary_ids = [
        r["task_id"]
        for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
    ]
    all_ids = list(set(primary_ids + secondary_ids))
    if not all_ids:
        return {"items": [], "next_cursor": None}

    q = (
        sb.table("tasks")
        .select("*")
        .in_("id", all_ids)
        .order("created_at", desc=True)
        .limit(limit + 1)
    )
    if cursor:
        q = q.lt("created_at", cursor)
    if status:
        q = q.eq("status", status)
    tasks = q.execute().data

    has_more = len(tasks) > limit
    if has_more:
        tasks = tasks[:limit]
    next_cursor = tasks[-1]["created_at"] if has_more and tasks else None

    return {
        "items": _hydrate_tasks_with_entities(sb, tasks),
        "next_cursor": next_cursor,
    }


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


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("tasks").select("primary_stakeholder_id, initiative_id").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]
    uid = user["id"]

    is_primary = task["primary_stakeholder_id"] == uid
    if not is_primary:
        allowed = False
        if task.get("initiative_id"):
            init_row = sb.table("initiatives").select("business_id").eq("id", task["initiative_id"]).execute().data
            if init_row:
                role = get_member_role(sb, init_row[0]["business_id"], uid)
                allowed = role in ("owner", "admin")
        if not allowed:
            raise HTTPException(status_code=403, detail="Only the primary stakeholder or a workspace admin can delete this task")

    # Delete task milestones (polymorphic parent_id — no DB cascade from tasks)
    milestone_rows = (
        sb.table("milestones")
        .select("id")
        .eq("parent_type", "task")
        .eq("parent_id", task_id)
        .execute()
        .data
    )
    if milestone_rows:
        milestone_ids = [m["id"] for m in milestone_rows]
        sb.table("milestone_entities").delete().in_("milestone_id", milestone_ids).execute()
        sb.table("milestones").delete().in_("id", milestone_ids).execute()

    # Delete the task — DB cascades to task_stakeholders, task_entities,
    # subtasks, task_date_change_log, comments, attachments
    sb.table("tasks").delete().eq("id", task_id).execute()


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

    now_iso = datetime.now(timezone.utc).isoformat()
    payload["updated_at"] = now_iso
    result = sb.table("tasks").update(payload).eq("id", task_id).execute()
    updated = result.data[0] if result.data else {}

    # Date change log + uniform subtask propagation
    if body.due_date is not None:
        old_row = sb.table("tasks").select("due_date, date_mode").eq("id", task_id).execute().data
        old_date_str = old_row[0].get("due_date") if old_row else None
        old_date = date.fromisoformat(old_date_str[:10]) if old_date_str else None
        if old_date != body.due_date:
            delay = (body.due_date - old_date).days if old_date else None
            sb.table("task_date_change_log").insert({
                "task_id": task_id,
                "changed_by": user["id"],
                "old_date": old_date.isoformat() if old_date else None,
                "new_date": body.due_date.isoformat(),
                "delay_days": delay,
            }).execute()

        # Propagate to subtasks when date_mode == 'uniform'
        date_mode = (old_row[0].get("date_mode") if old_row else None) or updated.get("date_mode")
        if date_mode == "uniform":
            subtasks = sb.table("subtasks").select("id, due_date").eq("task_id", task_id).execute().data
            for sub in subtasks:
                sub_old = sub.get("due_date")
                if sub_old != body.due_date.isoformat():
                    sb.table("subtasks").update({
                        "due_date": body.due_date.isoformat(),
                        "updated_at": now_iso,
                    }).eq("id", sub["id"]).execute()
                    sb.table("task_date_change_log").insert({
                        "subtask_id": sub["id"],
                        "changed_by": user["id"],
                        "old_date": sub_old,
                        "new_date": body.due_date.isoformat(),
                        "delay_days": (body.due_date - date.fromisoformat(sub_old[:10])).days if sub_old else None,
                    }).execute()

    return updated


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


# ---------------------------------------------------------------------------
# Subtask endpoints
# ---------------------------------------------------------------------------

class SubtaskCreate(BaseModel):
    title: str
    assignee_id: Optional[str] = None
    scoped_entity_id: Optional[str] = None
    scoped_entity_type: Optional[str] = None
    parent_subtask_id: Optional[str] = None  # B1: enables Task → Subtask → Sub-subtask


class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    parent_subtask_id: Optional[str] = None


def _assert_task_access(sb: Client, task_id: str, user_id: str):
    rows = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    is_primary = rows[0]["primary_stakeholder_id"] == user_id
    if not is_primary:
        s_rows = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).eq("user_id", user_id).execute().data
        if not s_rows:
            raise HTTPException(status_code=403, detail="Access denied")


@router.get("/{task_id}/subtasks")
def list_subtasks(
    task_id: str,
    for_entity: Optional[str] = Query(default=None, description="entity_id to scope subtasks to"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    query = (
        sb.table("subtasks")
        .select(
            "id, title, status, assignee_id, created_at, "
            "scoped_entity_id, scoped_entity_type, parent_subtask_id"
        )
        .eq("task_id", task_id)
        .order("created_at")
    )
    if for_entity is not None:
        query = query.eq("scoped_entity_id", for_entity)
    else:
        query = query.is_("scoped_entity_id", "null")
    subtasks = query.execute().data
    # Resolve assignee names
    assignee_ids = list({s["assignee_id"] for s in subtasks if s.get("assignee_id")})
    name_map: dict = {}
    if assignee_ids:
        for r in sb.table("users").select("id, name").in_("id", assignee_ids).execute().data:
            name_map[r["id"]] = r["name"]
    for s in subtasks:
        s["assignee_name"] = name_map.get(s.get("assignee_id") or "", "")
    return subtasks


@router.get("/{task_id}/subtasks-grouped")
def list_subtasks_grouped(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """B4: One-shot fetch of every subtask under a task, grouped by entity_id.

    Returns: {"by_entity": {entity_id: [subtask, ...], ...}, "task_flat": [...]}

    Replaces the per-entity N+1 pattern where each building row separately
    called /subtasks?for_entity=<id>. With 50 buildings, that was 50 trips;
    now it's one query that benefits from the (task_id, scoped_entity_id) index.
    """
    _assert_task_access(sb, task_id, user["id"])
    rows = (
        sb.table("subtasks")
        .select(
            "id, title, status, assignee_id, created_at, "
            "scoped_entity_id, scoped_entity_type, parent_subtask_id"
        )
        .eq("task_id", task_id)
        .order("created_at")
        .execute()
        .data
    )

    # Resolve assignee names in one batch
    assignee_ids = list({s["assignee_id"] for s in rows if s.get("assignee_id")})
    name_map: dict = {}
    if assignee_ids:
        for r in sb.table("users").select("id, name").in_("id", assignee_ids).execute().data:
            name_map[r["id"]] = r.get("name") or ""
    for s in rows:
        s["assignee_name"] = name_map.get(s.get("assignee_id") or "", "")

    by_entity: dict = {}
    task_flat: list = []
    for s in rows:
        eid = s.get("scoped_entity_id")
        if eid:
            by_entity.setdefault(eid, []).append(s)
        else:
            task_flat.append(s)
    return {"by_entity": by_entity, "task_flat": task_flat}


@router.post("/{task_id}/subtasks", status_code=201)
def create_subtask(
    task_id: str,
    body: SubtaskCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    now = datetime.now(timezone.utc).isoformat()
    row: dict = {
        "task_id": task_id,
        "title": body.title,
        "status": "todo",
        "assignee_id": body.assignee_id or user["id"],
        "created_at": now,
        "updated_at": now,
    }

    # If parent_subtask_id is provided, verify it belongs to the same task and
    # inherit its entity scope (children of an entity-scoped subtask stay scoped
    # to that entity). Cap nesting at depth 2 (sub-subtask): no grandchildren.
    if body.parent_subtask_id:
        parent_rows = (
            sb.table("subtasks")
            .select("task_id, scoped_entity_id, scoped_entity_type, parent_subtask_id")
            .eq("id", body.parent_subtask_id)
            .execute()
            .data
        )
        if not parent_rows:
            raise HTTPException(status_code=404, detail="Parent subtask not found")
        parent = parent_rows[0]
        if parent["task_id"] != task_id:
            raise HTTPException(status_code=400, detail="Parent subtask belongs to a different task")
        if parent.get("parent_subtask_id"):
            raise HTTPException(status_code=400, detail="Subtasks can only nest one level deep")
        row["parent_subtask_id"] = body.parent_subtask_id
        # Inherit scope from parent so the child renders under the same entity
        if parent.get("scoped_entity_id"):
            row["scoped_entity_id"] = parent["scoped_entity_id"]
            row["scoped_entity_type"] = parent.get("scoped_entity_type")
    elif body.scoped_entity_id:
        row["scoped_entity_id"] = body.scoped_entity_id
        row["scoped_entity_type"] = body.scoped_entity_type

    result = sb.table("subtasks").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create subtask")
    return result.data[0]


@router.get("/{task_id}/stakeholders")
def get_task_stakeholders(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    rows = sb.table("task_stakeholders").select("user_id, role").eq("task_id", task_id).execute().data
    user_ids = [r["user_id"] for r in rows]
    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name, email").in_("id", user_ids).execute().data:
            name_map[u["id"]] = {"name": u.get("name") or "", "email": u.get("email") or ""}
    for r in rows:
        info = name_map.get(r["user_id"], {})
        r["name"] = info.get("name", "")
        r["email"] = info.get("email", "")
    return rows


class TaskEntityUpdate(BaseModel):
    per_entity_status: Optional[str] = None
    per_entity_end_date: Optional[date] = None


@router.patch("/{task_id}/entities/{entity_id}")
def update_task_entity(
    task_id: str,
    entity_id: str,
    body: TaskEntityUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    payload: dict = {}
    if body.per_entity_status is not None:
        payload["per_entity_status"] = body.per_entity_status
    if body.per_entity_end_date is not None:
        payload["per_entity_end_date"] = body.per_entity_end_date.isoformat()
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        sb.table("task_entities")
        .update(payload)
        .eq("task_id", task_id)
        .eq("entity_id", entity_id)
        .execute()
    )
    return result.data[0] if result.data else {}


@router.patch("/{task_id}/subtasks/{subtask_id}")
def update_subtask(
    task_id: str,
    subtask_id: str,
    body: SubtaskUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = sb.table("subtasks").update(payload).eq("id", subtask_id).eq("task_id", task_id).execute()
    return result.data[0] if result.data else {}


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
    rows = sb.table("tasks").select("primary_stakeholder_id, recurring_type, status").eq("id", task_id).execute().data
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

    recurring_type = task_row.get("recurring_type")
    if not recurring_type or recurring_type not in _RECURRENCE_DELTAS:
        raise HTTPException(
            status_code=422,
            detail=f"Task recurring_type must be one of {list(_RECURRENCE_DELTAS.keys())}",
        )

    now = datetime.now(timezone.utc)
    next_meeting_at = now + _RECURRENCE_DELTAS[recurring_type]

    result = sb.table("tasks").update({
        "last_meeting_at": now.isoformat(),
        "next_meeting_at": next_meeting_at.isoformat(),
        "status": "in_progress",
        "updated_at": now.isoformat(),
    }).eq("id", task_id).execute()

    return result.data[0] if result.data else {}


# ---------------------------------------------------------------------------
# Entity comment endpoints
# ---------------------------------------------------------------------------

class CommentCreate(BaseModel):
    content: str


@router.get("/{task_id}/entities/{entity_id}/comments")
def list_entity_comments(
    task_id: str,
    entity_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return all comments scoped to a specific task entity, oldest first."""
    _assert_task_access(sb, task_id, user["id"])
    rows = (
        sb.table("comments")
        .select("id, content, user_id, created_at")
        .eq("task_id", task_id)
        .eq("entity_id", entity_id)
        .order("created_at")
        .execute()
        .data
    )
    # Resolve author names in one batch
    user_ids = list({r["user_id"] for r in rows if r.get("user_id")})
    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name").in_("id", user_ids).execute().data:
            name_map[u["id"]] = u.get("name") or ""
    for r in rows:
        r["author_name"] = name_map.get(r["user_id"], "")
        r["author_id"] = r.pop("user_id")
    return rows


@router.post("/{task_id}/entities/{entity_id}/comments", status_code=201)
def create_entity_comment(
    task_id: str,
    entity_id: str,
    body: CommentCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Post a comment scoped to a specific task entity."""
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Comment content cannot be empty")
    _assert_task_access(sb, task_id, user["id"])
    now = datetime.now(timezone.utc).isoformat()
    result = sb.table("comments").insert({
        "task_id": task_id,
        "entity_id": entity_id,
        "user_id": user["id"],
        "content": body.content.strip(),
        "created_at": now,
        "updated_at": now,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create comment")
    row = result.data[0]
    # Resolve author name for the response
    user_row = sb.table("users").select("name").eq("id", user["id"]).execute().data
    row["author_name"] = user_row[0].get("name", "") if user_row else ""
    row["author_id"] = row.pop("user_id")
    return row


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
