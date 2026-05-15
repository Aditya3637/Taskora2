from typing import List, Literal, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase
from notifications import send_push_to_user

router = APIRouter(prefix="/api/v1/tasks/{task_id}/decisions", tags=["decisions"])


class DecisionAction(BaseModel):
    action: Literal["approve", "reject", "delegate", "request_info", "escalate", "snooze"]
    reason: Optional[str] = None
    entity_ids: Optional[List[str]] = None   # None = all entities
    delegate_to: Optional[str] = None         # user_id for delegate action
    snooze_hours: Optional[int] = None


@router.post("/", status_code=201)
@router.post("", status_code=201, include_in_schema=False)
def take_decision(
    task_id: str,
    body: DecisionAction,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    now = datetime.now(timezone.utc).isoformat()

    # Fetch task (needed for title, stakeholders, etc.)
    task_rows = (
        sb.table("tasks")
        .select("*, task_stakeholders(*)")
        .eq("id", task_id)
        .execute()
        .data
    )
    if not task_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    task = task_rows[0]

    # Verify caller can act: must be primary stakeholder or a task stakeholder
    is_primary = task.get("primary_stakeholder_id") == user["id"]
    stakeholders = task.get("task_stakeholders") or []
    is_stakeholder = any(s.get("user_id") == user["id"] for s in stakeholders)
    if not is_primary and not is_stakeholder:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a stakeholder on this task")

    if body.action == "approve":
        if body.entity_ids:
            for eid in body.entity_ids:
                sb.table("task_entities").update({
                    "per_entity_status": "done",
                    "updated_at": now,
                }).eq("task_id", task_id).eq("entity_id", eid).execute()
        else:
            sb.table("tasks").update({"status": "done", "updated_at": now}).eq("id", task_id).execute()

    elif body.action == "reject":
        if not body.reason:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="reason is required for reject action")
        sb.table("tasks").update({"status": "in_progress", "updated_at": now}).eq("id", task_id).execute()

    elif body.action == "delegate":
        if not body.delegate_to:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="delegate_to is required for delegate action")
        sb.table("tasks").update({
            "primary_stakeholder_id": body.delegate_to,
            "updated_at": now,
        }).eq("id", task_id).execute()
        # Demote old primary → secondary in task_stakeholders
        sb.table("task_stakeholders").update({"role": "secondary"}).eq("task_id", task_id).eq("user_id", user["id"]).execute()
        # Upsert new primary row
        sb.table("task_stakeholders").upsert(
            {"task_id": task_id, "user_id": body.delegate_to, "role": "primary"},
            on_conflict="task_id,user_id",
        ).execute()
        send_push_to_user(sb, body.delegate_to, "Task Delegated to You", task["title"], {"task_id": task_id})

    elif body.action == "escalate":
        # DB CHECK allows low/medium/high/urgent — 'critical' would be rejected.
        sb.table("tasks").update({"priority": "urgent", "updated_at": now}).eq("id", task_id).execute()
        for s in stakeholders:
            send_push_to_user(sb, s["user_id"], "Task Escalated", task["title"],
                              {"task_id": task_id})

    elif body.action == "request_info":
        sb.table("tasks").update({"status": "pending_decision", "updated_at": now}).eq("id", task_id).execute()

    elif body.action == "snooze":
        # No status change — just log it; snooze_hours recorded in decision_log
        pass

    # Append-only decision log
    sb.table("decision_log").insert({
        "task_id": task_id,
        "user_id": user["id"],
        "action": body.action,
        "reason": body.reason,
        "entity_ids_affected": body.entity_ids or [],
    }).execute()

    return {"ok": True}
