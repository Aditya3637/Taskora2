from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase
from rate_limit import limiter

router = APIRouter(prefix="/api/v1/users", tags=["users"])


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    avatar_url: Optional[str] = None


class FCMTokenBody(BaseModel):
    token: str


@router.get("/me")
def get_me(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    rows = sb.table("users").select("*").eq("id", user["id"]).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="User not found")
    me = rows[0]
    # Platform-admin flag from the locked-RLS platform_admins table
    # (migration 040). The legacy user_metadata.is_admin claim was
    # user-writable; this read is the authoritative source.
    admin_rows = (
        sb.table("platform_admins")
        .select("user_id")
        .eq("user_id", user["id"])
        .limit(1)
        .execute()
        .data
    )
    me["is_platform_admin"] = bool(admin_rows)
    return me


@router.patch("/me")
def update_me(body: ProfileUpdate, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    result = sb.table("users").update(payload).eq("id", user["id"]).execute()
    return result.data[0] if result.data else {}


@router.post("/fcm-token", status_code=204)
def store_fcm_token(body: FCMTokenBody, user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    rows = sb.table("users").select("settings").eq("id", user["id"]).execute().data
    existing = (rows[0].get("settings") or {}) if rows else {}
    existing["fcm_token"] = body.token
    sb.table("users").update({"settings": existing}).eq("id", user["id"]).execute()


@router.get("/search")
@limiter.limit("60/minute")
def search_users(request: Request, q: str = "", user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    """Search by name, scoped to the caller's workspaces only. Previously
    this leaked names across every tenant in the DB because there was no
    business_id filter — any authenticated user could enumerate users.
    """
    if not q or len(q) < 2:
        return []
    # Resolve every business the caller is a member of, then the union of
    # every member across those businesses, then filter by name match.
    biz_rows = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    biz_ids = [r["business_id"] for r in biz_rows]
    if not biz_ids:
        return []
    member_rows = (
        sb.table("business_members")
        .select("user_id")
        .in_("business_id", biz_ids)
        .execute()
        .data
    )
    candidate_ids = sorted({r["user_id"] for r in member_rows})
    if not candidate_ids:
        return []
    return (
        sb.table("users")
        .select("id, name, avatar_url")
        .in_("id", candidate_ids)
        .ilike("name", f"%{q}%")
        .limit(20)
        .execute()
        .data
    )
