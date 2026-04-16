from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.get("/my-performance")
def my_performance(
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    done_tasks = (
        sb.table("tasks")
        .select("created_at, updated_at")
        .eq("primary_stakeholder_id", uid)
        .eq("status", "done")
        .gte("updated_at", since)
        .execute()
        .data
    )

    tat_hours: list[float] = []
    for t in done_tasks:
        try:
            created = datetime.fromisoformat(t["created_at"])
            updated = datetime.fromisoformat(t["updated_at"])
            tat_hours.append((updated - created).total_seconds() / 3600)
        except (KeyError, ValueError, TypeError):
            pass

    avg_tat = round(sum(tat_hours) / len(tat_hours), 1) if tat_hours else 0.0

    decisions = (
        sb.table("decision_log")
        .select("created_at")
        .eq("user_id", uid)
        .gte("created_at", since)
        .execute()
        .data
    )

    overdue = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .lt("due_date", datetime.now(timezone.utc).date().isoformat())
        .neq("status", "done")
        .execute()
        .count or 0
    )

    return {
        "avg_tat_hours": avg_tat,
        "tasks_completed": len(done_tasks),
        "decisions_made": len(decisions),
        "overdue_count": overdue,
        "timeframe_days": days,
    }


@router.get("/initiative/{initiative_id}")
def initiative_analytics(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    tasks = (
        sb.table("tasks")
        .select("*, task_entities(*)")
        .eq("initiative_id", initiative_id)
        .execute()
        .data
    )

    total = len(tasks)
    done = sum(1 for t in tasks if t.get("status") == "done")
    blocked = sum(1 for t in tasks if t.get("status") == "blocked")

    entity_progress: dict[str, dict] = {}
    for t in tasks:
        for e in t.get("task_entities") or []:
            eid = e.get("entity_id", "")
            if eid not in entity_progress:
                entity_progress[eid] = {"total": 0, "done": 0}
            entity_progress[eid]["total"] += 1
            if e.get("per_entity_status") == "done":
                entity_progress[eid]["done"] += 1

    return {
        "total_tasks": total,
        "done": done,
        "blocked": blocked,
        "completion_pct": round(done / total * 100) if total else 0,
        "entity_progress": entity_progress,
    }


@router.get("/business/{business_id}")
def business_analytics(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])

    initiatives = (
        sb.table("initiatives")
        .select("id, status")
        .eq("business_id", business_id)
        .execute()
        .data
    )

    active_inits = sum(1 for i in initiatives if i.get("status") == "active")
    completed_inits = sum(1 for i in initiatives if i.get("status") == "completed")

    initiative_ids = [i["id"] for i in initiatives]
    all_tasks = (
        sb.table("tasks")
        .select("id, status")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    ) if initiative_ids else []

    total_tasks = len(all_tasks)
    done_tasks = sum(1 for t in all_tasks if t.get("status") == "done")

    return {
        "active_initiatives": active_inits,
        "completed_initiatives": completed_inits,
        "total_tasks": total_tasks,
        "done_tasks": done_tasks,
        "completion_pct": round(done_tasks / total_tasks * 100) if total_tasks else 0,
    }
