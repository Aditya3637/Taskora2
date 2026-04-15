from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from config import get_settings, Settings
from auth import get_current_user
from deps import get_supabase
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])


class BusinessCreate(BaseModel):
    name: str
    type: str  # 'building' | 'client'


@router.post("/", status_code=201)
def create_business(
    body: BusinessCreate,
    user=Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = sb.table("businesses").insert({
        "name": body.name,
        "type": body.type,
        "owner_id": user["id"],
    }).execute().data[0]
    sb.table("business_members").insert({
        "business_id": biz["id"],
        "user_id": user["id"],
        "role": "owner",
    }).execute()
    return biz


@router.get("/")
def list_businesses(user=Depends(get_current_user), sb: Client = Depends(get_supabase)):
    memberships = sb.table("business_members").select("business_id").eq("user_id", user["id"]).execute().data
    ids = [m["business_id"] for m in memberships]
    if not ids:
        return []
    return sb.table("businesses").select("*").in_("id", ids).execute().data
