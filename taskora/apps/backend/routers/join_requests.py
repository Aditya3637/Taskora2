"""Entry 2 — domain-discovery join requests.

A user who signs up with a company email can discover an existing
workspace whose owner shares their email domain, and request to join it
(instead of creating a duplicate business). Owners/admins approve.

Trust model: member-domain heuristic (no DNS verification) — accepted
trade-off. Public mailbox domains are excluded so gmail.com etc. never
match a workspace.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from rate_limit import limiter
from pydantic import BaseModel
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_admin_or_owner

router = APIRouter(prefix="/api/v1/join", tags=["join-requests"])

# Free/public mailbox providers — a shared domain here means nothing.
PUBLIC_EMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "msn.com", "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "icloud.com",
    "me.com", "mac.com", "proton.me", "protonmail.com", "aol.com",
    "zoho.com", "zohomail.com", "gmx.com", "gmx.net", "mail.com",
    "yandex.com", "rediffmail.com", "fastmail.com", "hey.com",
}


def _domain(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return None
    d = email.rsplit("@", 1)[1].strip().lower()
    return d or None


def _candidate_businesses(sb: Client, domain: str) -> list[dict]:
    """Businesses where ANY member's email shares this (non-public) domain.

    Member-domain heuristic (per product decision) — not owner-only: a
    workspace whose owner signed up with a personal email but whose team
    uses the company domain must still be discoverable.
    """
    domain_users = (
        sb.table("users")
        .select("id")
        .ilike("email", f"%@{domain}")
        .execute()
        .data
    )
    user_ids = [u["id"] for u in domain_users]
    if not user_ids:
        return []
    member_rows = (
        sb.table("business_members")
        .select("business_id")
        .in_("user_id", user_ids)
        .execute()
        .data
    )
    biz_ids = list({m["business_id"] for m in member_rows})
    if not biz_ids:
        return []
    return (
        sb.table("businesses")
        .select("id, name")
        .in_("id", biz_ids)
        .order("created_at")
        .execute()
        .data
    )


@router.get("/discover")
def discover(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Workspaces the current user could request to join, by email domain."""
    domain = _domain(user.get("email"))
    if not domain or domain in PUBLIC_EMAIL_DOMAINS:
        return {"domain": domain, "workspaces": []}

    cands = _candidate_businesses(sb, domain)
    if not cands:
        return {"domain": domain, "workspaces": []}

    biz_ids = [b["id"] for b in cands]
    member_of = {
        m["business_id"]
        for m in sb.table("business_members")
        .select("business_id")
        .eq("user_id", user["id"])
        .in_("business_id", biz_ids)
        .execute()
        .data
    }
    reqs = {
        r["business_id"]: r["status"]
        for r in sb.table("workspace_join_requests")
        .select("business_id, status")
        .eq("user_id", user["id"])
        .in_("business_id", biz_ids)
        .execute()
        .data
    }
    out = []
    for b in cands:
        if b["id"] in member_of:
            continue  # already in it — nothing to request
        out.append({
            "business_id": b["id"],
            "business_name": b["name"],
            "request_status": reqs.get(b["id"]),  # None | pending | approved | declined
        })
    return {"domain": domain, "workspaces": out}


@router.get("/my-status")
def my_status(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Does the caller have a pending join request? Used by the onboarding
    guard so a requester isn't pushed into creating a business."""
    rows = (
        sb.table("workspace_join_requests")
        .select("business_id, status, businesses(name)")
        .eq("user_id", user["id"])
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return {"pending": False}
    biz = rows[0].get("businesses") or {}
    return {"pending": True, "business_name": biz.get("name")}


class JoinRequestBody(BaseModel):
    business_id: str


@router.post("/requests", status_code=201)
@limiter.limit("20/minute")  # join-request spam guard
def create_request(
    request: Request,
    body: JoinRequestBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Request to join a workspace. Idempotent per (business, user);
    re-requesting after a decline reopens the same row as pending."""
    # Must actually share the workspace owner's domain — don't let anyone
    # request into an arbitrary business by guessing its id.
    domain = _domain(user.get("email"))
    if not domain or domain in PUBLIC_EMAIL_DOMAINS:
        raise HTTPException(status_code=403, detail="A company email is required to request access")
    if body.business_id not in {b["id"] for b in _candidate_businesses(sb, domain)}:
        raise HTTPException(status_code=403, detail="This workspace doesn't match your email domain")

    already = (
        sb.table("business_members")
        .select("user_id")
        .eq("business_id", body.business_id)
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    if already:
        raise HTTPException(status_code=409, detail="You're already a member of this workspace")

    sb.table("workspace_join_requests").upsert(
        {
            "business_id": body.business_id,
            "user_id": user["id"],
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "decided_by": None,
            "decided_at": None,
        },
        on_conflict="business_id,user_id",
    ).execute()
    return {"ok": True, "status": "pending"}


@router.get("/requests")
def list_requests(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Pending join requests for a workspace (owner/admin only)."""
    require_admin_or_owner(sb, business_id, user["id"])
    rows = (
        sb.table("workspace_join_requests")
        .select("id, status, created_at, requester:users!user_id(name, email)")
        .eq("business_id", business_id)
        .eq("status", "pending")
        .order("created_at")
        .execute()
        .data
    )
    out = []
    for r in rows:
        req = r.pop("requester", None) or {}
        out.append({
            "id": r["id"],
            "status": r["status"],
            "created_at": r["created_at"],
            "requester_name": req.get("name"),
            "requester_email": req.get("email"),
        })
    return out


def _decide(sb: Client, request_id: str, actor_id: str, approve: bool) -> dict:
    rows = (
        sb.table("workspace_join_requests")
        .select("id, business_id, user_id, status")
        .eq("id", request_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Request not found")
    jr = rows[0]
    require_admin_or_owner(sb, jr["business_id"], actor_id)
    if jr["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already {jr['status']}")

    now = datetime.now(timezone.utc).isoformat()
    if approve:
        sb.table("business_members").upsert(
            {
                "business_id": jr["business_id"],
                "user_id": jr["user_id"],
                "role": "member",
                "joined_at": now,
            },
            on_conflict="business_id,user_id",
        ).execute()
    sb.table("workspace_join_requests").update(
        {"status": "approved" if approve else "declined",
         "decided_by": actor_id, "decided_at": now}
    ).eq("id", request_id).execute()
    return {"ok": True, "status": "approved" if approve else "declined"}


@router.post("/requests/{request_id}/approve")
def approve_request(
    request_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    return _decide(sb, request_id, user["id"], approve=True)


@router.post("/requests/{request_id}/decline")
def decline_request(
    request_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    return _decide(sb, request_id, user["id"], approve=False)
