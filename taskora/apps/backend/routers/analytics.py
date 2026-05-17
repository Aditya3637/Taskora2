import csv
import io
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from supabase import Client
from auth import get_current_user
from deps import get_supabase, require_member

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _resolve_entity_names_dict(sb: Client, entity_progress: dict) -> list:
    """Convert {eid: {total, done, blocked}} dict → list with names + completion_pct."""
    eids = list(entity_progress.keys())
    if not eids:
        return []
    name_map = {}
    # Try buildings first, then clients
    b_rows = sb.table("buildings").select("id, name").in_("id", eids).execute().data or []
    for r in b_rows: name_map[r["id"]] = r["name"]
    remaining = [e for e in eids if e not in name_map]
    if remaining:
        c_rows = sb.table("clients").select("id, name").in_("id", remaining).execute().data or []
        for r in c_rows: name_map[r["id"]] = r["name"]
    result = []
    for eid, stats in entity_progress.items():
        total = stats.get("total", 0)
        done  = stats.get("done", 0)
        result.append({
            "entity_id": eid,
            "entity_name": name_map.get(eid, eid),
            "total": total,
            "done": done,
            "blocked": stats.get("blocked", 0),
            "completion_pct": round(done / total * 100) if total else 0,
        })
    return result


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

    tat_hours: List[float] = []
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
        .select("created_at, action")
        .eq("user_id", uid)
        .gte("created_at", since)
        .execute()
        .data
    )
    delegation_count = sum(1 for d in decisions if d.get("action") == "delegate")

    today = datetime.now(timezone.utc).date().isoformat()
    overdue = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .lt("due_date", today)
        .neq("status", "done")
        .execute()
        .count or 0
    )
    stale_threshold = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    stale = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .lt("updated_at", stale_threshold)
        .neq("status", "done")
        .neq("status", "archived")
        .execute()
        .count or 0
    )
    blocked = (
        sb.table("tasks")
        .select("id", count="exact")
        .eq("primary_stakeholder_id", uid)
        .eq("status", "blocked")
        .execute()
        .count or 0
    )

    return {
        "avg_tat_hours": avg_tat,
        "tasks_completed": len(done_tasks),
        "decisions_made": len(decisions),
        "delegation_count": delegation_count,
        "overdue_count": overdue,
        "stale_count": stale,
        "blocked_count": blocked,
        "timeframe_days": days,
    }


