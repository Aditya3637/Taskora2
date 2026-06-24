"""In-app notification feed (the bell).

Reads recipient-scoped rows from `messages` where channel='inapp' (written by
automation.notify.notify). Scoping is app-layer because the app runs on the
service-role key: every query filters user_id = caller AND business membership.

  opened_at  → set when the drawer is opened ('seen'); clears the badge.
  clicked_at → set when a row is opened ('read' / navigated).
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("")
def list_notifications(
    business_id: str,
    limit: int = 30,
    unread_only: bool = False,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    q = (
        sb.table("messages")
        .select("id, ts, template, meta, opened_at, clicked_at")
        .eq("channel", "inapp")
        .eq("user_id", user["id"])
        .eq("business_id", business_id)
    )
    if unread_only:
        q = q.is_("opened_at", "null")
    items = q.order("ts", desc=True).limit(min(max(limit, 1), 100)).execute().data

    unread = (
        sb.table("messages")
        .select("id", count="exact")
        .eq("channel", "inapp")
        .eq("user_id", user["id"])
        .eq("business_id", business_id)
        .is_("opened_at", "null")
        .execute()
    )
    return {"items": items, "unread_count": unread.count or 0}


@router.post("/seen", status_code=204)
def mark_all_seen(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Clear the badge: stamp opened_at on every unseen in-app row."""
    require_member(sb, business_id, user["id"])
    (
        sb.table("messages")
        .update({"opened_at": _now()})
        .eq("channel", "inapp")
        .eq("user_id", user["id"])
        .eq("business_id", business_id)
        .is_("opened_at", "null")
        .execute()
    )


@router.post("/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Mark one row read/navigated. Scoped to the caller's own rows."""
    now = _now()
    result = (
        sb.table("messages")
        .update({"clicked_at": now, "opened_at": now})
        .eq("id", notification_id)
        .eq("user_id", user["id"])
        .eq("channel", "inapp")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/read-all", status_code=204)
def mark_all_read(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])
    now = _now()
    (
        sb.table("messages")
        .update({"clicked_at": now, "opened_at": now})
        .eq("channel", "inapp")
        .eq("user_id", user["id"])
        .eq("business_id", business_id)
        .is_("clicked_at", "null")
        .execute()
    )


class NotifyPrefs(BaseModel):
    prefs: dict


@router.get("/settings")
def get_notification_settings(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Per-user routing matrix, stored in users.settings.notify_prefs."""
    rows = sb.table("users").select("settings").eq("id", user["id"]).execute().data
    settings = (rows[0].get("settings") or {}) if rows else {}
    return settings.get("notify_prefs") or {}


@router.put("/settings")
def put_notification_settings(
    body: NotifyPrefs,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("users").select("settings").eq("id", user["id"]).execute().data
    settings = (rows[0].get("settings") or {}) if rows else {}
    settings["notify_prefs"] = body.prefs
    sb.table("users").update({"settings": settings}).eq("id", user["id"]).execute()
    return body.prefs
