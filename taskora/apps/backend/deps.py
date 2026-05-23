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


def people_board_access_ok(sb: Client, business_id: str, user_id: str) -> bool:
    """True if the user may see the People board for this business: owner/admin
    always, or a member explicitly granted via can_view_people_board."""
    result = (
        sb.table("business_members")
        .select("role, can_view_people_board")
        .eq("business_id", business_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        return False
    row = result.data[0]
    return row.get("role") in ("owner", "admin") or bool(row.get("can_view_people_board"))


def require_people_board_access(sb: Client, business_id: str, user_id: str) -> None:
    """Raise HTTP 403 unless the user may see the People board for this business."""
    if not people_board_access_ok(sb, business_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="People board access required",
        )


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


def is_admin_or_owner(sb: Client, business_id: str, user_id: str) -> bool:
    """True iff the user is workspace owner or admin. Non-raising variant of
    require_admin_or_owner — used by visibility scoping helpers."""
    return get_member_role(sb, business_id, user_id) in ("owner", "admin")


def writable_initiative_ids(sb: Client, business_id: str, user_id: str) -> set[str]:
    """Initiative_ids where the user has WRITE access (e.g. create tasks).

    Sources: initiative primary_stakeholder, task_stakeholders, or task creator.
    Deliberately excludes initiative_followers — followers are read-only.
    Admins should not call this; check is_admin_or_owner() first.
    """
    primary_rows = (
        sb.table("initiatives")
        .select("id")
        .eq("business_id", business_id)
        .eq("primary_stakeholder_id", user_id)
        .execute()
        .data
    )
    aligned: set[str] = {r["id"] for r in primary_rows}

    biz_init_ids = [
        r["id"] for r in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]
    if not biz_init_ids:
        return aligned

    stake_tasks = (
        sb.table("task_stakeholders")
        .select("task_id")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    created_tasks = (
        sb.table("tasks")
        .select("id")
        .eq("created_by", user_id)
        .in_("initiative_id", biz_init_ids)
        .execute()
        .data
    )
    task_ids = {r["task_id"] for r in stake_tasks} | {r["id"] for r in created_tasks}
    if task_ids:
        task_init_rows = (
            sb.table("tasks")
            .select("initiative_id")
            .in_("id", list(task_ids))
            .in_("initiative_id", biz_init_ids)
            .execute()
            .data
        )
        for r in task_init_rows:
            if r.get("initiative_id"):
                aligned.add(r["initiative_id"])
    return aligned


def follower_initiative_ids(sb: Client, business_id: str, user_id: str) -> set[str]:
    """Initiatives in this business where the user is an explicit follower.
    Read-only access — followers see the whole initiative tree but cannot
    create or edit anything."""
    follower_rows = (
        sb.table("initiative_followers")
        .select("initiative_id")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not follower_rows:
        return set()
    followed_ids = [r["initiative_id"] for r in follower_rows]
    biz_rows = (
        sb.table("initiatives")
        .select("id")
        .eq("business_id", business_id)
        .in_("id", followed_ids)
        .execute()
        .data
    )
    return {r["id"] for r in biz_rows}


def aligned_initiative_ids(sb: Client, business_id: str, user_id: str) -> set[str]:
    """Initiative_ids the user can READ. Union of writable_initiative_ids and
    follower_initiative_ids. Used to scope /programs and /initiatives endpoints
    for non-admin members. Admins should not call this — check
    is_admin_or_owner() first and skip scoping when true.

    Sources:
      - they are the initiative's primary_stakeholder_id
      - they have a task_stakeholders row on a task within the initiative
      - they created (created_by) a task within the initiative
      - they are an explicit follower (initiative_followers)
    """
    return writable_initiative_ids(sb, business_id, user_id) | follower_initiative_ids(sb, business_id, user_id)


def visible_initiative_ids(sb: Client, business_id: str, user_id: str) -> set[str]:
    """Initiative_ids the user has full READ visibility into — wider than
    aligned_initiative_ids: also includes initiatives whose tasks contain a
    watcher (item_watchers) entry for the user. This implements the
    "visibility cascade": involvement on any node in an initiative tree —
    initiative primary, task primary/stakeholder/creator, explicit initiative
    follower, OR watcher on a task/subtask/entity within it — grants read of
    the whole initiative.

    Used by /tasks/my and the task/subtask read gates so a primary user (or
    a follower-by-watcher anywhere below) sees every sibling task and
    subtask under the same initiative, regardless of per-node assignment.
    Admins should not call this — check is_admin_or_owner() first.
    """
    base = aligned_initiative_ids(sb, business_id, user_id)

    watcher_task_ids = [
        r["task_id"]
        for r in sb.table("item_watchers")
        .select("task_id")
        .eq("user_id", user_id)
        .execute()
        .data
        if r.get("task_id")
    ]
    if not watcher_task_ids:
        return base

    biz_init_ids = [
        r["id"]
        for r in sb.table("initiatives")
        .select("id")
        .eq("business_id", business_id)
        .execute()
        .data
    ]
    if not biz_init_ids:
        return base

    task_init_rows = (
        sb.table("tasks")
        .select("initiative_id")
        .in_("id", watcher_task_ids)
        .in_("initiative_id", biz_init_ids)
        .execute()
        .data
    )
    for r in task_init_rows:
        if r.get("initiative_id"):
            base.add(r["initiative_id"])
    return base
