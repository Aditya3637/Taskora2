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
    today = date.today()
    since_date = today - timedelta(days=days)
    since_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    stale_cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # Tasks the user owns: primary stakeholder OR a secondary/follower
    # stakeholder (the old code only counted primary — bug #4).
    primary = (
        sb.table("tasks")
        .select("id, status, created_at, closed_at, due_date, updated_at")
        .eq("primary_stakeholder_id", uid)
        .execute()
        .data
    )
    stk_ids = [
        s["task_id"]
        for s in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
    ]
    by_id = {t["id"]: t for t in primary}
    missing = [sid for sid in stk_ids if sid not in by_id]
    if missing:
        for t in (
            sb.table("tasks")
            .select("id, status, created_at, closed_at, due_date, updated_at")
            .in_("id", missing)
            .execute()
            .data
        ):
            by_id[t["id"]] = t
    tasks = list(by_id.values())

    # Subtasks assigned to the user (subtasks have closed_at but no due_date).
    subtasks = (
        sb.table("subtasks")
        .select("id, status, created_at, closed_at, updated_at")
        .eq("assignee_id", uid)
        .execute()
        .data
    )

    tasks_completed = 0
    tat_days_total, tat_n = 0.0, 0
    overdue = stale = blocked = 0

    for t in tasks:
        cd = _closed_date(t.get("closed_at"))
        if t.get("status") == "done" and cd and cd >= since_date:
            tasks_completed += 1
            td = _tat_days(t.get("created_at"), t.get("closed_at"))
            if td is not None:
                tat_days_total += td
                tat_n += 1
        if _is_overdue(t.get("status"), t.get("due_date"), today):
            overdue += 1
        if t.get("status") not in ("done", "archived") and (t.get("updated_at") or "") < stale_cutoff:
            stale += 1
        if t.get("status") == "blocked":
            blocked += 1

    for s in subtasks:
        cd = _closed_date(s.get("closed_at"))
        if s.get("status") == "done" and cd and cd >= since_date:
            tasks_completed += 1
            td = _tat_days(s.get("created_at"), s.get("closed_at"))
            if td is not None:
                tat_days_total += td
                tat_n += 1
        if s.get("status") not in ("done", "archived") and (s.get("updated_at") or "") < stale_cutoff:
            stale += 1
        if s.get("status") == "blocked":
            blocked += 1

    decisions = (
        sb.table("decision_log")
        .select("created_at, action")
        .eq("user_id", uid)
        .gte("created_at", since_iso)
        .execute()
        .data
    )
    delegation_count = sum(1 for d in decisions if d.get("action") == "delegate")

    avg_tat = round((tat_days_total / tat_n) * 24, 1) if tat_n else 0.0

    return {
        "avg_tat_hours": avg_tat,
        "tasks_completed": tasks_completed,
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
        .select("id, status, updated_at, closed_at, task_entities(*)")
        .in_("initiative_id", initiative_ids)
        .execute()
        .data
    ) if initiative_ids else []

    # Subtasks belong to the business via their parent task. They carry the
    # same operational states (minus 'archived') and were excluded from this
    # dashboard entirely — bug #5.
    task_ids = [t["id"] for t in all_tasks]
    subtasks = (
        sb.table("subtasks")
        .select("id, status, updated_at, closed_at")
        .in_("task_id", task_ids)
        .execute()
        .data
    ) if task_ids else []

    today              = date.today()
    since_date         = today - timedelta(days=days)
    stale_threshold    = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    def _completed_in_range(row: dict) -> bool:
        # Completed within the selected timeframe (the `days` param was
        # ignored before — bug #2), measured by closed_at not status alone.
        return (
            row.get("status") == "done"
            and (_closed_date(row.get("closed_at")) or date.min) >= since_date
        )

    def _is_stale(row: dict) -> bool:
        # updated_at is now actually selected, so this stops counting every
        # open row (bug #1).
        return (
            row.get("status") not in ("done", "archived")
            and (row.get("updated_at") or "") < stale_threshold
        )

    total_tasks            = len(all_tasks)
    total_subtasks         = len(subtasks)
    task_completed         = sum(1 for t in all_tasks if _completed_in_range(t))
    subtask_completed      = sum(1 for s in subtasks if _completed_in_range(s))
    completed_count        = task_completed + subtask_completed
    stale_count            = sum(1 for t in all_tasks if _is_stale(t)) + \
                             sum(1 for s in subtasks if _is_stale(s))
    blocked_count          = sum(1 for t in all_tasks if t.get("status") == "blocked") + \
                             sum(1 for s in subtasks if s.get("status") == "blocked")
    pending_decision_count = sum(1 for t in all_tasks if t.get("status") == "pending_decision") + \
                             sum(1 for s in subtasks if s.get("status") == "pending_decision")

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
        "total_subtasks": total_subtasks,
        "total_items": total_tasks + total_subtasks,
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


