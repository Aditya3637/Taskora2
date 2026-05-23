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

    # Members can invite, but only as 'member'. Promoting requires admin/owner
    # so a member can't escalate by inviting a confederate as admin.
    if body.role == "admin":
        caller = (
            sb.table("business_members")
            .select("role")
            .eq("business_id", body.business_id)
            .eq("user_id", user["id"])
            .execute()
            .data
        )
        caller_role = caller[0]["role"] if caller else None
        if caller_role not in ("owner", "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only admins can invite admins",
            )

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
    preheader = (
        f"{inviter_name} added you to {business_name} on Taskora. "
        f"Tap to join and start collaborating."
    )
    safe_preheader = _html.escape(preheader)
    html = _render_marketing_email(
        preheader=safe_preheader,
        hero_eyebrow="You're invited",
        hero_title=f"Join <strong>{safe_biz}</strong>",
        intro_html=(
            f"<strong>{safe_inviter}</strong> has invited you to collaborate on "
            f"Taskora as <strong>{safe_role}</strong>. One place to track tasks, "
            f"approvals, and what your team is shipping."
        ),
        bullets=[
            ("\U0001F4CB", "Track tasks across initiatives and programs"),
            ("✅", "Approve work in one click — no email chains"),
            ("⏰", "See what's overdue at a glance"),
        ],
        cta_label="Join your team now",
        cta_url=safe_url,
        fallback_url=safe_url,
    )
    text = (
        f"{inviter_name} invited you to join {business_name} on Taskora as {role}.\n\n"
        f"What you can do in Taskora:\n"
        f"  - Track tasks across initiatives and programs\n"
        f"  - Approve work in one click\n"
        f"  - See what's overdue at a glance\n\n"
        f"Join: {invite_url}\n\n"
        f"If you weren't expecting this, ignore this email — nothing happens."
    )
    send_email(to=to, subject=subject, html=html, text=text)


# Brand: midnight #1A1A2E (hero), ocean #0F3460 (CTA), steel #6B7280 (body),
# mist #F3F4F6 (page bg), pebble #E5E7EB (rules). Layout is table-based and
# inline-styled for Outlook/Gmail compatibility; max 600px is the email-client
# safe width. Reused for non-invite Taskora emails — keep it generic.
def _render_marketing_email(
    *,
    preheader: str,
    hero_eyebrow: str,
    hero_title: str,
    intro_html: str,
    bullets: list[tuple[str, str]],
    cta_label: str,
    cta_url: str,
    fallback_url: str,
) -> str:
    bullets_html = "".join(
        f"""
          <tr>
            <td style="padding:6px 0;vertical-align:top;font-size:16px;line-height:1.5;width:28px">{icon}</td>
            <td style="padding:6px 0;color:#1A1A2E;font-size:15px;line-height:1.6">{_html.escape(text)}</td>
          </tr>"""
        for icon, text in bullets
    )
    return f"""\
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Taskora</title>
  </head>
  <body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A2E">
    <!-- Preheader: shown in inbox preview, hidden in body -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all">
      {preheader}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F4F6">
      <tr>
        <td align="center" style="padding:32px 16px">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04),0 4px 12px rgba(16,24,40,0.06)">
            <!-- HERO -->
            <tr>
              <td style="background:#1A1A2E;background-image:linear-gradient(135deg,#1A1A2E 0%,#0F3460 100%);padding:40px 32px 36px;color:#FFFFFF">
                <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;color:#9CA3AF">Taskora</div>
                <div style="font-size:12px;color:#C7D2FE;margin-top:18px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600">{_html.escape(hero_eyebrow)}</div>
                <h1 style="margin:8px 0 0;font-size:30px;line-height:1.2;font-weight:700">{hero_title}</h1>
              </td>
            </tr>
            <!-- BODY -->
            <tr>
              <td style="padding:32px">
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1A1A2E">{intro_html}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:#F3F4F6;border-radius:12px;padding:8px 16px">
                  <tr><td style="padding:8px 8px 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;color:#6B7280">With Taskora you can</td></tr>
                  <tr><td style="padding:0 8px 8px">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{bullets_html}
                    </table>
                  </td></tr>
                </table>
                <!-- CTA: table-wrapped "bulletproof" button -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
                  <tr>
                    <td align="center" bgcolor="#0F3460" style="border-radius:10px">
                      <a href="{cta_url}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;background:#0F3460">{_html.escape(cta_label)} →</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#6B7280">
                  Or paste this link into your browser:<br>
                  <a href="{fallback_url}" style="color:#0F3460;text-decoration:none;word-break:break-all">{fallback_url}</a>
                </p>
              </td>
            </tr>
            <!-- FOOTER -->
            <tr>
              <td style="border-top:1px solid #E5E7EB;padding:20px 32px;text-align:center;color:#6B7280;font-size:11px;line-height:1.6">
                <div style="font-weight:600;color:#1A1A2E;letter-spacing:0.5px">TASKORA · Work that ships.</div>
                <div style="margin-top:4px">If you weren't expecting this email, you can safely ignore it.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""


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

    # Reject expired invites — the FE only checks `status` so without this
    # an invite created long ago could still be claimed.
    expires_at = invite.get("expires_at")
    if expires_at:
        # Postgres timestamptz may serialise with a trailing 'Z' which
        # fromisoformat() didn't accept until 3.11; normalise.
        norm = expires_at.replace("Z", "+00:00") if isinstance(expires_at, str) else expires_at
        try:
            exp_dt = datetime.fromisoformat(norm) if isinstance(norm, str) else norm
        except ValueError:
            exp_dt = None
        if exp_dt is not None and exp_dt < datetime.now(timezone.utc):
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invitation has expired. Ask the admin to send a new one.",
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

    # Belt-and-suspenders: ensure the caller has a public.users row before
    # the business_members upsert. Migration 030 added a trigger that mirrors
    # new auth.users into public.users, but historic auth.users rows (or
    # any future signup that races the trigger) could still be missing.
    # Without this, business_members would 500 on an FK violation and the
    # "Accept Invitation" button silently no-ops in the UI. Only INSERT if
    # missing — never overwrite an existing display name.
    existing_user = sb.table("users").select("id").eq("id", user["id"]).execute().data
    if not existing_user:
        name_from_meta = (user.get("user_metadata") or {}).get("name")
        fallback_name = (user.get("email") or "").split("@")[0] or "User"
        sb.table("users").insert({
            "id": user["id"],
            "name": name_from_meta or fallback_name,
            "email": user.get("email"),
        }).execute()

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
