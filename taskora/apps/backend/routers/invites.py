import html as _html
import logging
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
        "invited_email": str(body.invited_email).lower(),
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
    # Route is /invite/[token] (singular) — must match or the link 404s.
    invite_url = f"{settings.frontend_url}/invite/{token}"

    # Best-effort: the invite row + URL are the critical output. A failure
    # looking up names or sending the email must not 500 the invite.
    try:
        biz = sb.table("businesses").select("name").eq("id", body.business_id).execute().data
        business_name = (biz[0]["name"] if biz else None) or "a Taskora workspace"
        inviter_rows = sb.table("users").select("name").eq("id", user["id"]).execute().data
        inviter_name = (inviter_rows[0].get("name") if inviter_rows else None) or "A teammate"
        _send_invite_email(body.invited_email, inviter_name, business_name, body.role, invite_url)
    except Exception:
        logging.getLogger(__name__).exception("invite email step failed (invite still created)")

    return {
        "id": invite["id"],
        "token": token,
        "invite_url": invite_url,
    }


def _send_invite_email(
    to: str, inviter_name: str, business_name: str, role: str, invite_url: str
) -> None:
    from email_send import send_email

    # inviter_name and business_name are user-controlled; escape before
    # interpolating into HTML or an attacker could inject markup into an
    # email Taskora sends on their behalf (phishing). subject/text are
    # plain text — no injection surface — so leave them raw.
    safe_inviter = _html.escape(inviter_name)
    safe_biz = _html.escape(business_name)
    safe_role = _html.escape(role)
    safe_url = _html.escape(invite_url, quote=True)

    subject = f"{inviter_name} invited you to {business_name} on Taskora"
    html = f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a2e">
  <h1 style="font-size:20px;margin:0 0 4px">You've been invited to Taskora</h1>
  <p style="color:#5a6072;font-size:14px;line-height:1.6;margin:16px 0">
    <strong>{safe_inviter}</strong> has invited you to join
    <strong>{safe_biz}</strong> as <strong>{safe_role}</strong>.
  </p>
  <a href="{safe_url}" style="display:inline-block;background:#e23744;color:#fff;
     text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;
     border-radius:8px;margin:12px 0">Accept invitation</a>
  <p style="color:#9aa0ad;font-size:12px;line-height:1.6;margin:20px 0 0">
    Or paste this link into your browser:<br>
    <a href="{safe_url}" style="color:#5a6072">{safe_url}</a>
  </p>
  <p style="color:#9aa0ad;font-size:12px;margin:24px 0 0">
    If you weren't expecting this, you can ignore this email.
  </p>
</div>"""
    text = (
        f"{inviter_name} invited you to join {business_name} on Taskora as {role}.\n\n"
        f"Accept: {invite_url}\n\nIf you weren't expecting this, ignore this email."
    )
    send_email(to=to, subject=subject, html=html, text=text)


@router.get("/pending-for-me")
def pending_invite_for_me(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Latest pending invite addressed to the current user's email, if any.

    Used to keep an invited user out of business-creating onboarding: if
    they have a pending invite, route them to accept it instead.
    """
    email = (user.get("email") or "").lower()
    if not email:
        return {"token": None}
    rows = (
        sb.table("workspace_invites")
        .select("token, business_id, created_at")
        .eq("invited_email", email)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return {"token": rows[0]["token"] if rows else None}


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
