from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/themes", tags=["themes"])


class ThemeCreate(BaseModel):
    business_id: str
    program_id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#6366F1"


class ThemeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None


@router.get("/")
def list_themes(
    business_id: str,
    program_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    q = sb.table("themes").select("*").eq("business_id", business_id)
    if program_id:
        q = q.eq("program_id", program_id)
    return q.order("created_at").execute().data


@router.post("/", status_code=201)
def create_theme(
    body: ThemeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, body.business_id, user["id"])
    now = datetime.now(timezone.utc).isoformat()
    result = sb.table("themes").insert({
        "business_id": body.business_id,
        "program_id": body.program_id,
        "name": body.name,
        "description": body.description,
        "color": body.color or "#6366F1",
        "created_at": now,
        "updated_at": now,
    }).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create theme")
    return result.data[0]


@router.patch("/{theme_id}")
def update_theme(
    theme_id: str,
    body: ThemeUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    existing = sb.table("themes").select("business_id").eq("id", theme_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Theme not found")
    require_member(sb, existing[0]["business_id"], user["id"])
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = sb.table("themes").update(updates).eq("id", theme_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/{theme_id}", status_code=204)
def delete_theme(
    theme_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    existing = sb.table("themes").select("business_id").eq("id", theme_id).execute().data
    if not existing:
        raise HTTPException(status_code=404, detail="Theme not found")
    require_member(sb, existing[0]["business_id"], user["id"])
    sb.table("themes").delete().eq("id", theme_id).execute()
    return None
