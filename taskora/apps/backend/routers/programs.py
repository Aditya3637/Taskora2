from typing import Optional
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
from pydantic import BaseModel, field_validator

from auth import get_current_user
from deps import (
    get_supabase, require_member, require_admin_or_owner, get_member_role,
    is_admin_or_owner, aligned_initiative_ids, program_follower_ids,
    visible_program_ids, visible_initiative_ids,
)
from ai import program_summary

router = APIRouter(prefix="/api/v1/programs", tags=["programs"])

# Expanded to match the values the frontend already renders badges for; the
# migration 031 check constraint enforces the same set in the DB.
_VALID_STATUSES = {"planning", "active", "paused", "on_hold", "completed", "archived", "cancelled"}
_VALID_IMPACT_CATS = {"cost", "customer_experience", "process_efficiency", "other"}
_VALID_HEALTH = {"green", "amber", "red", "not_started"}
# Initiatives whose target end is within this window count as "at risk" in the rollup.
_AT_RISK_WINDOW_DAYS = 14

# ── P3: composite-health tuning ────────────────────────────────────────────────
# Risk components are each normalised 0..1 (higher = worse), then averaged over
# whatever signals are present. The blended score maps to a RAG band:
_RISK_RED = 0.5      # score >= this → red
_RISK_AMBER = 0.25   # score >= this (and < red) → amber; below → green
# Staleness ramps from "fine" to "fully stale" between these day counts (the
# most-recent task update across the program).
_STALE_MIN_DAYS = 3
_STALE_MAX_DAYS = 21
# A task is no longer "live work" once it reaches one of these resting states.
_OPEN_TASK_EXCLUDE = {"done", "cancelled", "archived"}

# Fields that may legitimately be cleared to NULL via PATCH (N12). Anything not
# listed here is ignored when sent as null, so a required field (name/color/
# status/title/direction) can never be blanked by an explicit null.
_PROGRAM_NULLABLE = {
    "description", "objective", "start_date", "target_end_date",
    "lead_user_id", "manual_health",
}
_KR_NULLABLE = {"unit", "baseline", "target", "current"}


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProgramCreate(BaseModel):
    business_id: str
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#3B82F6"
    objective: Optional[str] = None
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("color")
    @classmethod
    def valid_color(cls, v: Optional[str]) -> str:
        if v and not v.startswith("#"):
            raise ValueError("color must be a hex value starting with #")
        return v or "#3B82F6"


class ProgramUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    status: Optional[str] = None
    objective: Optional[str] = None
    start_date: Optional[date] = None
    target_end_date: Optional[date] = None
    lead_user_id: Optional[str] = None
    manual_health: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_valid(cls, v: Optional[str]) -> Optional[str]:
        # Mirror ProgramCreate's rule. Create rejected blank/over-long names but
        # update silently accepted them (whitespace-only, 500-char names).
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 100:
            raise ValueError("name cannot exceed 100 characters")
        return v

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_STATUSES:
            raise ValueError(f"status must be one of {sorted(_VALID_STATUSES)}")
        return v

    @field_validator("manual_health")
    @classmethod
    def valid_health(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_HEALTH:
            raise ValueError(f"manual_health must be one of {sorted(_VALID_HEALTH)}")
        return v


class InitiativeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    primary_stakeholder_id: Optional[str] = None
    impact_category: Optional[str] = "other"
    impact: Optional[str] = None
    impact_metric: Optional[str] = None
    target_end_date: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 150:
            raise ValueError("name cannot exceed 150 characters")
        return v

    @field_validator("impact_category")
    @classmethod
    def valid_impact_cat(cls, v: Optional[str]) -> str:
        if v and v not in _VALID_IMPACT_CATS:
            return "other"
        return v or "other"


class KeyResultIn(BaseModel):
    title: str
    unit: Optional[str] = None
    baseline: Optional[float] = None
    target: Optional[float] = None
    current: Optional[float] = None
    direction: str = "increase"
    sort_order: int = 0

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("title cannot be empty")
        return v[:200]

    @field_validator("direction")
    @classmethod
    def valid_direction(cls, v: str) -> str:
        return v if v in ("increase", "decrease") else "increase"


class KeyResultPatch(BaseModel):
    title: Optional[str] = None
    unit: Optional[str] = None
    baseline: Optional[float] = None
    target: Optional[float] = None
    current: Optional[float] = None
    direction: Optional[str] = None
    sort_order: Optional[int] = None


class ProgramStatusUpdateIn(BaseModel):
    status: str
    summary: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in ("green", "amber", "red"):
            raise ValueError("status must be green, amber or red")
        return v

    @field_validator("summary")
    @classmethod
    def summary_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("summary cannot be empty")
        return v[:2000]


# ── Helpers ───────────────────────────────────────────────────────────────────

_PROGRAM_COLS = (
    "id, business_id, name, description, status, color, lead_user_id, "
    "objective, start_date, target_end_date, manual_health, created_at"
)


def kr_progress(kr: dict) -> Optional[float]:
    """Outcome progress for one key result, 0..1 (None if not measurable).

    'increase'  → (current-baseline)/(target-baseline)
    'decrease'  → (baseline-current)/(baseline-target)
    Baseline defaults to 0 when unset. If target==baseline we can't measure a
    ratio, so it's 1.0 once current reaches target, else 0.0.
    """
    target = kr.get("target")
    current = kr.get("current")
    if target is None or current is None:
        return None
    base = kr.get("baseline") or 0.0
    try:
        target, current, base = float(target), float(current), float(base)
    except (TypeError, ValueError):
        return None
    increase = (kr.get("direction") or "increase") == "increase"
    denom = (target - base) if increase else (base - target)
    if denom == 0:
        reached = current >= target if increase else current <= target
        return 1.0 if reached else 0.0
    num = (current - base) if increase else (base - current)
    return max(0.0, min(1.0, num / denom))


def program_outcome_pct(sb: Client, program_id: str) -> Optional[int]:
    """Average measurable-KR progress for a program as a 0..100 int, or None
    when the program has no measurable key results. Best-effort: if the
    program_key_results table doesn't exist yet (migration 046 not applied),
    return None rather than break the rollup that existing dashboards call."""
    try:
        krs = sb.table("program_key_results").select(
            "baseline, target, current, direction"
        ).eq("program_id", program_id).execute().data
    except Exception:
        return None
    vals = [p for p in (kr_progress(k) for k in krs) if p is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals) * 100)


