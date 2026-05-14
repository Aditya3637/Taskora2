from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel

from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/activity", tags=["activity"])


class ActivityCreate(BaseModel):
    business_id: str
    initiative_id: Optional[str] = None
    task_id: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    entity_label: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None


@router.get("")
def list_activity(
    initiative_id: Optional[str] = None,
    task_id: Optional[str] = None,
    limit: int = 50,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    List activity log entries filtered by initiative_id and/or task_id,
    joined with users to return actor_email. Sorted newest-first.
    """
    if not initiative_id and not task_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one of initiative_id or task_id is required",
        )

    query = (
        sb.table("activity_log")
        .select("*, users(email)")
        .order("created_at", desc=True)
        .limit(limit)
    )

    if initiative_id:
        query = query.eq("initiative_id", initiative_id)
    if task_id:
        query = query.eq("task_id", task_id)

    rows = query.execute().data

    # Flatten actor email
    for row in rows:
        users_join = row.pop("users", None)
        if isinstance(users_join, dict):
            row["actor_email"] = users_join.get("email")
        elif isinstance(users_join, list) and users_join:
            row["actor_email"] = users_join[0].get("email")
        else:
            row["actor_email"] = None

    return rows


@router.post("/", status_code=201)
def log_activity(
    body: ActivityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Internal helper: insert an activity log entry."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "business_id": body.business_id,
        "initiative_id": body.initiative_id,
        "task_id": body.task_id,
        "actor_id": user["id"],
        "action": body.action,
        "entity_type": body.entity_type,
        "entity_id": body.entity_id,
        "entity_label": body.entity_label,
        "old_value": body.old_value,
        "new_value": body.new_value,
        "created_at": now,
    }
    result = sb.table("activity_log").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to log activity")
    return result.data[0]
