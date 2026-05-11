from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

PLAN_MRR: dict[str, int] = {"pro": 999, "business": 2999, "enterprise": 0}


def require_admin(user: dict = Depends(get_current_user), sb: Client = Depends(get_supabase)) -> dict:
    """Check is_admin flag in users.settings JSONB."""
    data = sb.table("users").select("settings").eq("id", user["id"]).execute().data
    settings = (data[0].get("settings") or {}) if data else {}
    if not settings.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


# ── Metrics ──────────────────────────────────────────────────────────────────

@router.get("/metrics/revenue")
def revenue_metrics(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    subs = (
        sb.table("subscriptions")
        .select("plan, status, billing_cycle")
        .eq("status", "active")
        .execute()
        .data
    )
    mrr = sum(PLAN_MRR.get(s.get("plan", ""), 0) for s in subs)
    plan_breakdown = {p: sum(1 for s in subs if s.get("plan") == p) for p in PLAN_MRR}
    return {
        "mrr": mrr,
        "arr": mrr * 12,
        "active_subscriptions": len(subs),
        "plan_breakdown": plan_breakdown,
    }


@router.get("/metrics/funnel")
def funnel_metrics(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    total_users = sb.table("users").select("id", count="exact").execute().count or 0
    trialing = sb.table("subscriptions").select("id", count="exact").eq("status", "trialing").execute().count or 0
    active = sb.table("subscriptions").select("id", count="exact").eq("status", "active").execute().count or 0
    return {
        "total_signups": total_users,
        "trialing": trialing,
        "paid": active,
        "trial_to_paid_rate": round(active / trialing * 100, 1) if trialing else 0.0,
    }


@router.get("/metrics/engagement")
def engagement_metrics(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    since_7d = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    tasks_count = (
        sb.table("tasks").select("id", count="exact").gte("created_at", since_7d).execute().count or 0
    )
    decisions_count = (
        sb.table("decision_log").select("id", count="exact").gte("created_at", since_7d).execute().count or 0
    )
    return {
        "tasks_created_7d": tasks_count,
        "decisions_made_7d": decisions_count,
    }


# ── Tenants ───────────────────────────────────────────────────────────────────

@router.get("/tenants")
def list_tenants(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    businesses = (
        sb.table("businesses")
        .select("id, name, owner_id, created_at")
        .order("created_at", desc=True)
        .limit(500)
        .execute()
        .data
    )
    if not businesses:
        return []

    biz_ids = [b["id"] for b in businesses]

    # Subscriptions
    subs_raw = (
        sb.table("subscriptions")
        .select("business_id, plan, status, trial_end")
        .in_("business_id", biz_ids)
        .execute()
        .data
    )
    sub_map = {s["business_id"]: s for s in subs_raw}

    # Member counts
    members_raw = (
        sb.table("business_members")
        .select("business_id")
        .in_("business_id", biz_ids)
        .execute()
        .data
    )
    member_count: dict[str, int] = {}
    for m in members_raw:
        bid = m["business_id"]
        member_count[bid] = member_count.get(bid, 0) + 1

    # Owner emails via auth admin API (service role)
    email_map: dict[str, str] = {}
    try:
        auth_users = sb.auth.admin.list_users()
        for u in auth_users:
            uid = str(getattr(u, "id", "") or "")
            email = getattr(u, "email", "") or ""
            if uid:
                email_map[uid] = email
    except Exception:
        pass

    result = []
    for b in businesses:
        sub = sub_map.get(b["id"], {})
        result.append({
            "id": b["id"],
            "name": b.get("name") or "",
            "owner_email": email_map.get(b.get("owner_id", ""), b.get("owner_id", "")),
            "member_count": member_count.get(b["id"], 0),
            "plan": sub.get("plan", "free"),
            "status": sub.get("status", "trialing"),
            "trial_end": sub.get("trial_end"),
            "created_at": b.get("created_at"),
        })
    return result


# ── Legacy customers alias ────────────────────────────────────────────────────

@router.get("/customers")
def customer_list(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    return (
        sb.table("subscriptions")
        .select("*, businesses(name, owner_id)")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )


# ── Sales Leads ───────────────────────────────────────────────────────────────

class LeadCreate(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    stage: Literal["lead", "demo", "trial", "negotiation", "won", "lost"] = "lead"
    mrr: int = 0
    notes: Optional[str] = None


class LeadUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    stage: Optional[Literal["lead", "demo", "trial", "negotiation", "won", "lost"]] = None
    mrr: Optional[int] = None
    notes: Optional[str] = None


@router.get("/sales-leads")
def list_sales_leads(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    return (
        sb.table("sales_leads")
        .select("*")
        .order("created_at", desc=True)
        .execute()
        .data
    )


@router.post("/sales-leads", status_code=201)
def create_sales_lead(
    body: LeadCreate,
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    if not body.company_name.strip():
        raise HTTPException(status_code=422, detail="company_name is required")
    payload = body.model_dump()
    result = sb.table("sales_leads").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create lead")
    return result.data[0]


@router.patch("/sales-leads/{lead_id}")
def update_sales_lead(
    lead_id: str,
    body: LeadUpdate,
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = sb.table("sales_leads").update(payload).eq("id", lead_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/sales-leads/{lead_id}", status_code=204)
def delete_sales_lead(
    lead_id: str,
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    sb.table("sales_leads").delete().eq("id", lead_id).execute()
