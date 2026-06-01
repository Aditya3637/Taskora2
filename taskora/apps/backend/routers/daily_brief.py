import time
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from supabase import Client
from auth import get_current_user
from deps import get_supabase
from routers._decision_context import enrich_task_items

router = APIRouter(prefix="/api/v1/daily-brief", tags=["daily_brief"])

# A row is "breaching" if it has clearly slipped past a reasonable bar. Kept
# deliberately simple/explicit so the number is trustworthy at a glance.
_TAT_OVERDUE_DAYS = 7
_STALE_DAYS = 7

# Per-user response cache. Daily Brief is expensive (15+ Supabase round
# trips, ~1.2s cold / 0.7s warm) and re-rendered on every page focus by
# the FE's auto-refresh. A 60s TTL absorbs cold-start / transient blips
# without hiding meaningful state changes (a user who marks something done
# sees their own change immediately because we invalidate on writes? —
# no, we don't, so the cache window is the trade-off). In-memory means
# each Vercel function instance has its own cache; cross-instance
# coherence would require Redis.
_BRIEF_CACHE_TTL_SECONDS = 60
_brief_cache: dict[tuple, tuple[float, dict]] = {}


def _cache_get(key: tuple) -> Optional[dict]:
    entry = _brief_cache.get(key)
    if not entry:
        return None
    when, payload = entry
    if time.time() - when > _BRIEF_CACHE_TTL_SECONDS:
        _brief_cache.pop(key, None)
        return None
    return payload


def _cache_set(key: tuple, payload: dict) -> None:
    # Keep the dict small — evict aggressively on overflow. 256 entries
    # ≈ 64 distinct users × 4 scope/group combos, comfortable for a
    # single function instance.
    if len(_brief_cache) > 256:
        _brief_cache.clear()
    _brief_cache[key] = (time.time(), payload)


def invalidate_brief_cache() -> None:
    """Drop every cached brief. Called by task mutations so a due-date /
    status / assignment change is reflected immediately instead of after the
    60s TTL — otherwise overdue / TAT-breach counts keep showing the value
    from before the edit (e.g. a moved due date appears 'still overdue')."""
    _brief_cache.clear()

# Sort key shared by every bucket — urgent + most-overdue first so the worst
# items rise. Anything not in the priority map sorts as 0 (last).
_PRIORITY_RANK = {"critical": 4, "urgent": 3, "high": 2, "medium": 1, "low": 0}


def _task_severity(t: dict) -> tuple:
    """Higher tuple = more urgent. Stable secondary sort by created_at desc
    so the newest task wins between ties."""
    return (
        _PRIORITY_RANK.get(t.get("priority") or "", 0),
        t.get("days_overdue") or 0,
        t.get("created_at") or "",
    )


def _sort_bucket(items: list) -> list:
    return sorted(items, key=_task_severity, reverse=True)


def _pick_hero(
    pending_decisions: list,
    awaiting_approval: list,
    overdue: list,
    blocked: list,
) -> dict | None:
    """Choose the single most actionable item for the user. Order of
    consideration matches the user's decision flow: explicit decisions first,
    approvals second (someone is waiting), then overdue (slipping commitments),
    then blocked. Within each bucket we already pre-sorted by severity, so
    the head of each list is the best candidate."""
    for label, src in (
        ("decision", pending_decisions),
        ("approval", awaiting_approval),
        ("overdue", overdue),
        ("blocked", blocked),
    ):
        if src:
            t = src[0]
            return {
                "reason": label,
                "task_id": t["id"],
                "title": t.get("title"),
                "priority": t.get("priority"),
                "status": t.get("status"),
                "days_overdue": t.get("days_overdue") or 0,
                "initiative_name": t.get("initiative_name"),
                "program_name": t.get("program_name"),
                "primary_stakeholder_name": t.get("primary_stakeholder_name"),
                "approval_state": t.get("approval_state"),
                "link": t.get("link"),
            }
    return None


