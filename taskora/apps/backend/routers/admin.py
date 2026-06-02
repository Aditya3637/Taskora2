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
    """Platform-admin gate. Reads the dedicated platform_admins table —
    migration 040 moved the flag here from users.settings.is_admin because
    that JSONB column was writable by any user via RLS, allowing self-
    elevation. platform_admins has no RLS policies, so only the backend's
    service-role client can read/write it."""
    rows = (
        sb.table("platform_admins")
        .select("user_id")
        .eq("user_id", user["id"])
        .limit(1)
        .execute()
        .data
    )
    if not rows:
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


# ── Accounts vs users vs seats (the "100 users ≠ 100 sales" view) ──────────────
#
# The billing unit is the WORKSPACE (business) — one account, one
# subscription, N seats (members). A 100-employee company is ONE sale with
# 100 seats, not 100 sales. This endpoint separates the three numbers people
# constantly conflate: headcount (users), accounts (workspaces), and the only
# one that's revenue — paying accounts.

@router.get("/metrics/accounts")
def account_metrics(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    total_users = sb.table("users").select("id", count="exact").execute().count or 0
    total_accounts = sb.table("businesses").select("id", count="exact").execute().count or 0
    subs = sb.table("subscriptions").select("business_id, plan, status").execute().data
    active = [s for s in subs if s.get("status") == "active"]
    trialing = [s for s in subs if s.get("status") == "trialing"]
    past_due = [s for s in subs if s.get("status") == "past_due"]

    paid_ids = [s["business_id"] for s in active if s.get("business_id")]
    paid_seats = 0
    if paid_ids:
        paid_seats = len(
            sb.table("business_members").select("user_id").in_("business_id", paid_ids).execute().data
        )
    mrr = sum(PLAN_MRR.get(s.get("plan", ""), 0) for s in active)
    return {
        # Headcount — people, NOT sales.
        "total_users": total_users,
        # Accounts = workspaces.
        "total_accounts": total_accounts,
        # The only line that is revenue: paying accounts (logos).
        "paying_accounts": len(active),
        "trialing_accounts": len(trialing),
        "past_due_accounts": len(past_due),
        # Employees covered by paid plans.
        "paid_seats": paid_seats,
        "avg_seats_per_paying_account": round(paid_seats / len(active), 1) if active else 0.0,
        # Illustrates the trap directly: how many users per actual sale.
        "users_per_paying_account": round(total_users / len(active), 1) if active else 0.0,
        "mrr": mrr,
        "arr": mrr * 12,
    }


# ── Lifecycle automation console ───────────────────────────────────────────────

_KNOWN_CAMPAIGNS = ["trial", "dunning", "activation"]


def _parse_iso(s):
    if not s:
        return None
    try:
        from datetime import datetime as _dt
        v = s.replace("Z", "+00:00")
        d = _dt.fromisoformat(v)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


@router.get("/lifecycle/overview")
def lifecycle_overview(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    now = datetime.now(timezone.utc)
    since_30 = (now - timedelta(days=30)).isoformat()

    msgs = sb.table("messages").select("template, channel, status, ts").gte("ts", since_30).execute().data
    by_template: dict[str, dict] = {}
    by_status = {"sent": 0, "failed": 0, "suppressed": 0, "skipped": 0}
    for m in msgs:
        st = m.get("status", "sent")
        by_status[st] = by_status.get(st, 0) + 1
        d = by_template.setdefault(m.get("template", "?"), {"sent": 0, "failed": 0, "suppressed": 0, "skipped": 0})
        d[st] = d.get(st, 0) + 1

    past_due = sb.table("subscriptions").select("plan").eq("status", "past_due").execute().data
    revenue_at_risk = sum(PLAN_MRR.get(s.get("plan", ""), 0) for s in past_due)

    trialing = sb.table("subscriptions").select("trial_end").eq("status", "trialing").execute().data
    ending_7d = 0
    for s in trialing:
        end = _parse_iso(s.get("trial_end"))
        if end and 0 <= (end - now).total_seconds() / 86400.0 <= 7:
            ending_7d += 1

    jobs = sb.table("automation_jobs").select("status").execute().data
    job_health: dict[str, int] = {}
    for j in jobs:
        job_health[j.get("status", "?")] = job_health.get(j.get("status", "?"), 0) + 1

    return {
        "messages_30d": {"by_status": by_status, "by_template": by_template, "total": len(msgs)},
        "revenue_at_risk_inr": revenue_at_risk,
        "past_due_accounts": len(past_due),
        "trials_ending_7d": ending_7d,
        "job_health": job_health,
    }


@router.get("/lifecycle/messages")
def lifecycle_messages(
    limit: int = 100,
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    return (
        sb.table("messages").select("*").order("ts", desc=True)
        .limit(min(max(limit, 1), 500)).execute().data
    )


@router.get("/lifecycle/at-risk")
def lifecycle_at_risk(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    """Past-due accounts with seats + ₹ + dunning stage — the money board."""
    subs = (
        sb.table("subscriptions")
        .select("business_id, plan, status, current_period_end, updated_at")
        .eq("status", "past_due").execute().data
    )
    if not subs:
        return []
    biz_ids = [s["business_id"] for s in subs if s.get("business_id")]
    biz = {b["id"]: b for b in sb.table("businesses").select("id, name, owner_id").in_("id", biz_ids).execute().data}
    members = sb.table("business_members").select("business_id").in_("business_id", biz_ids).execute().data
    seats: dict[str, int] = {}
    for m in members:
        seats[m["business_id"]] = seats.get(m["business_id"], 0) + 1
    # last dunning message per account
    msgs = (
        sb.table("messages").select("business_id, template, ts")
        .eq("campaign", "dunning").in_("business_id", biz_ids).execute().data
    )
    last_msg: dict[str, dict] = {}
    for m in sorted(msgs, key=lambda x: x.get("ts") or ""):
        last_msg[m["business_id"]] = m
    now = datetime.now(timezone.utc)
    out = []
    for s in subs:
        bid = s.get("business_id")
        b = biz.get(bid, {})
        failed_at = _parse_iso(s.get("current_period_end")) or _parse_iso(s.get("updated_at"))
        days = int((now - failed_at).total_seconds() / 86400.0) if failed_at else None
        out.append({
            "business_id": bid,
            "name": b.get("name") or "",
            "plan": s.get("plan"),
            "mrr_inr": PLAN_MRR.get(s.get("plan", ""), 0),
            "seats": seats.get(bid, 0),
            "days_past_due": days,
            "last_dunning": (last_msg.get(bid) or {}).get("template"),
        })
    out.sort(key=lambda r: (r["mrr_inr"], r.get("days_past_due") or 0), reverse=True)
    return out


@router.get("/lifecycle/campaigns")
def lifecycle_campaigns(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("automation_settings").select("campaign, enabled").execute().data
    by = {r["campaign"]: r["enabled"] for r in rows}
    return [{"campaign": c, "enabled": bool(by.get(c, True))} for c in _KNOWN_CAMPAIGNS]


class CampaignToggle(BaseModel):
    enabled: bool


@router.post("/lifecycle/campaigns/{campaign}")
def toggle_campaign(
    campaign: str,
    body: CampaignToggle,
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    if campaign not in _KNOWN_CAMPAIGNS:
        raise HTTPException(status_code=404, detail="Unknown campaign")
    sb.table("automation_settings").upsert(
        {"campaign": campaign, "enabled": body.enabled,
         "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="campaign",
    ).execute()
    return {"campaign": campaign, "enabled": body.enabled}


@router.post("/lifecycle/run")
def lifecycle_run(
    user: dict = Depends(require_admin),
    sb: Client = Depends(get_supabase),
):
    """Manually fire one automation tick (the same work the cron does)."""
    from automation import runner
    return runner.tick(sb)
