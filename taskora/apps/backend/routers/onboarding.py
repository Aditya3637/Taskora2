from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


def _get_business(sb: Client, user_id: str, business_id: Optional[str] = None) -> dict:
    if business_id:
        rows = sb.table("businesses").select("*").eq("id", business_id).execute().data
        if not rows:
            raise HTTPException(status_code=404, detail="Business not found")
        membership = (
            sb.table("business_members")
            .select("user_id")
            .eq("business_id", business_id)
            .eq("user_id", user_id)
            .execute()
            .data
        )
        if not membership:
            raise HTTPException(status_code=403, detail="Not a member of this business")
        return rows[0]

    owned = (
        sb.table("businesses")
        .select("*")
        .eq("owner_id", user_id)
        .order("created_at")
        .limit(1)
        .execute()
        .data
    )
    if owned:
        return owned[0]
    memberships = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user_id)
        .order("joined_at")
        .limit(1)
        .execute()
        .data
    )
    if not memberships:
        raise HTTPException(status_code=404, detail="No business found")
    rows = (
        sb.table("businesses")
        .select("*")
        .eq("id", memberships[0]["business_id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Business not found")
    return rows[0]


@router.get("/status")
def get_status(
    business_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = _get_business(sb, user["id"], business_id)
    return {
        "business_id": biz["id"],
        "business_name": biz.get("name"),
        "business_type": biz.get("type"),
        "workspace_mode": biz.get("workspace_mode"),
        "onboarding_completed": biz.get("onboarding_completed", False),
        "step2_done": biz.get("onboarding_step2_done", False),
        "step2_skipped": biz.get("onboarding_step2_skipped", False),
        "step3_done": biz.get("onboarding_step3_done", False),
        "step3_skipped": biz.get("onboarding_step3_skipped", False),
    }


class Step1Body(BaseModel):
    workspace_mode: Literal["personal", "organisation"]
    business_id: Optional[str] = None


@router.post("/step1")
def complete_step1(
    body: Step1Body,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = _get_business(sb, user["id"], body.business_id)
    sb.table("businesses").update({"workspace_mode": body.workspace_mode}).eq("id", biz["id"]).execute()
    return {"ok": True}


class StepDoneBody(BaseModel):
    skipped: bool = False
    business_id: Optional[str] = None


@router.post("/step2/done")
def step2_done(
    body: StepDoneBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = _get_business(sb, user["id"], body.business_id)
    sb.table("businesses").update({
        "onboarding_step2_done": True,
        "onboarding_step2_skipped": body.skipped,
    }).eq("id", biz["id"]).execute()
    return {"ok": True}


@router.post("/step3/done")
def step3_done(
    body: StepDoneBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = _get_business(sb, user["id"], body.business_id)
    sb.table("businesses").update({
        "onboarding_step3_done": True,
        "onboarding_step3_skipped": body.skipped,
        "onboarding_completed": True,
    }).eq("id", biz["id"]).execute()
    return {"ok": True}


# Assignees (personal-mode named people) ────────────────────────────────────

class AssigneeBody(BaseModel):
    name: str
    business_id: Optional[str] = None


@router.get("/assignees")
def list_assignees(
    business_id: Optional[str] = Query(default=None),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    biz = _get_business(sb, user["id"], business_id)
    return sb.table("assignees").select("*").eq("business_id", biz["id"]).order("created_at").execute().data


@router.post("/assignees", status_code=201)
def add_assignee(
    body: AssigneeBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name cannot be empty")
    biz = _get_business(sb, user["id"], body.business_id)
    result = sb.table("assignees").insert({"business_id": biz["id"], "name": name}).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create assignee")
    return result.data[0]


@router.delete("/assignees/{assignee_id}", status_code=204)
def delete_assignee(
    assignee_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # business_id not needed here — we match on assignee id + implicit business ownership via RLS
    sb.table("assignees").delete().eq("id", assignee_id).execute()
