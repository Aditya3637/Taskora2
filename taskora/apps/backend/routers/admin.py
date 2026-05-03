from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
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
