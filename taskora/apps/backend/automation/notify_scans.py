"""Scheduled notification scans, run on every cron tick.

Unlike event-driven notifications (automation.notify called from routers),
due-soon / overdue are time-based: there's no write to hook, so the heartbeat
scans for them. Idempotent via a per-(task, day) dedupe_key so a task that's
overdue for a week produces exactly one notification per day, not one per tick.
"""
import logging
from datetime import datetime, timedelta

from supabase import Client

from automation.notify import notify

logger = logging.getLogger(__name__)

# Statuses that are still "open" — done/closed tasks don't nag.
_OPEN_STATUSES = {"backlog", "in_progress", "blocked", "reopened", "todo"}
_SCAN_LIMIT = 500


def run_due_overdue(sb: Client, now: datetime) -> dict:
    """Notify each task's primary stakeholder of due-soon / overdue work."""
    today = now.date()
    today_s = today.isoformat()
    horizon_s = (today + timedelta(days=1)).isoformat()
    try:
        rows = (
            sb.table("tasks")
            .select("id, title, due_date, status, primary_stakeholder_id, initiative_id")
            .lte("due_date", horizon_s)
            .limit(_SCAN_LIMIT)
            .execute()
            .data
        )
    except Exception as e:
        logger.warning("[notify_scans] due scan fetch failed: %s", e)
        return {"checked": 0, "notified": 0}

    rows = [r for r in rows
            if r.get("due_date") and r.get("primary_stakeholder_id")
            and (r.get("status") or "") in _OPEN_STATUSES]
    if not rows:
        return {"checked": 0, "notified": 0}

    init_ids = list({r["initiative_id"] for r in rows if r.get("initiative_id")})
    biz: dict[str, str] = {}
    if init_ids:
        try:
            for ir in sb.table("initiatives").select("id, business_id").in_("id", init_ids).execute().data:
                biz[ir["id"]] = ir["business_id"]
        except Exception:
            pass

    notified = 0
    for r in rows:
        due = r["due_date"]
        overdue = due < today_s
        typ = "overdue" if overdue else "due_soon"
        label = "Overdue" if overdue else "Due soon"
        notify(
            sb, type=typ,
            business_id=biz.get(r.get("initiative_id")),
            actor_id=None,
            recipients=[r["primary_stakeholder_id"]],
            title=f"{label}: “{r.get('title') or 'a task'}”",
            body=f"due {due}",
            entity_type="task", entity_id=r["id"],
            push=False,
            dedupe_key=f"{typ}:{r['id']}:{today_s}",
        )
        notified += 1
    return {"checked": len(rows), "notified": notified}
