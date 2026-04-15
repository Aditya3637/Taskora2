from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses/{business_id}", tags=["entities"])


class EntityCreate(BaseModel):
    name: str
    address: Optional[str] = None
    contact_info: Optional[dict] = None


def _require_member(sb: Client, business_id: str, user_id: str) -> None:
    """Raise 403 if the user is not a member of the given business."""
    result = (
        sb.table("business_members")
        .select("business_id")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this business",
        )


@router.post("/buildings", status_code=201)
def add_building(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _require_member(sb, business_id, user["id"])
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
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _require_member(sb, business_id, user["id"])
    return (
        sb.table("buildings")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .execute()
        .data
    )


@router.post("/clients", status_code=201)
def add_client(
    business_id: str,
    body: EntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _require_member(sb, business_id, user["id"])
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
    _require_member(sb, business_id, user["id"])
    return (
        sb.table("clients")
        .select("*")
        .eq("business_id", business_id)
        .eq("is_active", True)
        .execute()
        .data
    )
