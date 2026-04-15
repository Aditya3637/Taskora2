from typing import List, Literal, Optional
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])


class TaskEntityCreate(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str
    per_entity_end_date: Optional[date] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    initiative_id: str
    primary_stakeholder_id: str
    priority: Literal["low", "medium", "high", "critical"] = "medium"
    due_date: Optional[date] = None
    date_mode: Literal["uniform", "per_entity"] = "uniform"
    entity_inheritance: Literal["inherited", "custom"] = "inherited"
    entities: List[TaskEntityCreate] = []


class TaskStatusUpdate(BaseModel):
    status: str
    entity_id: Optional[str] = None
    blocker_reason: Optional[str] = None


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
            detail="Failed to create task stakeholder",
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


@router.patch("/{task_id}/status")
def update_task_status(
    task_id: str,
    body: TaskStatusUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    now = datetime.now(timezone.utc).isoformat()

    if body.entity_id is not None:
        sb.table("task_entities").update({
            "per_entity_status": body.status,
            "updated_at": now,
        }).eq("task_id", task_id).eq("entity_id", body.entity_id).execute()
    else:
        update_payload = {
            "status": body.status,
            "updated_at": now,
        }
        if body.blocker_reason is not None:
            update_payload["blocker_reason"] = body.blocker_reason
        sb.table("tasks").update(update_payload).eq("id", task_id).execute()

    return {"ok": True}


@router.get("/{task_id}")
def get_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    data = (
        sb.table("tasks")
        .select("*, task_entities(*), task_stakeholders(*), subtasks(*), comments(*), attachments(*)")
        .eq("id", task_id)
        .execute()
        .data
    )

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found",
        )

    task = data[0]

    # Authorization: caller must be primary stakeholder or in task_stakeholders
    is_primary = task.get("primary_stakeholder_id") == user["id"]
    if not is_primary:
        stakeholder_data = (
            sb.table("task_stakeholders")
            .select("user_id")
            .eq("task_id", task_id)
            .eq("user_id", user["id"])
            .execute()
            .data
        )
        if not stakeholder_data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )

    return task