def _people_rollup(sb: Client, tasks: list, today_str: str, init_meta: dict) -> list:
    """Per-person counts for the team-scope view. A task contributes to a
    person if they're its primary OR a secondary/tertiary stakeholder OR
    they own the initiative it sits under — so the rollup is each person's
    full accountable bucket, not just tasks where they're the primary owner.
    Names resolved in one batched query (no N+1)."""
    by_uid: dict = {}

    def _bump(uid: str, t: dict) -> None:
        g = by_uid.setdefault(uid, {
            "user_id": uid, "name": "",
            "open": 0, "overdue": 0, "awaiting_approval": 0, "blocked": 0,
        })
        st = t.get("status")
        if st not in ("done", "archived", "cancelled"):
            g["open"] += 1
        if (t.get("due_date") or "") < today_str and st not in ("done", "archived"):
            g["overdue"] += 1
        if t.get("approval_state") == "pending":
            g["awaiting_approval"] += 1
        if st == "blocked":
            g["blocked"] += 1

    for t in tasks:
        owners: set = set()
        if t.get("primary_stakeholder_id"):
            owners.add(t["primary_stakeholder_id"])
        for s in (t.get("task_stakeholders") or []):
            if s.get("user_id"):
                owners.add(s["user_id"])
        im = init_meta.get(t.get("initiative_id") or "")
        if im and im.get("owner_id"):
            owners.add(im["owner_id"])
        for uid in owners:
            _bump(uid, t)

    # Resolve every contributing person's name in one query (owners now
    # include non-primary people the enrich pass didn't name).
    uids = list(by_uid.keys())
    if uids:
        rows = sb.table("users").select("id, name").in_("id", uids).execute().data
        nm = {r["id"]: r.get("name") or "" for r in rows}
        for uid, g in by_uid.items():
            g["name"] = nm.get(uid, "")
    return sorted(
        by_uid.values(),
        key=lambda g: (-g["overdue"], -g["awaiting_approval"], -g["open"], g["name"]),
    )


def _resolve_entity_names(sb: Client, task_entities: list) -> list:
    """Replace entity_id UUIDs with entity_name strings."""
    building_ids = [e["entity_id"] for e in task_entities if e.get("entity_type") == "building"]
    client_ids   = [e["entity_id"] for e in task_entities if e.get("entity_type") == "client"]
    name_map = {}
    if building_ids:
        rows = sb.table("buildings").select("id, name").in_("id", building_ids).execute().data
        for r in rows: name_map[r["id"]] = r["name"]
    if client_ids:
        rows = sb.table("clients").select("id, name").in_("id", client_ids).execute().data
        for r in rows: name_map[r["id"]] = r["name"]
    for e in task_entities:
        e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
    return task_entities