# ── P3: composite health + ranked risk ─────────────────────────────────────────

def _schedule_risk(initiative: dict, today: date) -> Optional[float]:
    """Date risk for one initiative: 0.0 green, 0.5 amber, 1.0 red.
    None when it has no target date (not_started — excluded from the blend so a
    program isn't penalised for an initiative nobody has dated yet)."""
    if initiative.get("status") in ("done", "completed"):
        return 0.0
    end = initiative.get("target_end_date")
    if not end:
        return None
    end_d = end if isinstance(end, date) else date.fromisoformat(end[:10])
    if end_d < today:
        return 1.0
    if end_d <= today + timedelta(days=_AT_RISK_WINDOW_DAYS):
        return 0.5
    return 0.0


def _task_signals(tasks: list, today: date) -> tuple[int, int, int, Optional[int]]:
    """(open_count, overdue_count, blocked_count, days_since_latest_update)."""
    today_iso = today.isoformat()
    open_tasks = [t for t in tasks if t.get("status") not in _OPEN_TASK_EXCLUDE]
    overdue = sum(1 for t in open_tasks if t.get("due_date") and t["due_date"] < today_iso)
    blocked = sum(1 for t in open_tasks if t.get("status") == "blocked")
    upds = [t.get("updated_at") for t in tasks if t.get("updated_at")]
    days_stale = (today - date.fromisoformat(max(upds)[:10])).days if upds else None
    return len(open_tasks), overdue, blocked, days_stale


def _staleness_risk(days_stale: Optional[int]) -> Optional[float]:
    if days_stale is None:
        return None
    if days_stale <= _STALE_MIN_DAYS:
        return 0.0
    if days_stale >= _STALE_MAX_DAYS:
        return 1.0
    return (days_stale - _STALE_MIN_DAYS) / (_STALE_MAX_DAYS - _STALE_MIN_DAYS)


def _blend(components: dict) -> Optional[float]:
    """Equal-weighted mean over the components that have a signal (non-None).
    Equal weights are deliberate: explainable now, tunable later."""
    vals = [v for v in components.values() if v is not None]
    return sum(vals) / len(vals) if vals else None


def _score_to_health(score: Optional[float], manual_health: Optional[str] = None) -> str:
    """Map a 0..1 risk score to a RAG band. A manual override always wins
    (consistent with the legacy date-only `health` field)."""
    if manual_health:
        return manual_health
    if score is None:
        return "not_started"
    if score >= _RISK_RED:
        return "red"
    if score >= _RISK_AMBER:
        return "amber"
    return "green"


def _rnd(v: Optional[float]) -> Optional[float]:
    return round(v, 3) if v is not None else None


