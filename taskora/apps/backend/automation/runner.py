"""The heartbeat. Vercel Cron → /api/v1/internal/cron/tick → runner.tick().

tick() does two things every run:
  1. processes due `automation_jobs` (durable, retryable ad-hoc work),
  2. runs the idempotent campaign scans (trial reminders, dunning, activation).

Both are safe to run on every tick — dedupe keys guarantee "send once".
Nothing here raises; a job failure is recorded and retried with backoff.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import Client

from automation import campaigns, dispatch

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 5
_JOB_BATCH = 50


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Ad-hoc job handlers ──────────────────────────────────────────────────
def _h_send(sb: Client, payload: dict) -> None:
    """Send one message (decoupled path — e.g. a webhook enqueues this)."""
    dispatch.send(
        sb,
        channel=payload.get("channel", "email"),
        template=payload["template"],
        ctx=payload.get("ctx", {}),
        user=payload.get("user"),
        business_id=payload.get("business_id"),
        dedupe_key=payload.get("dedupe_key", ""),
        campaign=payload.get("campaign"),
    )


HANDLERS = {"send": _h_send}


def _process_jobs(sb: Client, now: datetime) -> dict:
    processed = failed = 0
    try:
        due = (
            sb.table("automation_jobs").select("*")
            .eq("status", "pending").lte("run_at", now.isoformat())
            .order("run_at").limit(_JOB_BATCH).execute().data
        )
    except Exception as e:
        logger.warning("[runner] job fetch failed: %s", e)
        return {"processed": 0, "failed": 0}

    for job in due:
        jid = job["id"]
        # Optimistic claim — single cron caller, so a CAS on status is enough.
        try:
            sb.table("automation_jobs").update(
                {"status": "running", "locked_at": now.isoformat()}
            ).eq("id", jid).eq("status", "pending").execute()
        except Exception:
            continue
        handler = HANDLERS.get(job.get("type"))
        try:
            if not handler:
                raise ValueError(f"no handler for job type {job.get('type')!r}")
            handler(sb, job.get("payload") or {})
            sb.table("automation_jobs").update(
                {"status": "done", "updated_at": now.isoformat()}
            ).eq("id", jid).execute()
            processed += 1
        except Exception as e:
            attempts = int(job.get("attempts") or 0) + 1
            if attempts >= _MAX_ATTEMPTS:
                patch = {"status": "failed", "attempts": attempts,
                         "last_error": str(e)[:500], "updated_at": now.isoformat()}
                failed += 1
            else:
                backoff = min(60, 5 * (2 ** attempts))  # minutes, capped at 1h
                patch = {"status": "pending", "attempts": attempts,
                         "last_error": str(e)[:500],
                         "run_at": (now + timedelta(minutes=backoff)).isoformat(),
                         "updated_at": now.isoformat()}
            try:
                sb.table("automation_jobs").update(patch).eq("id", jid).execute()
            except Exception:
                pass
            logger.warning("[runner] job %s failed (attempt %s): %s", jid, attempts, e)
    return {"processed": processed, "failed": failed}


def tick(sb: Client, now: Optional[datetime] = None) -> dict:
    """One heartbeat. Returns a summary the cron endpoint echoes for ops."""
    now = now or _now()
    jobs = _process_jobs(sb, now)
    summary = {
        "ts": now.isoformat(),
        "jobs": jobs,
        "trial_reminders": campaigns.run_trial_reminders(sb, now),
        "dunning": campaigns.run_dunning(sb, now),
        "activation": campaigns.run_activation(sb, now),
    }
    logger.info("[runner] tick %s", summary)
    return summary
