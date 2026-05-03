import csv
import io
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from supabase import Client

from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Tasks report
# ---------------------------------------------------------------------------

@router.get("/tasks")
def report_tasks(
    business_id: str,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    Per-stakeholder task breakdown for a business in the given date range.
    Returns: tasks_owned, tasks_completed, tasks_overdue, tasks_blocked,
             avg_completion_days per primary/secondary stakeholder.
    """
    require_member(sb, business_id, user["id"])

    today = date.today()

    # Fetch all tasks for the business with stakeholder info
    query = (
        sb.table("tasks")
        .select(
            "id, status, due_date, completed_at, created_at, "
            "primary_stakeholder_id, "
            "task_stakeholders(user_id, role), "
            "primary_stakeholder:users!primary_stakeholder_id(id, email)"
        )
        .eq("initiative_id.initiative.business_id", business_id)
    )

    # Fetch tasks linked to initiatives in this business
    initiatives = (
        sb.table("initiatives")
        .select("id")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    initiative_ids = [i["id"] for i in initiatives]

    if not initiative_ids:
        rows: List[dict] = []
    else:
        q = (
            sb.table("tasks")
            .select(
                "id, status, due_date, completed_at, created_at, primary_stakeholder_id, "
                "task_stakeholders(user_id, role)"
            )
            .in_("initiative_id", initiative_ids)
        )
        if start_date:
            q = q.gte("created_at", start_date.isoformat())
        if end_date:
            q = q.lte("created_at", end_date.isoformat())
        rows = q.execute().data

    # Aggregate per stakeholder
    from collections import defaultdict
    stats: dict = defaultdict(lambda: {
        "tasks_owned": 0,
        "tasks_completed": 0,
        "tasks_overdue": 0,
        "tasks_blocked": 0,
        "total_completion_days": 0.0,
        "completion_count": 0,
    })

    for task in rows:
        # Collect all stakeholder user_ids (primary + secondary)
        user_ids = set()
        if task.get("primary_stakeholder_id"):
            user_ids.add(task["primary_stakeholder_id"])
        for s in task.get("task_stakeholders") or []:
            user_ids.add(s["user_id"])

        task_due = None
        if task.get("due_date"):
            try:
                task_due = date.fromisoformat(task["due_date"][:10])
            except ValueError:
                pass

        is_done = task["status"] == "done"
        is_overdue = (not is_done) and task_due is not None and task_due < today
        is_blocked = task["status"] == "blocked"

        completion_days = None
        if is_done and task.get("completed_at") and task.get("created_at"):
            try:
                created = datetime.fromisoformat(task["created_at"].replace("Z", "+00:00"))
                completed = datetime.fromisoformat(task["completed_at"].replace("Z", "+00:00"))
                completion_days = (completed - created).days
            except ValueError:
                pass

        for uid in user_ids:
            s = stats[uid]
            s["tasks_owned"] += 1
            if is_done:
                s["tasks_completed"] += 1
            if is_overdue:
                s["tasks_overdue"] += 1
            if is_blocked:
                s["tasks_blocked"] += 1
            if completion_days is not None:
                s["total_completion_days"] += completion_days
                s["completion_count"] += 1

    # Resolve user emails
    all_user_ids = list(stats.keys())
    email_map: dict = {}
    if all_user_ids:
        user_rows = (
            sb.table("users")
            .select("id, email")
            .in_("id", all_user_ids)
            .execute()
            .data
        )
        email_map = {u["id"]: u["email"] for u in user_rows}

    result = []
    for uid, s in stats.items():
        avg_days = (
            round(s["total_completion_days"] / s["completion_count"], 1)
            if s["completion_count"] > 0
            else None
        )
        result.append({
            "user_id": uid,
            "user_email": email_map.get(uid),
            "tasks_owned": s["tasks_owned"],
            "tasks_completed": s["tasks_completed"],
            "tasks_overdue": s["tasks_overdue"],
            "tasks_blocked": s["tasks_blocked"],
            "avg_completion_days": avg_days,
        })

    if format == "csv":
        return _make_csv_response(
            result,
            ["user_id", "user_email", "tasks_owned", "tasks_completed", "tasks_overdue", "tasks_blocked", "avg_completion_days"],
            filename="tasks_report.csv",
        )
    return result


# ---------------------------------------------------------------------------
# Initiatives report
# ---------------------------------------------------------------------------

@router.get("/initiatives")
def report_initiatives(
    business_id: str,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    Per-initiative: total_tasks, done_tasks, completion_pct, overdue_count, blocked_count.
    """
    require_member(sb, business_id, user["id"])

    today = date.today()

    init_query = sb.table("initiatives").select("id, title, status").eq("business_id", business_id)
    if start_date:
        init_query = init_query.gte("created_at", start_date.isoformat())
    if end_date:
        init_query = init_query.lte("created_at", end_date.isoformat())

    initiatives = init_query.execute().data

    if not initiatives:
        if format == "csv":
            return _make_csv_response(
                [],
                ["initiative_id", "title", "total_tasks", "done_tasks", "completion_pct", "overdue_count", "blocked_count"],
                "initiatives_report.csv",
            )
        return []

    initiative_ids = [i["id"] for i in initiatives]
    tasks = (
        sb.table("tasks")
        .select("id, initiative_id, status, due_date")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    )

    from collections import defaultdict
    task_map: dict = defaultdict(list)
    for t in tasks:
        task_map[t["initiative_id"]].append(t)

    result = []
    for init in initiatives:
        iid = init["id"]
        t_list = task_map[iid]
        total = len(t_list)
        done = sum(1 for t in t_list if t["status"] == "done")
        overdue = 0
        blocked = sum(1 for t in t_list if t["status"] == "blocked")
        for t in t_list:
            if t["status"] != "done" and t.get("due_date"):
                try:
                    d = date.fromisoformat(t["due_date"][:10])
                    if d < today:
                        overdue += 1
                except ValueError:
                    pass
        pct = round(done / total * 100, 1) if total > 0 else 0.0
        result.append({
            "initiative_id": iid,
            "title": init.get("title"),
            "total_tasks": total,
            "done_tasks": done,
            "completion_pct": pct,
            "overdue_count": overdue,
            "blocked_count": blocked,
        })

    if format == "csv":
        return _make_csv_response(
            result,
            ["initiative_id", "title", "total_tasks", "done_tasks", "completion_pct", "overdue_count", "blocked_count"],
            "initiatives_report.csv",
        )
    return result


# ---------------------------------------------------------------------------
# Buildings report
# ---------------------------------------------------------------------------

@router.get("/buildings")
def report_buildings(
    business_id: str,
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """
    Per-building: total_tasks, done_tasks, overdue_count, entity code, city.
    """
    require_member(sb, business_id, user["id"])

    today = date.today()

    entities = (
        sb.table("entities")
        .select("id, code, city")
        .eq("business_id", business_id)
        .execute()
        .data
    )

    if not entities:
        if format == "csv":
            return _make_csv_response([], ["entity_id", "code", "city", "total_tasks", "done_tasks", "overdue_count"], "buildings_report.csv")
        return []

    entity_ids = [e["id"] for e in entities]

    # task_entities links tasks to buildings/entities
    task_entity_rows = (
        sb.table("task_entities")
        .select("task_id, entity_id, tasks(status, due_date)")
        .in_("entity_id", entity_ids)
        .execute()
        .data
    )

    from collections import defaultdict
    building_stats: dict = defaultdict(lambda: {"total_tasks": 0, "done_tasks": 0, "overdue_count": 0})

    for te in task_entity_rows:
        eid = te["entity_id"]
        task = te.get("tasks") or {}
        if isinstance(task, list):
            task = task[0] if task else {}

        task_status = task.get("status", "")
        due_str = task.get("due_date")

        building_stats[eid]["total_tasks"] += 1
        if task_status == "done":
            building_stats[eid]["done_tasks"] += 1
        elif due_str:
            try:
                if date.fromisoformat(due_str[:10]) < today:
                    building_stats[eid]["overdue_count"] += 1
            except ValueError:
                pass

    entity_map = {e["id"]: e for e in entities}
    result = []
    for eid, s in building_stats.items():
        e = entity_map.get(eid, {})
        result.append({
            "entity_id": eid,
            "code": e.get("code"),
            "city": e.get("city"),
            "total_tasks": s["total_tasks"],
            "done_tasks": s["done_tasks"],
            "overdue_count": s["overdue_count"],
        })

    if format == "csv":
        return _make_csv_response(
            result,
            ["entity_id", "code", "city", "total_tasks", "done_tasks", "overdue_count"],
            "buildings_report.csv",
        )
    return result


# ---------------------------------------------------------------------------
# CSV helper
# ---------------------------------------------------------------------------

def _make_csv_response(data: List[dict], fieldnames: List[str], filename: str) -> StreamingResponse:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in data:
        writer.writerow(row)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