def program_risk(sb: Client, program: dict, today: date) -> dict:
    """Composite health for a program, blending five signals — schedule,
    outcome (KR attainment), throughput (overdue load), blockers, staleness —
    plus a per-initiative ranked-risk list with human-readable reasons.

    Each signal is only counted when it has data, so a thinly-populated program
    is scored on what's known rather than punished for missing inputs."""
    program_id = program["id"]
    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, start_date, target_end_date")
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )
    active = [i for i in initiatives if i.get("status") not in ("done", "completed")]
    init_ids = [i["id"] for i in initiatives]
    tasks: list = []
    if init_ids:
        tasks = (
            sb.table("tasks")
            .select("id, title, status, due_date, updated_at, initiative_id")
            .in_("initiative_id", init_ids)
            .execute()
            .data
        )
    tasks_by_init: dict = {}
    for t in tasks:
        tasks_by_init.setdefault(t.get("initiative_id"), []).append(t)

    # Program-level components.
    sched_vals = [r for r in (_schedule_risk(i, today) for i in active) if r is not None]
    schedule = (sum(sched_vals) / len(sched_vals)) if sched_vals else None
    out_pct = program_outcome_pct(sb, program_id)
    outcome = (1 - out_pct / 100) if out_pct is not None else None
    open_count, overdue, blocked, days_stale = _task_signals(tasks, today)
    throughput = (overdue / open_count) if open_count else None
    blockers = (blocked / open_count) if open_count else None
    staleness = _staleness_risk(days_stale)

    components = {
        "schedule": schedule, "outcome": outcome, "throughput": throughput,
        "blockers": blockers, "staleness": staleness,
    }
    score = _blend(components)
    health = _score_to_health(score, program.get("manual_health"))

    # Per-initiative ranking (outcome is program-scoped, so excluded here).
    ranked: list = []
    for i in active:
        itasks = tasks_by_init.get(i["id"], [])
        iopen, iover, iblk, istale = _task_signals(itasks, today)
        isched = _schedule_risk(i, today)
        icomp = {
            "schedule": isched,
            "throughput": (iover / iopen) if iopen else None,
            "blockers": (iblk / iopen) if iopen else None,
            "staleness": _staleness_risk(istale),
        }
        iscore = _blend(icomp)
        reasons: list = []
        if isched == 1.0:
            reasons.append("past target date")
        elif isched == 0.5:
            reasons.append("target date within 2 weeks")
        if iover:
            reasons.append(f"{iover} overdue task{'s' if iover > 1 else ''}")
        if iblk:
            reasons.append(f"{iblk} blocked task{'s' if iblk > 1 else ''}")
        if istale is not None and istale >= _STALE_MAX_DAYS:
            reasons.append(f"no activity in {istale} days")
        ranked.append({
            "id": i["id"], "name": i.get("name"),
            "risk_score": _rnd(iscore),
            "health": _score_to_health(iscore),
            "schedule_health": _score_to_health(isched) if isched is not None else "not_started",
            "open_tasks": iopen, "overdue_tasks": iover, "blocked_tasks": iblk,
            "days_stale": istale, "reasons": reasons,
        })
    # Highest risk first; initiatives with no signal at all sort last.
    ranked.sort(key=lambda r: (r["risk_score"] is None, -(r["risk_score"] or 0.0)))

    return {
        "composite_health": health,
        "composite_score": _rnd(score),
        "components": {k: _rnd(v) for k, v in components.items()},
        "ranked_initiatives": ranked,
    }


def _require_program_admin_or_lead(sb: Client, program: dict, user_id: str) -> None:
    """N3: program edits/deletes are limited to a workspace owner/admin or the
    program's own lead. A plain member can no longer mutate a program."""
    role = get_member_role(sb, program["business_id"], user_id)
    if role is None:
        raise HTTPException(status_code=403, detail="Not a member of this business")
    if role in ("owner", "admin") or program.get("lead_user_id") == user_id:
        return
    raise HTTPException(
        status_code=403,
        detail="Only owner, admin, or program lead may edit this program",
    )


