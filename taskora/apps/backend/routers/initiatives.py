from typing import List, Literal, Optional
from datetime import date

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
