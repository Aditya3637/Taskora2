from typing import List, Literal, Optional
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/initiatives", tags=["initiatives"])


class EntityAssignment(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str
    per_entity_end_date: Optional[date] = None


class InitiativeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    business_id: str
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None
    date_mode: Literal["uniform", "per_entity"] = "uniform"
    entities: List[EntityAssignment] = []


@router.post("/", status_code=201)
def create_initiative(
    body: InitiativeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, body.business_id, user["id"])

    result = sb.table("initiatives").insert({
        "name": body.name,
        "description": body.description,
        "business_id": body.business_id,
        "owner_id": user["id"],
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
    return (
        sb.table("initiatives")
        .select("*, initiative_entities(*)")
        .eq("business_id", business_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )


@router.get("/{initiative_id}")
def get_initiative(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    data = (
        sb.table("initiatives")
        .select("*, initiative_entities(*)")
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
    return initiative


class InitiativeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    target_end_date: Optional[date] = None

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
    rows = sb.table("initiatives").select("id, business_id, title, start_date, target_end_date").eq("id", initiative_id).execute().data
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


@router.post("/{initiative_id}/gantt")
def get_initiative_gantt(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return gantt-ready data for the initiative."""
    initiative = _get_initiative_or_404(sb, initiative_id)
    require_member(sb, initiative["business_id"], user["id"])

    # Milestones
    milestones = (
        sb.table("milestones")
        .select("id, title, due_date")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )

    # Tasks with entities
    tasks = (
        sb.table("tasks")
        .select("id, title, due_date, status, priority, depends_on, task_entities(entity_type, entity_id)")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )

    # Collect all entity IDs to resolve names in bulk
    building_ids: list = []
    client_ids: list = []
    for task in tasks:
        for te in task.get("task_entities") or []:
            if te.get("entity_type") == "building":
                building_ids.append(te["entity_id"])
            elif te.get("entity_type") == "client":
                client_ids.append(te["entity_id"])

    name_map: dict = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", list(set(building_ids))).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", list(set(client_ids))).execute().data:
            name_map[r["id"]] = r["name"]

    gantt_tasks = []
    for task in tasks:
        entity_names = [
            name_map.get(te["entity_id"], te["entity_id"])
            for te in (task.get("task_entities") or [])
        ]
        gantt_tasks.append({
            "id": task["id"],
            "title": task["title"],
            "due_date": task.get("due_date"),
            "status": task.get("status"),
            "priority": task.get("priority"),
            "entity_names": entity_names,
            "depends_on": task.get("depends_on") or [],
        })

    return {
        "initiative": {
            "id": initiative["id"],
            "title": initiative["title"],
            "start_date": initiative.get("start_date"),
            "end_date": initiative.get("target_end_date"),
        },
        "milestones": milestones,
        "tasks": gantt_tasks,
    }
