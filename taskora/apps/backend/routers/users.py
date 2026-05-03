from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase

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
    return rows[0]


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
def search_users(q: str = "", user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)):
    if not q or len(q) < 2:
        return []
    return sb.table("users").select("id, name, avatar_url").ilike("name", f"%{q}%").limit(20).execute().data
