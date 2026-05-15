import secrets
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel, EmailStr

from auth import get_current_user
from deps import get_supabase, require_member, require_admin_or_owner
from config import get_settings

router = APIRouter(prefix="/api/v1/invites", tags=["invites"])


class InviteCreate(BaseModel):
    business_id: str
    invited_email: EmailStr
    role: str = "member"


@router.post("/", status_code=201)
@router.post("", status_code=201, include_in_schema=False)
def create_invite(
    body: InviteCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    settings=Depends(get_settings),
):
    """Create a workspace invite and return the invite URL."""
    require_member(sb, body.business_id, user["id"])

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()

    row = {
        "business_id": body.business_id,
        "invited_email": body.invited_email,
        "role": body.role,
        "invited_by": user["id"],
        "token": token,
        "status": "pending",
        "created_at": now,
    }
    result = sb.table("workspace_invites").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create invite")

    invite = result.data[0]
    invite_url = f"{settings.frontend_url}/invites/{token}"
    return {
        "id": invite["id"],
        "token": token,
        "invite_url": invite_url,
    }


@router.get("/{token}")
def get_invite(
    token: str,
    sb: Client = Depends(get_supabase),
):
    """Get invite details — no auth required (public link preview)."""
    rows = (
        sb.table("workspace_invites")
        .select("*, businesses(name), inviter:users!invited_by(name)")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    invite = rows[0]

    business = invite.pop("businesses", None) or {}
    inviter = invite.pop("inviter", None) or {}

    return {
        **invite,
        "business_name": business.get("name"),
        "inviter_email": inviter.get("email") if isinstance(inviter, dict) else None,
    }


@router.post("/{token}/accept")
def accept_invite(
    token: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Authenticated user accepts an invite — creates business_members row."""
    rows = (
        sb.table("workspace_invites")
        .select("*, businesses(name)")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    invite = rows[0]

    if invite["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invite is already {invite['status']}",
        )

    business_id = invite["business_id"]
    invite_role = invite["role"]
    now = datetime.now(timezone.utc).isoformat()

    # Map invite role → business_members role
    # platform_owner/admin → 'owner'/'admin'; task-scoped roles → 'member'
    _ROLE_MAP = {
        "platform_owner": "owner",
        "admin": "admin",
        "primary": "member",
        "secondary": "member",
        "follower": "member",
        "member": "member",
    }
    biz_role = _ROLE_MAP.get(invite_role, "member")

    # Insert business_members (upsert to be idempotent)
    sb.table("business_members").upsert(
        {
            "business_id": business_id,
            "user_id": user["id"],
            "role": biz_role,
            "joined_at": now,
        },
        on_conflict="business_id,user_id",
    ).execute()

    # Mark invite accepted
    sb.table("workspace_invites").update({"status": "accepted"}).eq("token", token).execute()

    business = invite.get("businesses") or {}
    return {
        "business_id": business_id,
        "business_name": business.get("name"),
    }


@router.post("/{token}/decline")
def decline_invite(
    token: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Authenticated user declines an invite."""
    rows = sb.table("workspace_invites").select("id, status").eq("token", token).execute().data
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")

    if rows[0]["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invite is already {rows[0]['status']}",
        )

    sb.table("workspace_invites").update({"status": "declined"}).eq("token", token).execute()
    return {"ok": True}


@router.delete("/revoke/{invite_id}", status_code=204)
def revoke_invite(
    invite_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Revoke a pending invite. Caller must be admin or owner of the business."""
    rows = sb.table("workspace_invites").select("id, business_id, status").eq("id", invite_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Invite not found")

    invite = rows[0]
    if invite["status"] != "pending":
        raise HTTPException(status_code=409, detail=f"Invite is already {invite['status']}")

    require_admin_or_owner(sb, invite["business_id"], user["id"])

    sb.table("workspace_invites").update({"status": "revoked"}).eq("id", invite_id).execute()


@router.get("")
def list_invites(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Admin view: list all invites for a business."""
    require_member(sb, business_id, user["id"])

    invites = (
        sb.table("workspace_invites")
        .select("*, inviter:users!invited_by(name)")
        .eq("business_id", business_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    for invite in invites:
        inviter = invite.pop("inviter", None) or {}
        invite["inviter_email"] = inviter.get("name") if isinstance(inviter, dict) else None

    return invites