@router.get("")
def get_daily_brief(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
    scope: str = Query("mine", pattern="^(mine|team)$"),
    initiative: Optional[str] = None,
    program: Optional[str] = None,
    owner: Optional[str] = None,
    group_by: str = Query("none", pattern="^(none|initiative|program)$"),
    business_id: Optional[str] = Query(default=None, description="Scope to a single workspace. When omitted, defaults to every workspace the user is a member of (legacy behaviour)."),
):
    """One screen to decide from.

    `scope=mine` (default) = tasks where the caller is primary/stakeholder
    (legacy behaviour). `scope=team` = every task across the businesses the
    caller belongs to (the leader/portfolio view). `initiative`/`program`/
    `owner` narrow it; `group_by` adds a rollup alongside the flat buckets.
    `business_id` scopes the brief to a single workspace — without it a
    multi-workspace member would silently see pooled data from every
    workspace they belong to (the original Hitesh report).
    """
    uid = user["id"]
    today = date.today()
    today_str = today.isoformat()

    # Cache key includes business_id so a workspace switch invalidates.
    cache_key = (id(sb), uid, scope, business_id, initiative, program, owner, group_by, today_str)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    week_out = (today + timedelta(days=7)).isoformat()
    stale_threshold = (today - timedelta(days=_STALE_DAYS)).isoformat()

    biz_rows = sb.table("business_members").select("business_id").eq("user_id", uid).execute().data
    biz_ids = [r["business_id"] for r in biz_rows]
    # Active-workspace scoping. If the FE passes a business_id the user is
    # a member of, narrow biz_ids to just that one so the brief reflects
    # only the workspace they're currently looking at.
    if business_id and business_id in biz_ids:
        biz_ids = [business_id]

    # initiative_id -> {business_id, program_id, name} for filtering + grouping
    init_meta: dict = {}
    if biz_ids:
        for r in (
            sb.table("initiatives")
            .select("id, name, business_id, program_id, owner_id")
            .in_("business_id", biz_ids)
            .execute()
            .data
        ):
            init_meta[r["id"]] = r

    if scope == "team":
        scoped_ids = sorted(init_meta.keys())
        all_task_ids = [
            r["id"]
            for r in (
                sb.table("tasks").select("id").in_("initiative_id", scoped_ids).execute().data
                if scoped_ids else []
            )
        ]
    else:
        primary_ids: List[str] = [
            r["id"]
            for r in sb.table("tasks").select("id").eq("primary_stakeholder_id", uid).execute().data
        ]
        secondary_ids: List[str] = [
            r["task_id"]
            for r in sb.table("task_stakeholders").select("task_id").eq("user_id", uid).execute().data
        ]
        all_task_ids = list(set(primary_ids + secondary_ids))
        # Multi-workspace fix: a user's primary/stakeholder rows are
        # workspace-agnostic, so without this filter the brief would pool
        # tasks across every workspace they belong to — exactly what
        # surfaced as "Workspace 1's data showing in Workspace 2". Drop
        # any task whose initiative isn't in the active workspace's
        # init_meta. Tasks with NULL initiative_id (legacy / unlinked) are
        # also dropped because they have no workspace anchor — they'd
        # otherwise appear in every workspace.
        if all_task_ids:
            scoped_init_ids = set(init_meta.keys())
            owned_tasks_meta = (
                sb.table("tasks")
                .select("id, initiative_id")
                .in_("id", all_task_ids)
                .execute()
                .data
            )
            all_task_ids = [
                t["id"]
                for t in owned_tasks_meta
                if t.get("initiative_id") in scoped_init_ids
            ]

    # Single full fetch for everything in scope, then partition + enrich once
    # (was 5 separate full-table fetches).
    rows: list = []
    if all_task_ids:
        rows = (
            sb.table("tasks")
            .select("*, task_entities(*), task_stakeholders(*)")
            .in_("id", all_task_ids)
            .execute()
            .data
        )

    # Filters (initiative / program / owner)
    def _keep(t: dict) -> bool:
        im = init_meta.get(t.get("initiative_id") or "")
        if initiative and t.get("initiative_id") != initiative:
            return False
        if program and (not im or im.get("program_id") != program):
            return False
        if owner:
            # Complete view of a person's work: primary OR a
            # secondary/tertiary stakeholder OR they own the initiative the
            # task sits under (owners are accountable for everything in it).
            on_task = (
                t.get("primary_stakeholder_id") == owner
                or any(s.get("user_id") == owner
                       for s in (t.get("task_stakeholders") or []))
                or bool(im and im.get("owner_id") == owner)
            )
            if not on_task:
                return False
        return True

    rows = [t for t in rows if _keep(t)]

    for t in rows:
        t["task_entities"] = _resolve_entity_names(sb, t.get("task_entities") or [])
    enrich_task_items(sb, rows)

    def bucket(pred) -> list:
        return [t for t in rows if pred(t)]

    open_states = lambda s: s not in ("done", "archived", "cancelled")
    pending_decisions = _sort_bucket(bucket(lambda t: t["status"] == "pending_decision"))
    overdue_tasks     = _sort_bucket(bucket(lambda t: (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived")))
    stale_tasks       = _sort_bucket(bucket(lambda t: (t.get("updated_at") or "") < stale_threshold and t["status"] not in ("done", "archived")))
    due_this_week     = _sort_bucket(bucket(lambda t: today_str <= (t.get("due_date") or "") <= week_out))
    blocked_tasks     = _sort_bucket(bucket(lambda t: t["status"] == "blocked"))
    awaiting_approval = _sort_bucket(bucket(lambda t: t.get("approval_state") == "pending"))

    def _is_breach(t: dict) -> bool:
        if t.get("days_overdue", 0) > _TAT_OVERDUE_DAYS:
            return True
        if t["status"] == "blocked" and (t.get("updated_at") or "") < stale_threshold:
            return True
        if t.get("approval_state") == "pending" and (t.get("closed_at") or "") and \
           (t.get("closed_at") or "")[:10] < (today - timedelta(days=3)).isoformat():
            return True
        return False
    tat_breaches = _sort_bucket(bucket(_is_breach))

    # Tag the underlying task dicts so the row UI can show a "TAT breach" /
    # "stale" chip wherever the task appears (the same object is shared
    # across buckets, so this marks it everywhere it's rendered).
    for t in tat_breaches:
        t["is_tat_breach"] = True
    for t in stale_tasks:
        t["is_stale"] = True

    # Hero "pick one" — single most-actionable item the user should tackle
    # now, computed after sort so each list's head is the worst case.
    top_pick = _pick_hero(
        pending_decisions=pending_decisions,
        awaiting_approval=awaiting_approval,
        overdue=overdue_tasks,
        blocked=blocked_tasks,
    )

    # Per-person rollup only meaningful when viewing the whole team. Skipped
    # for `mine` because every row belongs to the caller anyway.
    people_rollup = _people_rollup(sb, rows, today_str, init_meta) if scope == "team" else []

    # Workspace-wide options so the Daily Brief filter dropdowns can list
    # every program / member, not just those that happen to have tasks in
    # the current visible buckets (the source of the "missing programs in
    # the dropdown" report).
    workspace_programs: list = []
    workspace_members: list = []
    if biz_ids:
        for p in (
            sb.table("programs")
            .select("id, name")
            .in_("business_id", biz_ids)
            .order("name")
            .execute()
            .data
        ):
            workspace_programs.append({"id": p["id"], "name": p["name"]})
        member_uids = sorted({
            r["user_id"]
            for r in sb.table("business_members")
            .select("user_id")
            .in_("business_id", biz_ids)
            .execute()
            .data
        })
        if member_uids:
            for u in (
                sb.table("users")
                .select("id, name")
                .in_("id", member_uids)
                .execute()
                .data
            ):
                workspace_members.append({"user_id": u["id"], "name": u.get("name") or ""})
            workspace_members.sort(key=lambda m: (m["name"] or "").lower())

    # Dormant initiatives are computed after the initiative_progress block
    # below where `inits` + `tasks_by_init` are populated.
    dormant_initiatives: list = []

    # Quick stats (over the in-scope, filtered set)
    open_count = sum(1 for t in rows if open_states(t["status"]))
    since_week = stale_threshold
    done_this_week = sum(1 for t in rows if t["status"] == "done" and (t.get("updated_at") or "") >= since_week)
    total_non_done = sum(1 for t in rows if t["status"] not in ("done", "archived"))
    completion_rate = round(done_this_week / total_non_done * 100) if total_non_done else 0

    # Initiative progress (active initiatives in caller's businesses)
    def _init_in_scope(im: dict) -> bool:
        # Scope the Initiative Progress + Dormant sections to the active
        # filters — when filtering by a person, only the initiatives they
        # own or are primary stakeholder of (their accountability), not the
        # whole workspace. Mirrors the task-bucket filtering above.
        if initiative and im["id"] != initiative:
            return False
        if program and im.get("program_id") != program:
            return False
        if owner and im.get("owner_id") != owner \
                and im.get("primary_stakeholder_id") != owner:
            return False
        return True

    initiative_progress = []
    if biz_ids:
        inits = (
            sb.table("initiatives")
            .select("id, name, status, program_id, owner_id, primary_stakeholder_id")
            .in_("business_id", biz_ids)
            .eq("status", "active")
            .execute()
            .data
        )
        inits = [i for i in inits if _init_in_scope(i)]
        prog_ids = sorted({i["program_id"] for i in inits if i.get("program_id")})
        prog_names: dict = {}
        if prog_ids:
            for r in sb.table("programs").select("id, name").in_("id", prog_ids).execute().data:
                prog_names[r["id"]] = r["name"]
        # One batched fetch for every active initiative's tasks instead of a
        # query-per-initiative (the previous N+1 — the dominant Daily Brief
        # cost when a workspace had many active initiatives). updated_at is
        # included so we can flag dormant initiatives below.
        all_init_ids = [i["id"] for i in inits]
        tasks_by_init: dict = {}
        if all_init_ids:
            for r in (
                sb.table("tasks")
                .select("id, status, due_date, approval_state, initiative_id, updated_at")
                .in_("initiative_id", all_init_ids)
                .execute()
                .data
            ):
                tasks_by_init.setdefault(r["initiative_id"], []).append(r)
        for init in inits:
            it_rows = tasks_by_init.get(init["id"], [])
            it_total = len(it_rows)
            it_done  = sum(1 for t in it_rows if t["status"] == "done")
            initiative_progress.append({
                "id": init["id"],
                "title": init["name"],
                "name": init["name"],
                "program_id": init.get("program_id"),
                "program_name": prog_names.get(init.get("program_id") or ""),
                "completion_pct": round(it_done / it_total * 100) if it_total else 0,
                "total_tasks": it_total,
                "done_tasks": it_done,
                "blocked": sum(1 for t in it_rows if t["status"] == "blocked"),
                "overdue": sum(1 for t in it_rows if (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived")),
                "awaiting_approval": sum(1 for t in it_rows if t.get("approval_state") == "pending"),
                "entity_breakdown": [],
                "link": {"type": "initiative", "task_id": None, "subtask_id": None,
                         "initiative_id": init["id"], "program_id": init.get("program_id")},
            })

        # Dormant initiatives — active initiatives that have either zero
        # tasks OR no task updated in the last 14 days. Surfaces strategic
        # gaps the rest of the brief (which only shows tasks that exist)
        # would otherwise hide. Reuses inits + tasks_by_init from above.
        dormant_cutoff = (today - timedelta(days=14)).isoformat()
        for init in inits:
            it_rows = tasks_by_init.get(init["id"], [])
            link = {
                "type": "initiative",
                "task_id": None,
                "subtask_id": None,
                "initiative_id": init["id"],
                "program_id": init.get("program_id"),
            }
            if not it_rows:
                dormant_initiatives.append({
                    "id": init["id"],
                    "name": init["name"],
                    "program_id": init.get("program_id"),
                    "program_name": prog_names.get(init.get("program_id") or ""),
                    "reason": "no_tasks",
                    "last_update": None,
                    "link": link,
                })
                continue
            latest_update = max((t.get("updated_at") or "") for t in it_rows)
            if latest_update[:10] < dormant_cutoff:
                dormant_initiatives.append({
                    "id": init["id"],
                    "name": init["name"],
                    "program_id": init.get("program_id"),
                    "program_name": prog_names.get(init.get("program_id") or ""),
                    "reason": "stale",
                    "last_update": latest_update[:10] if latest_update else None,
                    "link": link,
                })

    # Optional rollup grouping over the in-scope, filtered tasks
    groups = []
    if group_by != "none":
        key = "program_id" if group_by == "program" else "initiative_id"
        agg: dict = {}
        for t in rows:
            gid = t.get(key)
            if not gid:
                continue
            g = agg.setdefault(gid, {
                "id": gid, "group_by": group_by, "open": 0, "overdue": 0,
                "blocked": 0, "pending_decision": 0, "awaiting_approval": 0,
            })
            if open_states(t["status"]):
                g["open"] += 1
            if (t.get("due_date") or "") < today_str and t["status"] not in ("done", "archived"):
                g["overdue"] += 1
            if t["status"] == "blocked":
                g["blocked"] += 1
            if t["status"] == "pending_decision":
                g["pending_decision"] += 1
            if t.get("approval_state") == "pending":
                g["awaiting_approval"] += 1
        for gid, g in agg.items():
            if group_by == "program":
                g["name"] = next((init_meta[i]["name"] for i in init_meta
                                   if init_meta[i].get("program_id") == gid), None)
                g["link"] = {"type": "program", "task_id": None, "subtask_id": None,
                             "initiative_id": None, "program_id": gid}
            else:
                im = init_meta.get(gid, {})
                g["name"] = im.get("name")
                g["link"] = {"type": "initiative", "task_id": None, "subtask_id": None,
                             "initiative_id": gid, "program_id": im.get("program_id")}
            groups.append(g)

    response = {
        "user_id": uid,
        "generated_at": today_str,
        "scope": scope,
        "filters": {"initiative": initiative, "program": program, "owner": owner},
        "pending_decisions": pending_decisions,
        "overdue_tasks": overdue_tasks,
        "stale_tasks": stale_tasks,
        "due_this_week": due_this_week,
        "blocked_tasks": blocked_tasks,
        "awaiting_approval": awaiting_approval,
        "tat_breaches": tat_breaches,
        "initiative_progress": initiative_progress,
        "groups": groups,
        "top_pick": top_pick,
        "people_rollup": people_rollup,
        "workspace_programs": workspace_programs,
        "workspace_members": workspace_members,
        "dormant_initiatives": dormant_initiatives,
        "quick_stats": {
            "open_tasks": open_count,
            "completion_rate_this_week": completion_rate,
            # Raw count so the UI can render "3 done this week" instead of
            # the previously-ambiguous "X%" that mixed done-this-week with
            # currently-open.
            "done_this_week_count": done_this_week,
            "stale_count": len(stale_tasks),
            "awaiting_approval_count": len(awaiting_approval),
            "tat_breach_count": len(tat_breaches),
        },
        "greeting": {
            "summary_line": (
                f"You have {len(pending_decisions)} decisions pending, "
                f"{len(overdue_tasks)} overdue, and {len(awaiting_approval)} awaiting approval."
            ),
        },
    }
    _cache_set(cache_key, response)
    return response