@router.get("/initiative/{initiative_id}")
def initiative_analytics(
    initiative_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    init_row = sb.table("initiatives").select("business_id").eq("id", initiative_id).execute().data
    if not init_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Initiative not found")
    require_member(sb, init_row[0]["business_id"], user["id"])

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

    entity_progress: dict = {}
    for t in tasks:
        for e in t.get("task_entities") or []:
            eid = e.get("entity_id", "")
            if eid not in entity_progress:
                entity_progress[eid] = {"total": 0, "done": 0, "blocked": 0}
            entity_progress[eid]["total"] += 1
            if e.get("per_entity_status") == "done":
                entity_progress[eid]["done"] += 1
            if e.get("per_entity_status") == "blocked":
                entity_progress[eid]["blocked"] += 1

    return {
        "total_tasks": total,
        "completed_count": done,
        "blocked": blocked,
        "completion_pct": round(done / total * 100) if total else 0,
        "entity_progress": _resolve_entity_names_dict(sb, entity_progress),
    }


@router.get("/business/{business_id}")
def business_analytics(
    business_id: str,
    days: int = Query(30, ge=1, le=365),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    require_member(sb, business_id, user["id"])

    initiative_ids = [
        i["id"]
        for i in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]

    all_tasks = (
        sb.table("tasks")
        .select("id, status, task_entities(*)")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    ) if initiative_ids else []

    total_tasks        = len(all_tasks)
    completed_count    = sum(1 for t in all_tasks if t.get("status") == "done")
    stale_threshold    = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    stale_count        = sum(1 for t in all_tasks if t.get("status") not in ("done","archived") and (t.get("updated_at") or "") < stale_threshold)
    blocked_count      = sum(1 for t in all_tasks if t.get("status") == "blocked")
    pending_decision_count = sum(1 for t in all_tasks if t.get("status") == "pending_decision")

    # Entity progress
    entity_progress: dict = {}
    for t in all_tasks:
        for e in t.get("task_entities") or []:
            eid = e.get("entity_id", "")
            if eid not in entity_progress:
                entity_progress[eid] = {"total": 0, "done": 0, "blocked": 0}
            entity_progress[eid]["total"] += 1
            if e.get("per_entity_status") == "done":
                entity_progress[eid]["done"] += 1
            if e.get("per_entity_status") == "blocked":
                entity_progress[eid]["blocked"] += 1

    return {
        "total_tasks": total_tasks,
        "completed_count": completed_count,
        "stale_count": stale_count,
        "blocked_count": blocked_count,
        "pending_decision_count": pending_decision_count,
        "entity_progress": _resolve_entity_names_dict(sb, entity_progress),
    }


# ===========================================================================
# Reporting (tabular, date-filterable, CSV-exportable) — rebuilt under
# Analytics after the old standalone Reports section was removed. Correctness
# notes vs the old impl:
#   * completion is measured by tasks.closed_at (set when status -> done by
#     migration 020); the old code read a non-existent tasks.completed_at.
#   * the date range filters *completion* (closed_at), not created_at, so a
#     report for May reflects work finished in May, not work opened in May.
#   * tasks_owned / overdue / blocked are current-state snapshots and are
#     intentionally NOT date-filtered.
# ===========================================================================

_OPEN_STATUSES_EXCLUDED_FROM_OVERDUE = ("done", "archived")


def _make_csv_response(rows: List[dict], fieldnames: List[str], filename: str) -> StreamingResponse:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _closed_in_range(closed_at: Optional[str], start: Optional[date], end: Optional[date]) -> bool:
    """True if closed_at (an ISO timestamp string) falls within [start, end].
    A missing range bound is treated as open-ended; a missing closed_at is
    never 'in range' (it isn't completed)."""
    if not closed_at:
        return False
    try:
        d = datetime.fromisoformat(closed_at.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return False
    if start and d < start:
        return False
    if end and d > end:
        return False
    return True


def _business_initiative_ids(sb: Client, business_id: str) -> List[str]:
    return [
        i["id"]
        for i in sb.table("initiatives").select("id").eq("business_id", business_id).execute().data
    ]


@router.get("/reports/people")
def report_people(
    business_id: str,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Per-stakeholder breakdown (primary + secondary) for a business.

    Columns: tasks_owned, tasks_completed (closed within range), tasks_overdue,
    tasks_blocked, avg_tat_days (created_at -> closed_at, completed only).
    """
    require_member(sb, business_id, user["id"])
    today = date.today()

    initiative_ids = _business_initiative_ids(sb, business_id)
    tasks = (
        sb.table("tasks")
        .select("id, status, due_date, closed_at, created_at, primary_stakeholder_id")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    ) if initiative_ids else []

    task_ids = [t["id"] for t in tasks]
    extra_stk = (
        sb.table("task_stakeholders")
        .select("task_id, user_id, role")
        .in_("task_id", task_ids)
        .execute()
        .data
    ) if task_ids else []

    owners_by_task: dict = defaultdict(set)
    for t in tasks:
        if t.get("primary_stakeholder_id"):
            owners_by_task[t["id"]].add(t["primary_stakeholder_id"])
    for s in extra_stk:
        if s.get("user_id"):
            owners_by_task[s["task_id"]].add(s["user_id"])

    stats: dict = defaultdict(lambda: {
        "tasks_owned": 0, "tasks_completed": 0, "tasks_overdue": 0,
        "tasks_blocked": 0, "_tat_total_days": 0.0, "_tat_n": 0,
    })

    for t in tasks:
        uids = owners_by_task.get(t["id"], set())
        if not uids:
            continue
        is_done = t.get("status") == "done"
        completed_in_range = is_done and _closed_in_range(t.get("closed_at"), start_date, end_date)
        is_overdue = (
            t.get("status") not in _OPEN_STATUSES_EXCLUDED_FROM_OVERDUE
            and bool(t.get("due_date"))
            and str(t["due_date"])[:10] < today.isoformat()
        )
        is_blocked = t.get("status") == "blocked"

        tat_days = None
        if completed_in_range and t.get("created_at") and t.get("closed_at"):
            try:
                c = datetime.fromisoformat(t["created_at"].replace("Z", "+00:00"))
                z = datetime.fromisoformat(t["closed_at"].replace("Z", "+00:00"))
                tat_days = (z - c).total_seconds() / 86400.0
            except (ValueError, TypeError):
                tat_days = None

        for uid in uids:
            s = stats[uid]
            s["tasks_owned"] += 1
            if completed_in_range:
                s["tasks_completed"] += 1
            if is_overdue:
                s["tasks_overdue"] += 1
            if is_blocked:
                s["tasks_blocked"] += 1
            if tat_days is not None:
                s["_tat_total_days"] += tat_days
                s["_tat_n"] += 1

    name_map: dict = {}
    uids = list(stats.keys())
    if uids:
        for u in sb.table("users").select("id, name, email").in_("id", uids).execute().data:
            name_map[u["id"]] = u.get("name") or u.get("email") or u["id"]

    result = []
    for uid, s in stats.items():
        result.append({
            "user_id": uid,
            "user_name": name_map.get(uid, uid),
            "tasks_owned": s["tasks_owned"],
            "tasks_completed": s["tasks_completed"],
            "tasks_overdue": s["tasks_overdue"],
            "tasks_blocked": s["tasks_blocked"],
            "avg_tat_days": round(s["_tat_total_days"] / s["_tat_n"], 1) if s["_tat_n"] else None,
        })
    result.sort(key=lambda r: (-r["tasks_owned"], r["user_name"]))

    if format == "csv":
        return _make_csv_response(
            result,
            ["user_id", "user_name", "tasks_owned", "tasks_completed",
             "tasks_overdue", "tasks_blocked", "avg_tat_days"],
            "people_report.csv",
        )
    return {"rows": result, "timeframe": {"start": start_date, "end": end_date}}


@router.get("/reports/programs")
def report_programs(
    business_id: str,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Initiatives grouped under their program, with per-initiative and
    rolled-up program task health. Initiatives with no program land in an
    'Unassigned' bucket. done_tasks counts tasks closed within the range."""
    require_member(sb, business_id, user["id"])
    today = date.today()

    programs = (
        sb.table("programs")
        .select("id, name, status")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, program_id")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    init_ids = [i["id"] for i in initiatives]
    tasks = (
        sb.table("tasks")
        .select("id, status, due_date, closed_at, initiative_id")
        .in_("initiative_id", init_ids)
        .execute()
        .data
    ) if init_ids else []

    per_init: dict = defaultdict(lambda: {
        "total_tasks": 0, "done_tasks": 0, "overdue_count": 0, "blocked_count": 0,
    })
    for t in tasks:
        iid = t.get("initiative_id")
        if not iid:
            continue
        agg = per_init[iid]
        agg["total_tasks"] += 1
        if t.get("status") == "done" and _closed_in_range(t.get("closed_at"), start_date, end_date):
            agg["done_tasks"] += 1
        if (
            t.get("status") not in _OPEN_STATUSES_EXCLUDED_FROM_OVERDUE
            and bool(t.get("due_date"))
            and str(t["due_date"])[:10] < today.isoformat()
        ):
            agg["overdue_count"] += 1
        if t.get("status") == "blocked":
            agg["blocked_count"] += 1

    def _pct(done: int, total: int) -> int:
        return round(done / total * 100) if total else 0

    init_by_program: dict = defaultdict(list)
    for i in initiatives:
        a = per_init[i["id"]]
        init_by_program[i.get("program_id")].append({
            "initiative_id": i["id"],
            "initiative_name": i["name"],
            "status": i.get("status"),
            "total_tasks": a["total_tasks"],
            "done_tasks": a["done_tasks"],
            "completion_pct": _pct(a["done_tasks"], a["total_tasks"]),
            "overdue_count": a["overdue_count"],
            "blocked_count": a["blocked_count"],
        })

    program_blocks = []
    ordered = [(p["id"], p["name"], p.get("status")) for p in programs]
    if None in init_by_program:
        ordered.append((None, "Unassigned", None))
    for pid, pname, pstatus in ordered:
        inits = sorted(init_by_program.get(pid, []), key=lambda r: r["initiative_name"])
        tot = sum(x["total_tasks"] for x in inits)
        dn = sum(x["done_tasks"] for x in inits)
        program_blocks.append({
            "program_id": pid,
            "program_name": pname,
            "status": pstatus,
            "total_tasks": tot,
            "done_tasks": dn,
            "completion_pct": _pct(dn, tot),
            "overdue_count": sum(x["overdue_count"] for x in inits),
            "blocked_count": sum(x["blocked_count"] for x in inits),
            "initiatives": inits,
        })

    if format == "csv":
        flat = []
        for pb in program_blocks:
            for it in pb["initiatives"]:
                flat.append({
                    "program": pb["program_name"],
                    "initiative": it["initiative_name"],
                    "initiative_status": it["status"],
                    "total_tasks": it["total_tasks"],
                    "done_tasks": it["done_tasks"],
                    "completion_pct": it["completion_pct"],
                    "overdue_count": it["overdue_count"],
                    "blocked_count": it["blocked_count"],
                })
        return _make_csv_response(
            flat,
            ["program", "initiative", "initiative_status", "total_tasks",
             "done_tasks", "completion_pct", "overdue_count", "blocked_count"],
            "programs_report.csv",
        )
    return {"programs": program_blocks, "timeframe": {"start": start_date, "end": end_date}}
