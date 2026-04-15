from fastapi import APIRouter, Depends
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v1/businesses/{business_id}", tags=["entities"])


class EntityCreate(BaseModel):
    name: str
    address: Optional[str] = None
    contact_info: Optional[dict] = None


@router.post("/buildings", status_code=201)
def add_building(business_id: str, body: EntityCreate, user=Depends(get_current_user), sb: Client = Depends(get_supabase)):
    return sb.table("buildings").insert({
        "name": body.name,
        "address": body.address,
        "business_id": business_id,
    }).execute().data[0]


@router.get("/buildings")
def list_buildings(business_id: str, user=Depends(get_current_user), sb: Client = Depends(get_supabase)):
    return sb.table("buildings").select("*").eq("business_id", business_id).eq("is_active", True).execute().data


@router.post("/clients", status_code=201)
def add_client(business_id: str, body: EntityCreate, user=Depends(get_current_user), sb: Client = Depends(get_supabase)):
    return sb.table("clients").insert({
        "name": body.name,
        "contact_info": body.contact_info or {},
        "business_id": business_id,
    }).execute().data[0]


@router.get("/clients")
def list_clients(business_id: str, user=Depends(get_current_user), sb: Client = Depends(get_supabase)):
    return sb.table("clients").select("*").eq("business_id", business_id).eq("is_active", True).execute().data
