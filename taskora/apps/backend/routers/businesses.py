from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


class BusinessCreate(BaseModel):
    name: str
    type: Literal["building", "client"]


@router.post("/", status_code=201)
def create_business(
    body: BusinessCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz_result = sb.table("businesses").insert({
        "name": body.name,
        "type": body.type,
        "owner_id": user["id"],
    }).execute()
    if not biz_result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to create business")
    biz = biz_result.data[0]

    member_result = sb.table("business_members").insert({
        "business_id": biz["id"],
        "user_id": user["id"],
        "role": "owner",
    }).execute()
    if not member_result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Business created but failed to assign owner membership")

    return biz


@router.get("/")
def list_businesses(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    memberships = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    ids = [m["business_id"] for m in memberships]
    if not ids:
        return []
    return sb.table("businesses").select("*").in_("id", ids).execute().data
