"""Shared FastAPI dependencies used across routers."""
from functools import lru_cache

from supabase import create_client, Client
from fastapi import Depends, HTTPException, status
from config import get_settings, Settings


@lru_cache(maxsize=1)
def _make_supabase_client(url: str, key: str) -> Client:
    """Cached Supabase client factory — one client per (url, key) pair."""
    return create_client(url, key)


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    """Return a cached Supabase service-role client.
    Override in tests via app.dependency_overrides[get_supabase].
    """
    return _make_supabase_client(settings.supabase_url, settings.supabase_service_key)


def require_member(sb: Client, business_id: str, user_id: str) -> None:
    """Raise HTTP 403 if user is not a member of the business."""
    result = (
        sb.table("business_members")
        .select("business_id")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this business",
        )


def require_admin_or_owner(sb: Client, business_id: str, user_id: str) -> str:
    """Raise HTTP 403 if user is not admin or owner. Returns the user's role."""
    result = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this business",
        )
    role = result.data[0]["role"]
    if role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin or owner access required",
        )
    return role


def get_member_role(sb: Client, business_id: str, user_id: str) -> str | None:
    """Return the user's role in the business, or None if not a member."""
    result = (
        sb.table("business_members")
        .select("role")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )
    return result.data[0]["role"] if result.data else None
