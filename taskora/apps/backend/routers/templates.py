from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from pydantic import BaseModel

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])


class TemplateCreate(BaseModel):
    business_id: str
    name: str
    description: Optional[str] = None
    structure: Optional[Dict[str, Any]] = None
    # If provided, copy task structure from this initiative instead of using structure field
    initiative_id: Optional[str] = None


class ApplyTemplate(BaseModel):
    initiative_id: str


@router.get("")
def list_templates(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all templates for a business."""
    require_member(sb, business_id, user["id"])

    templates = (
        sb.table("initiative_templates")
        .select("id, business_id, name, description, created_by, created_at, updated_at")
        .eq("business_id", business_id)
        .order("created_at", desc=False)
        .execute()
        .data
    )
    return templates


@router.post("/", status_code=201)
def create_template(
    body: TemplateCreate,
    action: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    Create a template.
    If action=save_from_initiative (or body.initiative_id provided), copies task
    structure from the given initiative instead of using the structure field.
    """
    require_member(sb, body.business_id, user["id"])

    structure = body.structure

    source_initiative_id = body.initiative_id
    if action == "save_from_initiative" and source_initiative_id:
        structure = _build_structure_from_initiative(sb, source_initiative_id)

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "business_id": body.business_id,
        "name": body.name,
        "description": body.description,
        "structure": structure or {"tasks": []},
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
    }
    result = sb.table("initiative_templates").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create template")
    return result.data[0]


@router.get("/{template_id}")
def get_template(
    template_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Get a single template with its full structure."""
    rows = sb.table("initiative_templates").select("*").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    template = rows[0]
    require_member(sb, template["business_id"], user["id"])
    return template


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Delete a template."""
    rows = sb.table("initiative_templates").select("business_id").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    require_member(sb, rows[0]["business_id"], user["id"])

    sb.table("initiative_templates").delete().eq("id", template_id).execute()
    return None


@router.post("/{template_id}/apply", status_code=201)
def apply_template(
    template_id: str,
    body: ApplyTemplate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    Apply a template to an initiative: creates tasks (and subtasks) from the
    template's structure under the given initiative.
    """
    rows = sb.table("initiative_templates").select("*").eq("id", template_id).execute().data
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    template = rows[0]
    require_member(sb, template["business_id"], user["id"])

    # Verify the initiative exists
    init_rows = (
        sb.table("initiatives")
        .select("id, business_id")
        .eq("id", body.initiative_id)
        .execute()
        .data
    )
    if not init_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")

    structure = template.get("structure") or {}
    task_templates: List[Dict[str, Any]] = structure.get("tasks", [])

    created_tasks = []
    now = datetime.now(timezone.utc).isoformat()

    for task_def in task_templates:
        task_row = {
            "initiative_id": body.initiative_id,
            "title": task_def.get("title", "Untitled Task"),
            "priority": task_def.get("priority", "medium"),
            "status": "backlog",
            "primary_stakeholder_id": user["id"],
            "created_at": now,
            "updated_at": now,
        }
        task_result = sb.table("tasks").insert(task_row).execute()
        if not task_result.data:
            continue

        created_task = task_result.data[0]
        created_tasks.append(created_task)

        # Add creator as primary stakeholder
        sb.table("task_stakeholders").insert({
            "task_id": created_task["id"],
            "user_id": user["id"],
            "role": "primary",
        }).execute()

        # Create subtasks in the subtasks table (not tasks)
        subtask_defs = task_def.get("subtasks", [])
        for sub_def in subtask_defs:
            sb.table("subtasks").insert({
                "task_id": created_task["id"],
                "title": sub_def.get("title", "Untitled Subtask"),
                "assignee_id": user["id"],
                "status": "backlog",
                "created_at": now,
                "updated_at": now,
            }).execute()

    return {"initiative_id": body.initiative_id, "tasks_created": len(created_tasks)}


# ---------------------------------------------------------------------------
# Internal helper
# ---------------------------------------------------------------------------

def _build_structure_from_initiative(sb: Client, initiative_id: str) -> Dict[str, Any]:
    """
    Query all top-level tasks (no parent) for an initiative and build a
    template structure dict, including one level of subtasks.
    """
    tasks = (
        sb.table("tasks")
        .select("id, title, priority")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )

    task_list = []
    for t in tasks:
        subtasks_raw = (
            sb.table("subtasks")
            .select("title, status")
            .eq("task_id", t["id"])
            .execute()
            .data
        ) or []
        task_list.append({
            "title": t.get("title"),
            "priority": t.get("priority", "medium"),
            "subtasks": [
                {"title": s.get("title"), "priority": "medium"}
                for s in subtasks_raw
            ],
        })

    return {"tasks": task_list}
