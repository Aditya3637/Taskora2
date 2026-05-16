from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel, field_validator

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/programs", tags=["programs"])

_VALID_STATUSES = {"active", "paused", "completed", "archived"}
_VALID_IMPACT_CATS = {"cost", "customer_experience", "process_efficiency", "other"}


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProgramCreate(BaseModel):
    business_id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3B82F6"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("color")
    @classmethod
    def valid_color(cls, v: Optional[str]) -> str:
        if v and not v.startswith("#"):
            raise ValueError("color must be a hex value starting with #")
        return v or "#3B82F6"


class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, v: Optional[str]) -> Optional[str]:
        # Mirror ProgramCreate's rule. Create rejected blank/over-long names but
        # update silently accepted them (whitespace-only, 500-char names).
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
        return v


class InitiativeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    primary_stakeholder_id: Optional[str] = None
    impact_category: Optional[str] = "other"
    impact: Optional[str] = None
    impact_metric: Optional[str] = None
    target_end_date: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 150:
            raise ValueError("name cannot exceed 150 characters")
        return v

    @field_validator("impact_category")
    @classmethod
    def valid_impact_cat(cls, v: Optional[str]) -> str:
        if v and v not in _VALID_IMPACT_CATS:
            return "other"
        return v or "other"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_program_or_404(sb: Client, program_id: str) -> dict:
    rows = (
        sb.table("programs")
        .select("id, business_id, name, description, status, color, lead_user_id, created_at")
        .eq("id", program_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return rows[0]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_programs(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all programs for a business with their initiative counts."""
    require_member(sb, business_id, user["id"])

    programs = (
        sb.table("programs")
        .select("id, name, description, status, color, created_at")
        .eq("business_id", business_id)
        .order("created_at")
        .execute()
        .data
    )

    if programs:
        prog_ids = [p["id"] for p in programs]
        init_rows = (
            sb.table("initiatives")
            .select("program_id")
            .in_("program_id", prog_ids)
            .neq("status", "cancelled")
            .execute()
            .data
        )
        counts: dict = {}
        for r in init_rows:
            pid = r["program_id"]
            counts[pid] = counts.get(pid, 0) + 1
        for p in programs:
            p["initiative_count"] = counts.get(p["id"], 0)

    return programs


@router.post("", status_code=201)
def create_program(
    body: ProgramCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create a new program under a business."""
    require_member(sb, body.business_id, user["id"])

    now = datetime.now(timezone.utc).isoformat()
    result = sb.table("programs").insert({
        "business_id": body.business_id,
        "name": body.name,
        "description": body.description or None,
        "lead_user_id": user["id"],
        "color": body.color,
        "created_at": now,
        "updated_at": now,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create program",
        )
    return result.data[0]


@router.get("/{program_id}")
def get_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Get a single program with all its non-cancelled initiatives."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    initiatives = (
        sb.table("initiatives")
        .select(
            "id, name, status, description, impact, impact_category, "
            "impact_metric, primary_stakeholder_id, target_end_date"
        )
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Resolve primary stakeholder names in one bulk query
    ps_ids = list({i["primary_stakeholder_id"] for i in initiatives if i.get("primary_stakeholder_id")})
    name_map: dict = {}
    if ps_ids:
        rows = sb.table("users").select("id, name").in_("id", ps_ids).execute().data
        name_map = {r["id"]: r["name"] for r in rows}
    for init in initiatives:
        init["primary_stakeholder_name"] = name_map.get(
            init.get("primary_stakeholder_id") or "", ""
        )

    program["initiatives"] = initiatives
    return program


@router.post("/{program_id}/initiatives", status_code=201)
def add_initiative(
    program_id: str,
    body: InitiativeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Add an initiative directly to a program."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    result = sb.table("initiatives").insert({
        "business_id": program["business_id"],
        "program_id": program_id,
        "name": body.name,
        "description": body.description or None,
        "owner_id": user["id"],
        "primary_stakeholder_id": body.primary_stakeholder_id or user["id"],
        "impact_category": body.impact_category,
        "impact": body.impact or None,
        "impact_metric": body.impact_metric or None,
        "target_end_date": body.target_end_date or None,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create initiative",
        )
    return result.data[0]


@router.patch("/{program_id}")
def update_program(
    program_id: str,
    body: ProgramUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update a program's fields."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields to update",
        )
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
    """Delete a program. Only the owner, admin, or program lead may delete."""
    program = _get_program_or_404(sb, program_id)

    member = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", program["business_id"])
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this business")

    is_admin = member[0]["role"] in ("owner", "admin")
    is_lead = program.get("lead_user_id") == user["id"]

    if not is_admin and not is_lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owner, admin, or program lead may delete",
        )

    sb.table("programs").delete().eq("id", program_id).execute()
    return None
