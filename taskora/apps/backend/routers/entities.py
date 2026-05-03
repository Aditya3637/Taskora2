from typing import Optional
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses/{business_id}", tags=["entities"])


class EntityCreate(BaseModel):
    name: str
    address: Optional[str] = None
    contact_info: Optional[dict] = None


@router.post("/buildings", status_code=201)
def add_building(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    result = sb.table("buildings").insert({
        "name": body.name,
        "address": body.address,
        "business_id": business_id,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create building")
    return result.data[0]


@router.get("/buildings")
def list_buildings(
    business_id: str,
    btype: Optional[str] = Query(default=None, description="Filter by building type"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    query = (
        sb.table("buildings")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
    )
    if btype is not None:
        query = query.eq("btype", btype)
    return query.execute().data


@router.post("/clients", status_code=201)
def add_client(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    result = sb.table("clients").insert({
        "name": body.name,
        "contact_info": body.contact_info or {},
        "business_id": business_id,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create client")
    return result.data[0]


@router.get("/clients")
def list_clients(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    return (
        sb.table("clients")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .execute()
        .data
    )


# ---------------------------------------------------------------------------
# Building detail & update endpoints
# ---------------------------------------------------------------------------

class BuildingUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    serial_number: Optional[str] = None
    city: Optional[str] = None
    code: Optional[str] = None
    btype: Optional[str] = None
    soft_handover_date: Optional[date] = None
    hard_handover_date: Optional[date] = None
    completion_pct: Optional[float] = None


@router.get("/buildings/{building_id}")
def get_building(
    business_id: str,
    building_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return full building details including rich metadata fields."""
    require_member(sb, business_id, user["id"])
    rows = (
        sb.table("buildings")
        .select("*")
        .eq("id", building_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Building not found")
    return rows[0]


@router.patch("/buildings/{building_id}")
def update_building(
    business_id: str,
    building_id: str,
    body: BuildingUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Partial update of building rich metadata."""
    require_member(sb, business_id, user["id"])

    # Verify building belongs to business
    existing = (
        sb.table("buildings")
        .select("id")
        .eq("id", building_id)
        .eq("business_id", business_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Building not found")

    payload = {}
    raw = body.model_dump()
    for field, value in raw.items():
        if value is not None:
            if isinstance(value, date):
                payload[field] = value.isoformat()
            else:
                payload[field] = value

    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    result = sb.table("buildings").update(payload).eq("id", building_id).execute()
    return result.data[0] if result.data else {}