def _get_program_or_404(sb: Client, program_id: str) -> dict:
    rows = (
        sb.table("programs")
        .select(_PROGRAM_COLS)
        .eq("id", program_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return rows[0]


def _derive_initiative_health(initiative: dict, today: date) -> str:
    """Health dot for a single initiative on the program timeline.

    Rules (consistent with the rollup endpoint):
      - no dates                              → not_started
      - status == 'completed' / 'done'        → green (treated as on track)
      - target_end_date < today               → red
      - target_end_date <= today + 14d window → amber
      - else                                  → green
    """
    if initiative.get("status") in ("completed", "done"):
        return "green"
    end = initiative.get("target_end_date")
    if not end:
        return "not_started"
    end_d = end if isinstance(end, date) else date.fromisoformat(end[:10])
    if end_d < today:
        return "red"
    if end_d <= today + timedelta(days=_AT_RISK_WINDOW_DAYS):
        return "amber"
    return "green"


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("")
def list_programs(
    business_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List all programs for a business with their initiative counts."""
    require_member(sb, business_id, user["id"])

    programs = (
        sb.table("programs")
        .select("id, name, description, status, color, objective, start_date, target_end_date, manual_health, lead_user_id, created_at")
        .eq("business_id", business_id)
        .order("created_at")
        .execute()
        .data
    )

    # Non-admins see programs they're "visible" on: either they have an
    # aligned initiative under it, OR they're an explicit program_followers
    # row. Admins/owners see everything. Followed-but-empty programs are
    # kept (initiative_count=0) so the apex of the pyramid stays reachable.
    is_priv = is_admin_or_owner(sb, business_id, user["id"])
    follower_progs: set[str] = set()
    if programs and not is_priv:
        prog_id_set = visible_program_ids(sb, business_id, user["id"])
        if not prog_id_set:
            return []
        programs = [p for p in programs if p["id"] in prog_id_set]
        follower_progs = program_follower_ids(sb, business_id, user["id"])

    if programs:
        prog_ids = [p["id"] for p in programs]
        # For non-admins, the initiative_count must reflect only the aligned
        # initiatives — otherwise the badge lies about what they can see.
        # Exception: program followers see the full count (cascade grants
        # read of every initiative under followed programs).
        init_q = (
            sb.table("initiatives")
            .select("program_id, id")
            .in_("program_id", prog_ids)
            .neq("status", "cancelled")
        )
        init_rows = init_q.execute().data
        if not is_priv:
            scope_set = visible_initiative_ids(sb, business_id, user["id"])
            init_rows = [
                r for r in init_rows
                if r["id"] in scope_set or r["program_id"] in follower_progs
            ]
        counts: dict = {}
        for r in init_rows:
            pid = r["program_id"]
            counts[pid] = counts.get(pid, 0) + 1
        for p in programs:
            p["initiative_count"] = counts.get(p["id"], 0)

    return programs


@router.post("", status_code=201)
def create_program(
    body: ProgramCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Create a new program under a business."""
    require_member(sb, body.business_id, user["id"])

    now = datetime.now(timezone.utc).isoformat()
    result = sb.table("programs").insert({
        "business_id": body.business_id,
        "name": body.name,
        "description": body.description or None,
        "objective": body.objective or None,
        "start_date": body.start_date.isoformat() if body.start_date else None,
        "target_end_date": body.target_end_date.isoformat() if body.target_end_date else None,
        "lead_user_id": user["id"],
        "color": body.color,
        "created_at": now,
        "updated_at": now,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create program",
        )
    return result.data[0]


@router.get("/{program_id}")
def get_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Get a single program with all its non-cancelled initiatives."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    initiatives = (
        sb.table("initiatives")
        .select(
            "id, name, status, description, impact, impact_category, "
            "impact_metric, primary_stakeholder_id, start_date, target_end_date"
        )
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Non-admins: program followers see every initiative in the program;
    # everyone else is scoped to initiatives they're aligned to. 403 if
    # neither path grants visibility — the program listing won't have
    # surfaced this program to them either.
    if not is_admin_or_owner(sb, program["business_id"], user["id"]):
        is_program_follower = program_id in program_follower_ids(
            sb, program["business_id"], user["id"]
        )
        if not is_program_follower:
            scope = visible_initiative_ids(sb, program["business_id"], user["id"])
            initiatives = [i for i in initiatives if i["id"] in scope]
            if not initiatives:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You don't have access to any initiative in this program",
                )

    # Resolve primary stakeholder names in one bulk query
    ps_ids = list({i["primary_stakeholder_id"] for i in initiatives if i.get("primary_stakeholder_id")})
    name_map: dict = {}
    if ps_ids:
        rows = sb.table("users").select("id, name").in_("id", ps_ids).execute().data
        name_map = {r["id"]: r["name"] for r in rows}
    for init in initiatives:
        init["primary_stakeholder_name"] = name_map.get(
            init.get("primary_stakeholder_id") or "", ""
        )

    program["initiatives"] = initiatives
    return program


@router.post("/{program_id}/initiatives", status_code=201)
def add_initiative(
    program_id: str,
    body: InitiativeCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Add an initiative directly to a program."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    result = sb.table("initiatives").insert({
        "business_id": program["business_id"],
        "program_id": program_id,
        "name": body.name,
        "description": body.description or None,
        "owner_id": user["id"],
        "primary_stakeholder_id": body.primary_stakeholder_id or user["id"],
        "impact_category": body.impact_category,
        "impact": body.impact or None,
        "impact_metric": body.impact_metric or None,
        "target_end_date": body.target_end_date or None,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create initiative",
        )
    return result.data[0]


@router.patch("/{program_id}")
def update_program(
    program_id: str,
    body: ProgramUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update a program's fields. N3: owner/admin/lead only."""
    program = _get_program_or_404(sb, program_id)
    _require_program_admin_or_lead(sb, program, user["id"])

    # N12: keep only fields the client actually sent (exclude_unset), and allow
    # an explicit null to CLEAR a genuinely-nullable field. A null on a required
    # field (name/color/status) is ignored rather than blanking it.
    sent = body.model_dump(exclude_unset=True)
    updates = {
        k: v for k, v in sent.items()
        if v is not None or k in _PROGRAM_NULLABLE
    }
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No fields to update",
        )
    for k in ("start_date", "target_end_date"):
        if k in updates and updates[k] is not None and hasattr(updates[k], "isoformat"):
            updates[k] = updates[k].isoformat()
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = sb.table("programs").update(updates).eq("id", program_id).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Program not found")
    return result.data[0]


@router.delete("/{program_id}", status_code=204)
def delete_program(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Delete a program. Only the owner, admin, or program lead may delete."""
    program = _get_program_or_404(sb, program_id)
    _require_program_admin_or_lead(sb, program, user["id"])
    sb.table("programs").delete().eq("id", program_id).execute()
    return None


# ── Rollup + Gantt ────────────────────────────────────────────────────────────

@router.get("/{program_id}/rollup")
def get_program_rollup(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Aggregate health & progress numbers for the program dashboard.

    Computed live from child initiatives + their open tasks. Returns:
      health, progress_pct, initiative_count {total, done, active, at_risk,
      overdue}, overdue_task_count, oldest_open_task {title, age_days}.
    """
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()

    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, start_date, target_end_date")
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .execute()
        .data
    )

    total = len(initiatives)
    done_states = {"done", "completed"}
    done = sum(1 for i in initiatives if i.get("status") in done_states)
    active = total - done

    at_risk = 0
    overdue_inits = 0
    no_dates = 0
    for init in initiatives:
        if init.get("status") in done_states:
            continue
        h = _derive_initiative_health(init, today)
        if h == "amber":
            at_risk += 1
        elif h == "red":
            overdue_inits += 1
        elif h == "not_started":
            no_dates += 1

    # Health: manual override wins, else derived from children.
    if program.get("manual_health"):
        health = program["manual_health"]
    elif total == 0 or (no_dates == total):
        health = "not_started"
    elif overdue_inits >= 2:
        health = "red"
    elif overdue_inits >= 1 or at_risk >= 1:
        health = "amber"
    else:
        health = "green"

    progress_pct = round((done / total) * 100) if total else 0

    # Overdue tasks across all child initiatives (open, past due).
    overdue_task_count = 0
    oldest_open: Optional[dict] = None
    if initiatives:
        init_ids = [i["id"] for i in initiatives]
        tasks = (
            sb.table("tasks")
            .select("id, title, status, due_date, created_at")
            .in_("initiative_id", init_ids)
            .neq("status", "done")
            .neq("status", "cancelled")
            .execute()
            .data
        )
        today_iso = today.isoformat()
        for t in tasks:
            if t.get("due_date") and t["due_date"] < today_iso:
                overdue_task_count += 1
        # Oldest open task by created_at
        tasks_with_age = [t for t in tasks if t.get("created_at")]
        if tasks_with_age:
            oldest = min(tasks_with_age, key=lambda t: t["created_at"])
            age = (today - date.fromisoformat(oldest["created_at"][:10])).days
            oldest_open = {"title": oldest.get("title") or "", "age_days": age}

    # P3 composite health (additive — the legacy date-only `health` above is
    # kept for back-compat; `composite_health` blends schedule + outcome +
    # throughput + blockers + staleness, which `health` ignored).
    risk = program_risk(sb, program, today)

    return {
        "health": health,
        "progress_pct": progress_pct,
        # Outcome progress (avg measurable key-result attainment) — distinct
        # from task/initiative completion. None when no measurable KRs exist.
        "outcome_pct": program_outcome_pct(sb, program_id),
        "initiative_count": {
            "total": total,
            "done": done,
            "active": active,
            "at_risk": at_risk,
            "overdue": overdue_inits,
        },
        "overdue_task_count": overdue_task_count,
        "oldest_open_task": oldest_open,
        # P3: composite signals. `composite_health` is the recommended health
        # for new UI; `risk_components` exposes the per-signal breakdown.
        "composite_health": risk["composite_health"],
        "composite_score": risk["composite_score"],
        "risk_components": risk["components"],
    }


@router.get("/{program_id}/risks")
def get_program_risks(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Composite health + ranked initiative risk for the program.

    Blends schedule + outcome% + throughput + blockers + staleness into one
    score, and returns the program's initiatives ordered worst-first with the
    specific reasons each is at risk — so a lead/founder sees *what to escalate*
    without reading every task. Visible to any member of the program's business.
    """
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()
    return {"program_id": program_id, **program_risk(sb, program, today)}


@router.get("/{program_id}/initiative-stats")
def get_initiative_stats(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """D1: per-initiative task rollup for the inline cards on the program page —
    total/done/open/overdue/blocked counts, completion % (done of active), the
    derived health dot, and staleness. One query per table; visible to any
    member of the program's business."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()

    initiatives = (
        sb.table("initiatives")
        .select("id, name, status, start_date, target_end_date")
        .eq("program_id", program_id).neq("status", "cancelled")
        .execute().data
    )
    init_ids = [i["id"] for i in initiatives]
    tasks_by_init: dict = {}
    if init_ids:
        rows = (
            sb.table("tasks")
            .select("id, status, due_date, updated_at, initiative_id")
            .in_("initiative_id", init_ids).execute().data
        )
        for t in rows:
            tasks_by_init.setdefault(t.get("initiative_id"), []).append(t)

    done_states = {"done", "completed"}
    out: list = []
    for i in initiatives:
        itasks = tasks_by_init.get(i["id"], [])
        done = sum(1 for t in itasks if t.get("status") in done_states)
        open_count, overdue, blocked, days_stale = _task_signals(itasks, today)
        active = done + open_count  # the denominator that ignores cancelled/archived
        out.append({
            "id": i["id"],
            "name": i.get("name"),
            "status": i.get("status"),
            "health": _derive_initiative_health(i, today),
            "total_tasks": len(itasks),
            "done_tasks": done,
            "open_tasks": open_count,
            "overdue_tasks": overdue,
            "blocked_tasks": blocked,
            "days_stale": days_stale,
            "completion_pct": round(done / active * 100) if active else None,
        })
    return {"stats": out}


@router.get("/{program_id}/accountability")
def get_program_accountability(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """P5: two accountability rollups for the program —
      • owners — per task primary-stakeholder: total / open / overdue / done +
        completion%, so a lead sees who is carrying (and overloaded by) the work.
      • sites  — per building/client (via task_entities.per_entity_status): how
        each site is tracking, for a multi-site operator's per-location view.
    Member-read gated; additive (reads existing tables)."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today_iso = date.today().isoformat()

    init_ids = [
        i["id"] for i in sb.table("initiatives").select("id")
        .eq("program_id", program_id).neq("status", "cancelled").execute().data
    ]
    tasks: list = []
    if init_ids:
        tasks = (
            sb.table("tasks")
            .select("id, status, due_date, primary_stakeholder_id")
            .in_("initiative_id", init_ids).execute().data
        )

    done_states = {"done", "completed"}

    # ── owners ──────────────────────────────────────────────────────────────
    owner_agg: dict = {}
    for t in tasks:
        uid = t.get("primary_stakeholder_id")
        if not uid:
            continue
        a = owner_agg.setdefault(uid, {"total": 0, "done": 0, "open": 0, "overdue": 0})
        a["total"] += 1
        st = t.get("status")
        if st in done_states:
            a["done"] += 1
        elif st not in _OPEN_TASK_EXCLUDE:
            a["open"] += 1
            if t.get("due_date") and t["due_date"] < today_iso:
                a["overdue"] += 1

    names: dict = {}
    if owner_agg:
        for u in sb.table("users").select("id, name").in_("id", list(owner_agg)).execute().data:
            names[u["id"]] = u.get("name") or ""
    owners = []
    for uid, a in owner_agg.items():
        active = a["done"] + a["open"]
        owners.append({
            "user_id": uid, "name": names.get(uid) or "Unknown",
            **a, "completion_pct": round(a["done"] / active * 100) if active else None,
        })
    # Most-loaded / most-at-risk first.
    owners.sort(key=lambda o: (-o["overdue"], -o["open"], -o["total"]))

    # ── sites (per building/client) ─────────────────────────────────────────
    task_ids = [t["id"] for t in tasks]
    task_due = {t["id"]: t.get("due_date") for t in tasks}
    ents: list = []
    if task_ids:
        ents = (
            sb.table("task_entities")
            .select("task_id, entity_type, entity_id, per_entity_status, per_entity_end_date")
            .in_("task_id", task_ids).execute().data
        )
    site_agg: dict = {}
    for e in ents:
        key = (e.get("entity_type"), e.get("entity_id"))
        a = site_agg.setdefault(key, {"total": 0, "done": 0, "open": 0, "overdue": 0})
        a["total"] += 1
        if e.get("per_entity_status") == "done":
            a["done"] += 1
        else:
            a["open"] += 1
            due = e.get("per_entity_end_date") or task_due.get(e.get("task_id"))
            if due and due < today_iso:
                a["overdue"] += 1

    b_ids = [eid for (et, eid) in site_agg if et == "building"]
    c_ids = [eid for (et, eid) in site_agg if et == "client"]
    ent_name: dict = {}
    if b_ids:
        for r in sb.table("buildings").select("id, name").in_("id", b_ids).execute().data:
            ent_name[r["id"]] = r.get("name") or ""
    if c_ids:
        for r in sb.table("clients").select("id, name").in_("id", c_ids).execute().data:
            ent_name[r["id"]] = r.get("name") or ""
    sites = []
    for (et, eid), a in site_agg.items():
        active = a["done"] + a["open"]
        sites.append({
            "entity_type": et, "entity_id": eid,
            "name": ent_name.get(eid) or "(unnamed)",
            **a, "completion_pct": round(a["done"] / active * 100) if active else None,
        })
    sites.sort(key=lambda s: (-s["overdue"], -s["open"], -s["total"]))

    return {"owners": owners, "sites": sites}


@router.get("/{program_id}/gantt")
def get_program_gantt(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return one Gantt row per child initiative for the program-level timeline.

    Each row carries the initiative's own dates + a derived health dot so the
    frontend can render bars without recomputing.
    """
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    today = date.today()

    initiatives = (
        sb.table("initiatives")
        .select(
            "id, name, status, start_date, target_end_date, "
            "primary_stakeholder_id, impact_category"
        )
        .eq("program_id", program_id)
        .neq("status", "cancelled")
        .order("created_at")
        .execute()
        .data
    )

    # Resolve stakeholder names in bulk.
    sh_ids = list({i["primary_stakeholder_id"] for i in initiatives if i.get("primary_stakeholder_id")})
    name_map: dict = {}
    if sh_ids:
        rows = sb.table("users").select("id, name").in_("id", sh_ids).execute().data
        name_map = {r["id"]: r.get("name") or "" for r in rows}

    rows = []
    for init in initiatives:
        rows.append({
            "id": init["id"],
            "title": init["name"],
            "status": init.get("status"),
            "start_date": init.get("start_date"),
            "end_date": init.get("target_end_date"),
            "primary_stakeholder_id": init.get("primary_stakeholder_id"),
            "primary_stakeholder_name": name_map.get(init.get("primary_stakeholder_id") or "", ""),
            "impact_category": init.get("impact_category"),
            "health": _derive_initiative_health(init, today),
        })

    return {
        "program": {
            "id": program["id"],
            "name": program["name"],
            "start_date": program.get("start_date"),
            "end_date": program.get("target_end_date"),
            "color": program.get("color"),
        },
        "rows": rows,
    }


# ── Program followers (P1 cascade) ────────────────────────────────────────────
# Program followers are read-only viewers at the apex of the visibility
# pyramid: follow a program -> see every initiative under it (and via the
# task cascade, every task/subtask). Add/remove gated to workspace owner/
# admin, mirroring initiative_followers (033).


class _ProgramFollowerAdd(BaseModel):
    user_id: str


@router.get("/{program_id}/followers")
def list_program_followers(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """List followers of a program. Any business member can view the roster
    so people know who else has read access."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])

    rows = (
        sb.table("program_followers")
        .select("user_id, added_by, added_at")
        .eq("program_id", program_id)
        .execute()
        .data
    )
    user_ids = list({r["user_id"] for r in rows})
    name_map: dict = {}
    email_map: dict = {}
    if user_ids:
        users = sb.table("users").select("id, name, email").in_("id", user_ids).execute().data
        name_map = {u["id"]: u.get("name") or "" for u in users}
        email_map = {u["id"]: u.get("email") or "" for u in users}
    return [
        {
            "user_id": r["user_id"],
            "name": name_map.get(r["user_id"], ""),
            "email": email_map.get(r["user_id"], ""),
            "added_by": r.get("added_by"),
            "added_at": r.get("added_at"),
        }
        for r in rows
    ]


@router.post("/{program_id}/followers", status_code=201)
def add_program_follower(
    program_id: str,
    body: _ProgramFollowerAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Add a follower. Workspace owner/admin only — mirrors the initiative
    follower gate so only admins can grant read access."""
    program = _get_program_or_404(sb, program_id)
    require_admin_or_owner(sb, program["business_id"], user["id"])

    if get_member_role(sb, program["business_id"], body.user_id) is None:
        raise HTTPException(
            status_code=400,
            detail="user_id must be a member of this workspace",
        )

    sb.table("program_followers").upsert(
        {
            "program_id": program_id,
            "user_id": body.user_id,
            "added_by": user["id"],
        },
        on_conflict="program_id,user_id",
    ).execute()
    return {"ok": True}


@router.delete("/{program_id}/followers/{user_id}", status_code=204)
def remove_program_follower(
    program_id: str,
    user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Remove a follower. Workspace owner/admin only."""
    program = _get_program_or_404(sb, program_id)
    require_admin_or_owner(sb, program["business_id"], user["id"])

    sb.table("program_followers").delete().eq(
        "program_id", program_id
    ).eq("user_id", user_id).execute()


# ── P1: Key results (measurable outcomes) ──────────────────────────────────────

@router.get("/{program_id}/key-results")
def list_key_results(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Key results for a program, each with computed progress (0..100)."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    rows = (
        sb.table("program_key_results").select("*")
        .eq("program_id", program_id).order("sort_order").order("created_at").execute().data
    )
    for r in rows:
        p = kr_progress(r)
        r["progress_pct"] = round(p * 100) if p is not None else None
    return rows


@router.post("/{program_id}/key-results", status_code=201)
def create_key_result(
    program_id: str,
    body: KeyResultIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    row = sb.table("program_key_results").insert({
        "program_id": program_id,
        "business_id": program["business_id"],
        "title": body.title, "unit": body.unit,
        "baseline": body.baseline, "target": body.target, "current": body.current,
        "direction": body.direction, "sort_order": body.sort_order,
    }).execute().data
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create key result")
    out = row[0]
    p = kr_progress(out)
    out["progress_pct"] = round(p * 100) if p is not None else None
    return out


@router.patch("/{program_id}/key-results/{kr_id}")
def update_key_result(
    program_id: str,
    kr_id: str,
    body: KeyResultPatch,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    # N12: allow clearing a measurable field (unit/baseline/target/current) by
    # sending it as null — e.g. un-setting a target. Required fields
    # (title/direction/sort_order) are never blanked by a null.
    sent = body.model_dump(exclude_unset=True)
    patch = {k: v for k, v in sent.items() if v is not None or k in _KR_NULLABLE}
    if not patch:
        raise HTTPException(status_code=422, detail="No fields to update")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    row = (
        sb.table("program_key_results").update(patch)
        .eq("id", kr_id).eq("program_id", program_id).execute().data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Key result not found")
    out = row[0]
    p = kr_progress(out)
    out["progress_pct"] = round(p * 100) if p is not None else None
    return out


@router.delete("/{program_id}/key-results/{kr_id}", status_code=204)
def delete_key_result(
    program_id: str,
    kr_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    sb.table("program_key_results").delete().eq("id", kr_id).eq("program_id", program_id).execute()


# ── P2: Status updates + health-over-time trend ────────────────────────────────

@router.get("/{program_id}/updates")
def list_program_updates(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Status-update log (RAG + narrative), newest first, with author names."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    rows = (
        sb.table("program_updates").select("*")
        .eq("program_id", program_id).order("created_at", desc=True).limit(50).execute().data
    )
    author_ids = sorted({r["author_id"] for r in rows if r.get("author_id")})
    names: dict = {}
    if author_ids:
        for u in sb.table("users").select("id, name").in_("id", author_ids).execute().data:
            names[u["id"]] = u.get("name") or ""
    for r in rows:
        r["author_name"] = names.get(r.get("author_id"), "")
    return rows


@router.post("/{program_id}/updates", status_code=201)
def create_program_update(
    program_id: str,
    body: ProgramStatusUpdateIn,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Post a status update. Also sets the program's manual_health so the RAG
    the lead reports is reflected on the dashboard immediately."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    row = sb.table("program_updates").insert({
        "program_id": program_id,
        "business_id": program["business_id"],
        "author_id": user["id"],
        "status": body.status, "summary": body.summary,
    }).execute().data
    if not row:
        raise HTTPException(status_code=500, detail="Failed to post update")
    # The lead's stated RAG becomes the program's health until the next update.
    sb.table("programs").update(
        {"manual_health": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", program_id).execute()
    out = row[0]
    out["author_name"] = ""
    return out


@router.get("/{program_id}/trend")
def get_program_trend(
    program_id: str,
    days: int = 90,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Daily health/progress/outcome snapshots for the trend chart (written by
    the automation cron). Oldest→newest, limited to the last `days`."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    since = (date.today() - timedelta(days=max(1, min(days, 365)))).isoformat()
    rows = (
        sb.table("program_snapshots").select(
            "snapshot_date, health, progress_pct, outcome_pct, overdue_tasks, initiatives_total, initiatives_done"
        )
        .eq("program_id", program_id).gte("snapshot_date", since)
        .order("snapshot_date").execute().data
    )
    return rows


# ── D4: AI program summary ──────────────────────────────────────────────────
# The program level has no manual work doc — this generated narrative is its
# synthesis, rolled up from the initiative work docs + the live rollup/risk
# numbers (see ai/program_summary.py). Read is member-wide; regenerate is gated
# to owner/admin/lead (N3), and 503s when the AI integration isn't configured.

def _shape_ai_summary(sb: Client, row: dict) -> dict:
    name = ""
    if row.get("generated_by"):
        u = sb.table("users").select("name").eq("id", row["generated_by"]).execute().data
        if u:
            name = u[0].get("name") or ""
    return {**row, "generated_by_name": name}


@router.get("/{program_id}/ai-summary")
def get_program_ai_summary(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Latest AI summary for the program (or null if never generated). Visible to
    any member; also reports whether the AI integration is configured so the UI
    can show the right empty state. Degrades to null if 048 is absent."""
    program = _get_program_or_404(sb, program_id)
    require_member(sb, program["business_id"], user["id"])
    try:
        rows = (
            sb.table("program_ai_summaries").select("*")
            .eq("program_id", program_id)
            .order("generated_at", desc=True).limit(1).execute().data
        )
    except Exception:
        rows = []
    summary = _shape_ai_summary(sb, rows[0]) if rows else None
    return {
        "summary": summary,
        "configured": program_summary.is_configured(sb, program["business_id"]),
    }


@router.post("/{program_id}/ai-summary", status_code=201)
def regenerate_program_ai_summary(
    program_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Generate a fresh AI summary from the program's current signals and store
    it. Gated to owner/admin/lead (N3). 503 when AI is unconfigured; 502 if the
    model returns nothing."""
    program = _get_program_or_404(sb, program_id)
    _require_program_admin_or_lead(sb, program, user["id"])
    config = program_summary.resolve_config(sb, program["business_id"])
    if not config:
        raise HTTPException(status_code=503, detail="AI summaries are not configured")

    today = date.today()
    context = program_summary.gather_program_context(sb, program, today)
    body = program_summary.generate_summary(context, config)
    if not body:
        raise HTTPException(status_code=502, detail="Could not generate a summary")

    rows = sb.table("program_ai_summaries").insert({
        "program_id": program_id,
        "business_id": program["business_id"],
        "body": body,
        "model": program_summary.effective_model(config),
        "health": context["health"]["composite"],
        "inputs": context,
        "generated_by": user["id"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }).execute().data
    if not rows:
        raise HTTPException(status_code=500, detail="Failed to save summary")
    return {"summary": _shape_ai_summary(sb, rows[0]), "configured": True}
