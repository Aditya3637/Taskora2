from datetime import datetime, timezone, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member
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

    # Auto-provision 60-day free trial subscription
    now = datetime.now(timezone.utc)
    sb.table("subscriptions").upsert({
        "business_id": biz["id"],
        "plan": "free",
        "status": "trialing",
        "trial_start": now.isoformat(),
        "trial_end": (now + timedelta(days=60)).isoformat(),
        "billing_cycle": "monthly",
        "amount_inr": 0,
    }, on_conflict="business_id").execute()

    return biz


@router.get("/my")
def get_my_business(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the first business this user owns (the primary workspace)."""
    owned = (
        sb.table("businesses")
        .select("*")
        .eq("owner_id", user["id"])
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    if owned:
        return owned[0]

    # Fall back to any business the user is a member of
    memberships = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user["id"])
        .order("joined_at")
        .limit(1)
        .execute()
        .data
    )
    if not memberships:
        raise HTTPException(status_code=404, detail="No business found for this user")

    biz = sb.table("businesses").select("*").eq("id", memberships[0]["business_id"]).execute().data
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    return biz[0]


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


@router.get("/{business_id}/members")
def list_business_members(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    members = (
        sb.table("business_members")
        .select("user_id, role, joined_at")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    user_ids = [m["user_id"] for m in members]
    if not user_ids:
        return []
    users_rows = sb.table("users").select("id, name").in_("id", user_ids).execute().data
    user_map = {u["id"]: u for u in users_rows}
    for m in members:
        u = user_map.get(m["user_id"], {})
        m["name"] = u.get("name", "")
    return members
