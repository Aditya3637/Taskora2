"""Campaign scans — the idempotent business logic the cron tick runs.

Every campaign operates at the ACCOUNT level (one workspace/business = one
billing account), addresses the workspace OWNER (the billing contact), and is
seat-aware (members = seats). Dedupe keys make each scan safe to run every
tick: a given message is sent at most once per account per stage.

This is the crux of "100 users ≠ 100 sales": campaigns iterate over
subscriptions/businesses (accounts), never over users. A 100-employee company
is one account here, messaged once.
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from supabase import Client

from config import get_settings
from automation import dispatch

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        v = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(v)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _app_url() -> str:
    return (get_settings().frontend_url or "").rstrip("/")


def campaign_enabled(sb: Client, campaign: str) -> bool:
    """Missing row = enabled (default on). Explicit enabled=false = kill switch."""
    try:
        rows = sb.table("automation_settings").select("enabled").eq("campaign", campaign).limit(1).execute().data
        return bool(rows[0]["enabled"]) if rows else True
    except Exception:
        return True


def _owners_for(sb: Client, businesses: list[dict]) -> dict[str, dict]:
    """Map business_id -> owner user dict {id,email,phone,name}."""
    owner_ids = sorted({b["owner_id"] for b in businesses if b.get("owner_id")})
    by_uid: dict[str, dict] = {}
    if owner_ids:
        try:
            for u in sb.table("users").select("id, name, email, phone").in_("id", owner_ids).execute().data:
                by_uid[u["id"]] = u
        except Exception:
            pass
    out: dict[str, dict] = {}
    for b in businesses:
        out[b["id"]] = by_uid.get(b.get("owner_id"), {"id": b.get("owner_id")})
    return out


def _seat_count(sb: Client, business_id: str) -> int:
    try:
        return len(sb.table("business_members").select("user_id").eq("business_id", business_id).execute().data)
    except Exception:
        return 0


def _ctx(business: dict, owner: dict, **extra) -> dict:
    return {
        "name": (owner.get("name") or "there"),
        "workspace": business.get("name") or "your workspace",
        "app_url": _app_url(),
        **extra,
    }


# ── Trial-end reminders ──────────────────────────────────────────────────
_TRIAL_WINDOWS = [  # (lo_days, hi_days, template) — first match wins
    (3, 7, "trial_ending_7"),
    (1, 3, "trial_ending_3"),
    (0, 1, "trial_ending_1"),
]


def run_trial_reminders(sb: Client, now: Optional[datetime] = None) -> int:
    if not campaign_enabled(sb, "trial"):
        return 0
    now = now or _now()
    try:
        subs = sb.table("subscriptions").select(
            "business_id, status, trial_end, plan"
        ).eq("status", "trialing").execute().data
    except Exception as e:
        logger.warning("[trial] fetch failed: %s", e)
        return 0
    if not subs:
        return 0
    biz_ids = [s["business_id"] for s in subs if s.get("business_id")]
    biz_rows = sb.table("businesses").select("id, name, owner_id").in_("id", biz_ids).execute().data if biz_ids else []
    biz_by_id = {b["id"]: b for b in biz_rows}
    owners = _owners_for(sb, biz_rows)

    sent = 0
    for s in subs:
        bid = s.get("business_id")
        biz = biz_by_id.get(bid)
        if not biz:
            continue
        end = _parse_ts(s.get("trial_end"))
        if not end:
            continue
        days_left = (end - now).total_seconds() / 86400.0
        template = None
        if days_left <= 0:
            template = "trial_expired"
        else:
            for lo, hi, t in _TRIAL_WINDOWS:
                if lo < days_left <= hi:
                    template = t
                    break
        if not template:
            continue
        ctx = _ctx(biz, owners.get(bid, {}),
                   trial_end_date=end.date().isoformat(),
                   seats=f"{_seat_count(sb, bid)} seats")
        r = dispatch.send(
            sb, channel="email", template=template, ctx=ctx,
            user=owners.get(bid), business_id=bid,
            dedupe_key=f"trial:{bid}:{template}", campaign="trial",
        )
        if r["status"] == "sent":
            sent += 1
    return sent


# ── Payment dunning ──────────────────────────────────────────────────────
_DUNNING_STAGES = [  # (min_days_since_failure, template) — last match wins
    (0, "payment_failed_1"),
    (3, "payment_failed_3"),
    (7, "payment_failed_final"),
]


def run_dunning(sb: Client, now: Optional[datetime] = None) -> int:
    if not campaign_enabled(sb, "dunning"):
        return 0
    now = now or _now()
    try:
        subs = sb.table("subscriptions").select(
            "business_id, status, current_period_end, updated_at, plan"
        ).eq("status", "past_due").execute().data
    except Exception as e:
        logger.warning("[dunning] fetch failed: %s", e)
        return 0
    if not subs:
        return 0
    biz_ids = [s["business_id"] for s in subs if s.get("business_id")]
    biz_rows = sb.table("businesses").select("id, name, owner_id").in_("id", biz_ids).execute().data if biz_ids else []
    biz_by_id = {b["id"]: b for b in biz_rows}
    owners = _owners_for(sb, biz_rows)

    sent = 0
    for s in subs:
        bid = s.get("business_id")
        biz = biz_by_id.get(bid)
        if not biz:
            continue
        failed_at = _parse_ts(s.get("current_period_end")) or _parse_ts(s.get("updated_at"))
        if not failed_at:
            continue
        days_since = (now - failed_at).total_seconds() / 86400.0
        template = None
        for min_days, t in _DUNNING_STAGES:
            if days_since >= min_days:
                template = t
        if not template:
            continue
        ctx = _ctx(biz, owners.get(bid, {}))
        r = dispatch.send(
            sb, channel="email", template=template, ctx=ctx,
            user=owners.get(bid), business_id=bid,
            dedupe_key=f"dunning:{bid}:{template}", campaign="dunning",
        )
        if r["status"] == "sent":
            sent += 1
    return sent


# ── Program health snapshots (P2 trend) ──────────────────────────────────
def run_program_snapshots(sb: Client, now: Optional[datetime] = None) -> int:
    """Write one health/progress/outcome snapshot per active program per day.
    Idempotent (skips a program already snapshotted today). This is what gives
    the program trend its history."""
    if not campaign_enabled(sb, "program_snapshots"):
        return 0
    now = now or _now()
    today = now.date()
    today_iso = today.isoformat()
    # Lazy import keeps the automation package independent of the routers at
    # import time (no cycle — routers.programs doesn't import automation).
    from routers.programs import _derive_initiative_health, program_outcome_pct

    try:
        programs = sb.table("programs").select(
            "id, manual_health, status"
        ).neq("status", "archived").execute().data
    except Exception as e:
        logger.warning("[snapshots] fetch failed: %s", e)
        return 0

    done_states = {"done", "completed"}
    written = 0
    for p in programs:
        pid = p["id"]
        try:
            existing = sb.table("program_snapshots").select("id").eq(
                "program_id", pid).eq("snapshot_date", today_iso).limit(1).execute().data
        except Exception:
            existing = None
        if existing:
            continue

        inits = sb.table("initiatives").select(
            "id, status, target_end_date"
        ).eq("program_id", pid).neq("status", "cancelled").execute().data
        total = len(inits)
        done = sum(1 for i in inits if i.get("status") in done_states)
        at_risk = overdue = no_dates = 0
        for i in inits:
            if i.get("status") in done_states:
                continue
            h = _derive_initiative_health(i, today)
            if h == "amber":
                at_risk += 1
            elif h == "red":
                overdue += 1
            elif h == "not_started":
                no_dates += 1
        if p.get("manual_health"):
            health = p["manual_health"]
        elif total == 0 or no_dates == total:
            health = "not_started"
        elif overdue >= 2:
            health = "red"
        elif overdue >= 1 or at_risk >= 1:
            health = "amber"
        else:
            health = "green"
        progress = round(done / total * 100) if total else 0
        outcome = program_outcome_pct(sb, pid)

        overdue_tasks = 0
        if inits:
            init_ids = [i["id"] for i in inits]
            tasks = sb.table("tasks").select("due_date, status").in_(
                "initiative_id", init_ids).neq("status", "done").neq("status", "cancelled").execute().data
            overdue_tasks = sum(1 for t in tasks if t.get("due_date") and t["due_date"] < today_iso)

        try:
            sb.table("program_snapshots").insert({
                "program_id": pid, "snapshot_date": today_iso, "health": health,
                "progress_pct": progress, "outcome_pct": outcome, "overdue_tasks": overdue_tasks,
                "initiatives_total": total, "initiatives_done": done,
            }).execute()
            written += 1
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("[snapshots] insert failed for %s: %s", pid, e)
    return written


# ── Activation nudges (new accounts) ─────────────────────────────────────
def run_activation(sb: Client, now: Optional[datetime] = None) -> int:
    if not campaign_enabled(sb, "activation"):
        return 0
    now = now or _now()
    try:
        biz_rows = sb.table("businesses").select("id, name, owner_id, created_at").execute().data
    except Exception as e:
        logger.warning("[activation] fetch failed: %s", e)
        return 0
    owners = _owners_for(sb, biz_rows)
    sent = 0
    for biz in biz_rows:
        bid = biz["id"]
        created = _parse_ts(biz.get("created_at"))
        if not created:
            continue
        age_days = (now - created).total_seconds() / 86400.0
        template = dedupe = cond = None
        if 1 <= age_days < 2:
            # Day-1: nudge to create the first initiative if there are none.
            try:
                inits = sb.table("initiatives").select("id").eq("business_id", bid).limit(1).execute().data
            except Exception:
                inits = [1]  # on error, assume active → don't nag
            if not inits:
                template, dedupe, cond = "activation_no_initiative", f"activation:{bid}:no_initiative", True
        elif 3 <= age_days < 4:
            # Day-3: nudge to invite the team if it's still a single seat.
            if _seat_count(sb, bid) <= 1:
                template, dedupe, cond = "activation_invite_team", f"activation:{bid}:invite_team", True
        if not template or not cond:
            continue
        ctx = _ctx(biz, owners.get(bid, {}))
        r = dispatch.send(
            sb, channel="email", template=template, ctx=ctx,
            user=owners.get(bid), business_id=bid,
            dedupe_key=dedupe, campaign="activation",
        )
        if r["status"] == "sent":
            sent += 1
    return sent
