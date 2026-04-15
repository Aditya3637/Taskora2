from datetime import date, timedelta
from typing import List

from fastapi import APIRouter, Depends
from supabase import Client
from auth import get_current_user
from deps import get_supabase

router = APIRouter(prefix="/api/v1/daily-brief", tags=["daily_brief"])


@router.get("/")
def get_daily_brief(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    today = date.today()
    today_str = today.isoformat()
    week_out = (today + timedelta(days=7)).isoformat()
    stale_threshold = (today - timedelta(days=7)).isoformat()

    decisions_pending = (
        sb.table("tasks")
        .select("*, task_entities(*)")
        .eq("primary_stakeholder_id", uid)
        .eq("status", "pending_decision")
        .order("created_at")
        .execute()
        .data
    )

    secondary_task_ids: List[str] = [
        r["task_id"]
        for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
    ]

    def _tasks_in(filters_fn, ids: List[str]):
        if not ids:
            return []
        q = sb.table("tasks").select("*, task_entities(*)")
        q = filters_fn(q)
        return q.in_("id", ids).execute().data

    overdue = _tasks_in(
        lambda q: q.lt("due_date", today_str).neq("status", "done").neq("status", "archived"),
        secondary_task_ids,
    )
    stale = _tasks_in(
        lambda q: q.lt("updated_at", stale_threshold).neq("status", "done").neq("status", "archived"),
        secondary_task_ids,
    )
    due_this_week = _tasks_in(
        lambda q: q.gte("due_date", today_str).lte("due_date", week_out),
        secondary_task_ids,
    )
    blocked = _tasks_in(
        lambda q: q.eq("status", "blocked"),
        secondary_task_ids,
    )

    return {
        "user_id": uid,
        "generated_at": today_str,
        "decisions_pending": decisions_pending,
        "overdue": overdue,
        "stale": stale,
        "due_this_week": due_this_week,
        "blocked": blocked,
    }
