from typing import List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/programs", tags=["programs"])


class ProgramCreate(BaseModel):
    business_id: str
    name: str
    description: Optional[str] = None
    lead_user_id: Optional[str] = None
    color: Optional[str] = None


class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lead_user_id: Optional[str] = None
    color: Optional[str] = None


@router.get("/")
def list_programs(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all programs for a business, with initiative count."""
    require_member(sb, business_id, user["id"])

    programs = (
        sb.table("programs")
        .select("*, initiatives(count)")
        .eq("business_id", business_id)
        .order("created_at", desc=False)
        .execute()
        .data
    )

    # Flatten initiative count
    for p in programs:
        initiatives = p.pop("initiatives", None)
        if isinstance(initiatives, list):
            p["initiative_count"] = initiatives[0]["count"] if initiatives else 0
        else:
            p["initiative_count"] = 0

    return programs


@router.post("/", status_code=201)
def create_program(
    body: ProgramCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create a new program under a business."""
    require_member(sb, body.business_id, user["id"])

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "business_id": body.business_id,
        "name": body.name,
        "description": body.description,
        "lead_user_id": body.lead_user_id or user["id"],
        "color": body.color,
        "created_at": now,
        "updated_at": now,
    }
    result = sb.table("programs").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create program")
    return result.data[0]


@router.patch("/{program_id}")
def update_program(
    program_id: str,
    body: ProgramUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update a program's fields."""
    existing = sb.table("programs").select("business_id").eq("id", program_id).execute().data
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")

    require_member(sb, existing[0]["business_id"], user["id"])

    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = sb.table("programs").update(updates).eq("id", program_id).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return result.data[0]


@router.delete("/{program_id}", status_code=204)
def delete_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Delete a program. Only the creator or admin may delete."""
    existing = sb.table("programs").select("business_id, lead_user_id").eq("id", program_id).execute().data
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")

    program = existing[0]
    business_id = program["business_id"]

    # Only owner/admin or the program lead may delete
    member = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this business")

    is_admin = member[0].get("role") in ("owner", "admin")
    is_lead = program.get("lead_user_id") == user["id"]

    if not is_admin and not is_lead:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only owner/admin or program lead may delete")

    sb.table("programs").delete().eq("id", program_id).execute()
    return None


@router.get("/full-tree")
def get_full_tree(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return all programs with their themes and initiatives — single call for the org hierarchy."""
    require_member(sb, business_id, user["id"])

    programs = (
        sb.table("programs")
        .select("*")
        .eq("business_id", business_id)
        .order("created_at")
        .execute()
        .data
    )

    # Fetch all themes for this business (table may not exist yet before migration 008)
    try:
        all_themes = (
            sb.table("themes")
            .select("*")
            .eq("business_id", business_id)
            .order("created_at")
            .execute()
            .data
        )
    except Exception:
        all_themes = []

    # Fetch all initiatives with owner and primary stakeholder info
    try:
        all_initiatives = (
            sb.table("initiatives")
            .select("id, name, status, impact, impact_category, impact_metric, owner_id, primary_stakeholder_id, target_end_date, program_id, theme_id")
            .eq("business_id", business_id)
            .neq("status", "cancelled")
            .order("created_at")
            .execute()
            .data
        )
    except Exception:
        # Fallback: fetch without newer columns (pre-migration-008 schema)
        try:
            all_initiatives = (
                sb.table("initiatives")
                .select("id, name, status, impact, impact_category, owner_id, primary_stakeholder_id, target_end_date, program_id")
                .eq("business_id", business_id)
                .neq("status", "cancelled")
                .order("created_at")
                .execute()
                .data
            )
            for init in all_initiatives:
                init.setdefault("impact_metric", None)
                init.setdefault("theme_id", None)
        except Exception:
            all_initiatives = []

    # Resolve owner and primary stakeholder names in bulk
    user_ids = list({
        uid
        for i in all_initiatives
        for uid in [i.get("owner_id"), i.get("primary_stakeholder_id")]
        if uid
    })
    owner_map: dict = {}
    if user_ids:
        rows = sb.table("users").select("id, name").in_("id", user_ids).execute().data
        owner_map = {r["id"]: r["name"] for r in rows}

    for init in all_initiatives:
        init["owner_name"] = owner_map.get(init.get("owner_id") or "", "")
        init["primary_stakeholder_name"] = owner_map.get(init.get("primary_stakeholder_id") or "", "")

    # Index themes and initiatives for fast grouping
    themes_by_program: dict = {}
    for t in all_themes:
        themes_by_program.setdefault(t["program_id"], []).append(t)

    initiatives_by_theme: dict = {}
    initiatives_by_program_no_theme: dict = {}
    for init in all_initiatives:
        if init.get("theme_id"):
            initiatives_by_theme.setdefault(init["theme_id"], []).append(init)
        elif init.get("program_id"):
            initiatives_by_program_no_theme.setdefault(init["program_id"], []).append(init)

    # Assemble tree
    for program in programs:
        pid = program["id"]
        themes = themes_by_program.get(pid, [])
        for theme in themes:
            theme["initiatives"] = initiatives_by_theme.get(theme["id"], [])
        program["themes"] = themes
        program["unthemed_initiatives"] = initiatives_by_program_no_theme.get(pid, [])

    return programs


@router.get("/{program_id}/initiatives")
def list_program_initiatives(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all initiatives under a program."""
    existing = sb.table("programs").select("business_id").eq("id", program_id).execute().data
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")

    require_member(sb, existing[0]["business_id"], user["id"])

    initiatives = (
        sb.table("initiatives")
        .select("*")
        .eq("program_id", program_id)
        .order("created_at", desc=False)
        .execute()
        .data
    )
    return initiatives