def _is_overdue(status: Optional[str], due_date, today: date) -> bool:
    return (
        status not in _OPEN_STATUSES_EXCLUDED_FROM_OVERDUE
        and bool(due_date)
        and str(due_date)[:10] < today.isoformat()
    )


def _closed_date(closed_at: Optional[str]) -> Optional[date]:
    if not closed_at:
        return None
    try:
        return datetime.fromisoformat(closed_at.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _tat_days(created_at: Optional[str], closed_at: Optional[str]) -> Optional[float]:
    if not created_at or not closed_at:
        return None
    try:
        c = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        z = datetime.fromisoformat(closed_at.replace("Z", "+00:00"))
        return (z - c).total_seconds() / 86400.0
    except (ValueError, TypeError):
        return None


def _avg(total: float, n: int) -> Optional[float]:
    return round(total / n, 1) if n else None


def _bulk_user_names(sb: Client, uids: List[str]) -> dict:
    uids = [u for u in {x for x in uids if x}]
    if not uids:
        return {}
    rows = sb.table("users").select("id, name, email").in_("id", uids).execute().data
    return {u["id"]: (u.get("name") or u.get("email") or u["id"]) for u in rows}


@router.get("/reports/people")
def report_people(
    business_id: str,
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    format: str = Query(default="json", pattern="^(json|csv)$"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Per-stakeholder breakdown for a business across tasks AND subtasks.

    Task ownership = primary + secondary/follower stakeholders; subtask
    ownership = assignee. Completion is closed_at within [start,end].
    on_time/late split applies to completed tasks that have a due_date.
    avg_delay_days comes from task_date_change_log (positive slips on the
    person's items). overdue/blocked/reopened/pending_approval are
    current-state snapshots, not date-filtered.
    """
    require_member(sb, business_id, user["id"])
    today = date.today()

    initiative_ids = _business_initiative_ids(sb, business_id)
    tasks = (
        sb.table("tasks")
        .select("id, status, due_date, closed_at, created_at, "
                "primary_stakeholder_id, approval_state")
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
    subtasks = (
        sb.table("subtasks")
        .select("id, status, closed_at, created_at, assignee_id, approval_state, task_id")
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

    def _blank():
        return {
            "tasks_owned": 0, "subtasks_owned": 0,
            "tasks_completed": 0, "subtasks_completed": 0,
            "on_time_count": 0, "late_count": 0,
            "tasks_overdue": 0, "blocked_count": 0,
            "reopened_count": 0, "pending_approval_count": 0,
            "_tat_total": 0.0, "_tat_n": 0,
            "_delay_total": 0.0, "_delay_n": 0,
        }
    stats: dict = defaultdict(_blank)

    for t in tasks:
        uids = owners_by_task.get(t["id"], set())
        if not uids:
            continue
        completed = t.get("status") == "done" and _closed_in_range(
            t.get("closed_at"), start_date, end_date)
        td = _tat_days(t.get("created_at"), t.get("closed_at")) if completed else None
        on_time = late = False
        if completed and t.get("due_date"):
            cd = _closed_date(t.get("closed_at"))
            if cd is not None:
                if cd <= date.fromisoformat(str(t["due_date"])[:10]):
                    on_time = True
                else:
                    late = True
        overdue = _is_overdue(t.get("status"), t.get("due_date"), today)
        blocked = t.get("status") == "blocked"
        reopened = t.get("status") == "reopened"
        pending = t.get("approval_state") == "pending"
        for uid in uids:
            s = stats[uid]
            s["tasks_owned"] += 1
            if completed:
                s["tasks_completed"] += 1
            if on_time:
                s["on_time_count"] += 1
            if late:
                s["late_count"] += 1
            if overdue:
                s["tasks_overdue"] += 1
            if blocked:
                s["blocked_count"] += 1
            if reopened:
                s["reopened_count"] += 1
            if pending:
                s["pending_approval_count"] += 1
            if td is not None:
                s["_tat_total"] += td
                s["_tat_n"] += 1

    for st in subtasks:
        uid = st.get("assignee_id")
        if not uid:
            continue
        s = stats[uid]
        s["subtasks_owned"] += 1
        completed = st.get("status") == "done" and _closed_in_range(
            st.get("closed_at"), start_date, end_date)
        if completed:
            s["subtasks_completed"] += 1
            td = _tat_days(st.get("created_at"), st.get("closed_at"))
            if td is not None:
                s["_tat_total"] += td
                s["_tat_n"] += 1
        if st.get("status") == "blocked":
            s["blocked_count"] += 1
        if st.get("status") == "reopened":
            s["reopened_count"] += 1
        if st.get("approval_state") == "pending":
            s["pending_approval_count"] += 1

    # Schedule slips: task_date_change_log.delay_days (positive = pushed out),
    # attributed to the item's owner(s).
    sub_owner = {st["id"]: st.get("assignee_id") for st in subtasks}
    dlog = (
        sb.table("task_date_change_log")
        .select("task_id, subtask_id, delay_days")
        .in_("task_id", task_ids)
        .execute()
        .data
    ) if task_ids else []
    sub_ids = [st["id"] for st in subtasks]
    if sub_ids:
        dlog += (
            sb.table("task_date_change_log")
            .select("task_id, subtask_id, delay_days")
            .in_("subtask_id", sub_ids)
            .execute()
            .data
        )
    seen_dlog = set()
    for d in dlog:
        key = (d.get("task_id"), d.get("subtask_id"), d.get("delay_days"))
        if key in seen_dlog:
            continue
        seen_dlog.add(key)
        delay = d.get("delay_days")
        if not delay or delay <= 0:
            continue
        if d.get("subtask_id"):
            owners = {sub_owner.get(d["subtask_id"])} - {None}
        else:
            owners = owners_by_task.get(d.get("task_id"), set())
        for uid in owners:
            s = stats[uid]
            s["_delay_total"] += delay
            s["_delay_n"] += 1

    name_map = _bulk_user_names(sb, list(stats.keys()))

    result = []
    for uid, s in stats.items():
        result.append({
            "user_id": uid,
            "user_name": name_map.get(uid, uid),
            "tasks_owned": s["tasks_owned"],
            "subtasks_owned": s["subtasks_owned"],
            "tasks_completed": s["tasks_completed"],
            "subtasks_completed": s["subtasks_completed"],
            "on_time_count": s["on_time_count"],
            "late_count": s["late_count"],
            "tasks_overdue": s["tasks_overdue"],
            "blocked_count": s["blocked_count"],
            "reopened_count": s["reopened_count"],
            "pending_approval_count": s["pending_approval_count"],
            "avg_tat_days": _avg(s["_tat_total"], s["_tat_n"]),
            "avg_delay_days": _avg(s["_delay_total"], s["_delay_n"]),
        })
    result.sort(key=lambda r: (-(r["tasks_owned"] + r["subtasks_owned"]), r["user_name"]))

    if format == "csv":
        return _make_csv_response(
            result,
            ["user_id", "user_name", "tasks_owned", "subtasks_owned",
             "tasks_completed", "subtasks_completed", "on_time_count",
             "late_count", "tasks_overdue", "blocked_count", "reopened_count",
             "pending_approval_count", "avg_tat_days", "avg_delay_days"],
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
        .select("id, name, status, lead_user_id")
        .eq("business_id", business_id)
        .execute()
        .data
    )
    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, program_id, owner_id, target_end_date")
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
    milestones = (
        sb.table("milestones")
        .select("parent_id, name, uniform_date")
        .eq("parent_type", "initiative")
        .in_("parent_id", init_ids)
        .execute()
        .data
    ) if init_ids else []

    ms_by_init: dict = defaultdict(lambda: {"total": 0, "overdue": 0})
    for m in milestones:
        b = ms_by_init[m.get("parent_id")]
        b["total"] += 1
        ud = m.get("uniform_date")
        if ud and str(ud)[:10] < today.isoformat():
            b["overdue"] += 1

    name_map = _bulk_user_names(
        sb,
        [i.get("owner_id") for i in initiatives] + [p.get("lead_user_id") for p in programs],
    )

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

    def _schedule_health(i: dict) -> str:
        if i.get("status") in ("completed", "cancelled"):
            return "closed"
        ted = i.get("target_end_date")
        if not ted:
            return "no_date"
        return "overdue" if str(ted)[:10] < today.isoformat() else "on_track"

    init_by_program: dict = defaultdict(list)
    for i in initiatives:
        a = per_init[i["id"]]
        ms = ms_by_init.get(i["id"], {"total": 0, "overdue": 0})
        init_by_program[i.get("program_id")].append({
            "initiative_id": i["id"],
            "initiative_name": i["name"],
            "status": i.get("status"),
            "owner_name": name_map.get(i.get("owner_id")),
            "target_end_date": i.get("target_end_date"),
            "schedule_health": _schedule_health(i),
            "total_tasks": a["total_tasks"],
            "done_tasks": a["done_tasks"],
            "completion_pct": _pct(a["done_tasks"], a["total_tasks"]),
            "overdue_count": a["overdue_count"],
            "blocked_count": a["blocked_count"],
            "milestones_total": ms["total"],
            "milestones_overdue": ms["overdue"],
        })

    program_blocks = []
    ordered = [(p["id"], p["name"], p.get("status"), p.get("lead_user_id")) for p in programs]
    if None in init_by_program:
        ordered.append((None, "Unassigned", None, None))
    for pid, pname, pstatus, lead in ordered:
        inits = sorted(init_by_program.get(pid, []), key=lambda r: r["initiative_name"])
        tot = sum(x["total_tasks"] for x in inits)
        dn = sum(x["done_tasks"] for x in inits)
        program_blocks.append({
            "program_id": pid,
            "program_name": pname,
            "status": pstatus,
            "lead_name": name_map.get(lead),
            "total_tasks": tot,
            "done_tasks": dn,
            "completion_pct": _pct(dn, tot),
            "overdue_count": sum(x["overdue_count"] for x in inits),
            "blocked_count": sum(x["blocked_count"] for x in inits),
            "initiatives_overdue": sum(1 for x in inits if x["schedule_health"] == "overdue"),
            "milestones_total": sum(x["milestones_total"] for x in inits),
            "milestones_overdue": sum(x["milestones_overdue"] for x in inits),
            "initiatives": inits,
        })

    if format == "csv":
        flat = []
        for pb in program_blocks:
            for it in pb["initiatives"]:
                flat.append({
                    "program": pb["program_name"],
                    "program_lead": pb["lead_name"],
                    "initiative": it["initiative_name"],
                    "initiative_status": it["status"],
                    "owner": it["owner_name"],
                    "target_end_date": it["target_end_date"],
                    "schedule_health": it["schedule_health"],
                    "total_tasks": it["total_tasks"],
                    "done_tasks": it["done_tasks"],
                    "completion_pct": it["completion_pct"],
                    "overdue_count": it["overdue_count"],
                    "blocked_count": it["blocked_count"],
                    "milestones_total": it["milestones_total"],
                    "milestones_overdue": it["milestones_overdue"],
                })
        return _make_csv_response(
            flat,
            ["program", "program_lead", "initiative", "initiative_status",
             "owner", "target_end_date", "schedule_health", "total_tasks",
             "done_tasks", "completion_pct", "overdue_count", "blocked_count",
             "milestones_total", "milestones_overdue"],
            "programs_report.csv",
        )
    return {"programs": program_blocks, "timeframe": {"start": start_date, "end": end_date}}
