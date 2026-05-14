from datetime import datetime, timezone, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member, require_admin_or_owner
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


class BusinessCreate(BaseModel):
    name: str
    type: Literal["building", "client"]
    workspace_mode: Optional[Literal["personal", "organisation"]] = None


class BusinessUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["building", "client"]] = None
    workspace_mode: Optional[Literal["personal", "organisation"]] = None


class MemberRoleUpdate(BaseModel):
    role: Literal["member", "admin"]


@router.post("/", status_code=201)
def create_business(
    body: BusinessCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Enforce one business per user — return the existing one if present
    existing = (
        sb.table("businesses")
        .select("*")
        .eq("owner_id", user["id"])
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have a workspace. Edit it instead of creating a new one.",
        )

    insert_payload: dict = {"name": body.name, "type": body.type, "owner_id": user["id"]}
    if body.workspace_mode:
        insert_payload["workspace_mode"] = body.workspace_mode
    biz_result = sb.table("businesses").insert(insert_payload).execute()
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


@router.patch("/{business_id}")
def update_business(
    business_id: str,
    body: BusinessUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update workspace name, type, or workspace_mode. Owner or admin only."""
    require_admin_or_owner(sb, business_id, user["id"])
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    result = sb.table("businesses").update(payload).eq("id", business_id).execute()
    return result.data[0] if result.data else {}


@router.get("")
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


@router.patch("/{business_id}/members/{target_user_id}")
def update_member_role(
    business_id: str,
    target_user_id: str,
    body: MemberRoleUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    caller_role = require_admin_or_owner(sb, business_id, user["id"])

    # Can't modify yourself
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    # Fetch target's current role
    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    target_role = target_rows[0]["role"]

    # Protect the owner — never reassignable via this endpoint
    if target_role == "owner":
        raise HTTPException(status_code=403, detail="Cannot change the workspace owner's role")

    # Admins can only manage members, not other admins
    if caller_role == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot change another admin's role")

    result = (
        sb.table("business_members")
        .update({"role": body.role})
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
    )
    return result.data[0] if result.data else {}


@router.delete("/{business_id}/members/{target_user_id}", status_code=204)
def remove_member(
    business_id: str,
    target_user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    caller_role = require_admin_or_owner(sb, business_id, user["id"])

    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the workspace")

    target_rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    if not target_rows:
        raise HTTPException(status_code=404, detail="Member not found")

    target_role = target_rows[0]["role"]

    if target_role == "owner":
        raise HTTPException(status_code=403, detail="Cannot remove the workspace owner")

    if caller_role == "admin" and target_role == "admin":
        raise HTTPException(status_code=403, detail="Admins cannot remove other admins")

    sb.table("business_members").delete().eq("business_id", business_id).eq("user_id", target_user_id).execute()


@router.get("/{business_id}/my-role")
def get_my_role(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the current user's role in this business."""
    rows = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not a member of this business")
    return {"role": rows[0]["role"]}
