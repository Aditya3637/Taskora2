from typing import List, Literal, Optional
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from supabase import Client
from pydantic import BaseModel
from auth import get_current_user
from deps import (
    get_supabase,
    get_member_role,
    require_member,
    is_admin_or_owner,
    writable_initiative_ids,
    visible_initiative_ids,
)
from notifications import send_push_to_user

def _bust_brief_cache_on_write(request: Request) -> None:
    """Any write to a task (create / update / status / due-date / subtask /
    entity / comment / etc.) invalidates the cached Daily Brief, so overdue
    and TAT-breach figures recompute from the new state on the next read
    instead of lingering on the pre-edit value for up to the 60s TTL."""
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        from routers.daily_brief import invalidate_brief_cache
        invalidate_brief_cache()


router = APIRouter(
    prefix="/api/v1/tasks",
    tags=["tasks"],
    dependencies=[Depends(_bust_brief_cache_on_write)],
)


def _parallel(*thunks):
    """Run independent zero-arg DB thunks concurrently; results in input order.

    Supabase calls are blocking HTTP round-trips. FastAPI already runs this
    sync endpoint in a worker thread, and the underlying httpx client is
    thread-safe for concurrent requests, so fanning a set of *independent*
    queries across a small pool turns N serial round-trips into ~1 wall-clock
    round-trip. Only pass thunks with no data dependency on each other.
    """
    if not thunks:
        return []
    if len(thunks) == 1:
        return [thunks[0]()]
    with ThreadPoolExecutor(max_workers=min(len(thunks), 8)) as ex:
        futs = [ex.submit(t) for t in thunks]
        return [f.result() for f in futs]

# Valid status values shared by task-level and per-entity updates.
# Source of truth — matches the CHECK constraint on tasks.status (migration 002)
# and the constraint on task_entities.per_entity_status (also migration 002,
# minus 'archived' which only applies at the task level).
_TASK_STATUSES = Literal[
    "backlog",
    "todo",
    "in_progress",
    "pending_decision",
    "blocked",
    "done",
    "archived",
    "reopened",
]

# Status values valid on subtasks and entity-scoped rows (no 'archived').
_SUBTASK_STATUSES = Literal[
    "backlog",
    "todo",
    "in_progress",
    "pending_decision",
    "blocked",
    "done",
    "reopened",
]


class TaskEntityCreate(BaseModel):
    entity_type: Literal["building", "client"]
    entity_id: str
    per_entity_start_date: Optional[date] = None
    per_entity_end_date: Optional[date] = None


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    initiative_id: Optional[str] = None
    primary_stakeholder_id: str
    # Must match the DB CHECK constraints (migration 002):
    #   priority IN (low, medium, high, urgent)
    #   entity_inheritance IN (inherited, overridden)
    priority: Literal["low", "medium", "high", "urgent"] = "medium"
    status: _TASK_STATUSES = "backlog"
    # Mandatory span (057): start_date + due_date (= end), ordered. Real bars
    # on the Gantt; enforced at create.
    start_date: date
    due_date: date
    date_mode: Literal["uniform", "per_entity"] = "uniform"
    entity_inheritance: Literal["inherited", "overridden"] = "inherited"
    entities: List[TaskEntityCreate] = []


def _validate_task_dates(start: date, end: date) -> None:
    """start_date + due_date are mandatory and due must not precede start."""
    if start is None or end is None:
        raise HTTPException(status_code=422, detail="start_date and due_date are required")
    if end < start:
        raise HTTPException(status_code=422, detail="due_date cannot be before start_date")


class TaskStatusUpdate(BaseModel):
    status: _TASK_STATUSES
    entity_id: Optional[str] = None   # if None → update task-level status
    blocker_reason: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    description: Optional[str] = None
    # Optional note stored on the due-date change log (e.g. "via timeline").
    change_reason: Optional[str] = None


class StakeholderAdd(BaseModel):
    user_id: str
    role: Literal["primary", "secondary", "follower"] = "secondary"


def _watchers_for_tasks(sb: Client, task_ids: list):
    """Batch-load item_watchers for a set of tasks, grouped by scope.

    Returns three maps with resolved user name/email:
      by_task    : {task_id: [watcher, ...]}                (scope_type='task')
      by_entity  : {(task_id, entity_id): [watcher, ...]}    (scope_type='entity')
      by_subtask : {subtask_id: [watcher, ...]}              (scope_type='subtask')
    """
    if not task_ids:
        return {}, {}, {}
    rows = (
        sb.table("item_watchers")
        .select("id, task_id, scope_type, subtask_id, entity_type, entity_id, user_id, role, created_at")
        .in_("task_id", task_ids)
        .execute()
        .data
    )
    uids = list({r["user_id"] for r in rows if r.get("user_id")})
    nmap: dict = {}
    if uids:
        for u in sb.table("users").select("id, name, email").in_("id", uids).execute().data:
            nmap[u["id"]] = {"name": u.get("name") or "", "email": u.get("email") or ""}

    by_task: dict = {}
    by_entity: dict = {}
    by_subtask: dict = {}
    for r in rows:
        info = nmap.get(r["user_id"], {})
        w = {
            "id": r["id"],
            "user_id": r["user_id"],
            "name": info.get("name", ""),
            "email": info.get("email", ""),
            "role": r["role"],
            "scope_type": r["scope_type"],
            "subtask_id": r.get("subtask_id"),
            "entity_id": r.get("entity_id"),
            "entity_type": r.get("entity_type"),
        }
        st = r["scope_type"]
        if st == "task":
            by_task.setdefault(r["task_id"], []).append(w)
        elif st == "entity":
            by_entity.setdefault((r["task_id"], r.get("entity_id")), []).append(w)
        elif st == "subtask":
            by_subtask.setdefault(r.get("subtask_id"), []).append(w)
    return by_task, by_entity, by_subtask


def _inherited_watchers_for(task_scope_watchers: list[dict]) -> list[dict]:
    """P4: tag the parent-task's task-scope watchers so they can be rendered
    on subtask rows as inherited. Read-only — the underlying row still lives
    at task scope; the subtask row just surfaces the cascade visually."""
    out: list[dict] = []
    for w in task_scope_watchers:
        wi = dict(w)
        wi["inherited_from"] = "task"
        out.append(wi)
    return out


def _merge_inherited_watchers(own: list[dict], inherited: list[dict]) -> list[dict]:
    """Combine the subtask's own watchers with parent-task-scope watchers,
    de-duplicating by (user_id, role) so the same person isn't shown twice
    when they exist at both scopes. Own watchers always win — the inherited
    chip is the *fallback* indicator."""
    seen = {(w.get("user_id"), w.get("role")) for w in own}
    merged = list(own)
    for w in inherited:
        key = (w.get("user_id"), w.get("role"))
        if key in seen:
            continue
        merged.append(w)
        seen.add(key)
    return merged


def _hydrate_tasks_with_entities(sb: Client, tasks: list) -> list:
    """Attach task_entities (with resolved building/client names) to each task."""
    if not tasks:
        return tasks
    task_ids = [t["id"] for t in tasks]

    # Wave 1: every query below depends only on task_ids and is independent of
    # the others, so fan them out concurrently instead of 4 serial round-trips.
    all_entities, log_rows, c_rows, (w_by_task, w_by_entity, _) = _parallel(
        lambda: sb.table("task_entities").select("*").in_("task_id", task_ids).execute().data,
        lambda: sb.table("task_date_change_log").select("task_id, entity_id").in_("task_id", task_ids).execute().data,
        lambda: sb.table("comments")
            .select("task_id, entity_id, subtask_id, content, kind, user_id, created_at")
            .in_("task_id", task_ids).order("created_at", desc=True).execute().data,
        lambda: _watchers_for_tasks(sb, task_ids),
    )
    entities_by_task: dict = {}
    for e in all_entities:
        entities_by_task.setdefault(e["task_id"], []).append(e)

    # Wave 2: name lookups that each depend on a Wave-1 result but not on each
    # other (building/client names ← entities, comment authors ← comments).
    building_ids = list({e["entity_id"] for e in all_entities if e.get("entity_type") == "building"})
    client_ids = list({e["entity_id"] for e in all_entities if e.get("entity_type") == "client"})
    c_user_ids = list({c["user_id"] for c in c_rows if c.get("user_id")})
    building_rows, client_rows, c_user_rows = _parallel(
        lambda: sb.table("buildings").select("id, name").in_("id", building_ids).execute().data if building_ids else [],
        lambda: sb.table("clients").select("id, name").in_("id", client_ids).execute().data if client_ids else [],
        lambda: sb.table("users").select("id, name").in_("id", c_user_ids).execute().data if c_user_ids else [],
    )
    name_map: dict = {}
    for r in building_rows:
        name_map[r["id"]] = r["name"]
    for r in client_rows:
        name_map[r["id"]] = r["name"]

    # Due-date-change counts: task-level (entity_id NULL) and per-entity.
    task_change_count: dict = {}
    entity_change_count: dict = {}
    for lr in log_rows:
        tid = lr.get("task_id")
        eid = lr.get("entity_id")
        if eid:
            entity_change_count[(tid, eid)] = entity_change_count.get((tid, eid), 0) + 1
        elif tid:
            task_change_count[tid] = task_change_count.get(tid, 0) + 1

    # Latest comment per scope (task-level and per-entity). c_rows / watchers
    # were fetched in Wave 1, comment-author names in Wave 2.
    c_name_map: dict = {u["id"]: (u.get("name") or "") for u in c_user_rows}
    latest_task_comment: dict = {}
    latest_entity_comment: dict = {}
    for c in c_rows:  # already newest-first
        tid, eid, sid = c.get("task_id"), c.get("entity_id"), c.get("subtask_id")
        preview = {
            "content": c["content"],
            "kind": c.get("kind") or "note",
            "author_name": c_name_map.get(c.get("user_id") or "", ""),
            "created_at": c["created_at"],
            # Where the remark was made, so the task row can show
            # "on subtask" / "on <building>" context.
            "source": "entity" if eid else "subtask" if sid else "task",
        }
        if eid:
            latest_entity_comment.setdefault((tid, eid), preview)
        # Roll EVERY remark — task-, subtask-, or entity-level — up to the
        # parent task's latest remark. A note on a subtask or building is
        # still activity on the task and must surface at the task row.
        # c_rows is newest-first, so the first hit per task wins.
        if tid:
            latest_task_comment.setdefault(tid, preview)

    for task in tasks:
        entities = entities_by_task.get(task["id"], [])
        for e in entities:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
            e["date_change_count"] = entity_change_count.get(
                (task["id"], e["entity_id"]), 0
            )
            e["latest_comment"] = latest_entity_comment.get(
                (task["id"], e["entity_id"])
            )
            e["watchers"] = w_by_entity.get((task["id"], e["entity_id"]), [])
        task["task_entities"] = entities
        task["date_change_count"] = task_change_count.get(task["id"], 0)
        task["latest_comment"] = latest_task_comment.get(task["id"])
        task["watchers"] = w_by_task.get(task["id"], [])
    return tasks


def _user_business_id(sb: Client, user_id: str, prefer: Optional[str] = None) -> Optional[str]:
    """Resolve the caller's active workspace.

    For multi-workspace members the caller can pass a preferred business_id
    (the FE forwards the localStorage pin) — when the user is a member
    there, that wins. When the caller is a member of exactly one workspace
    and didn't pass `prefer`, we fall back to that single membership.

    Strict mode: if the caller is a member of more than one workspace and
    no valid `prefer` was supplied, raise 400. Silently picking the first
    membership row used to write/read against the wrong workspace for
    multi-workspace users (Hitesh report).
    """
    if prefer:
        rows = (
            sb.table("business_members")
            .select("business_id")
            .eq("user_id", user_id)
            .eq("business_id", prefer)
            .limit(1)
            .execute()
            .data
        )
        if rows:
            return rows[0]["business_id"]
    memberships = (
        sb.table("business_members")
        .select("business_id")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not memberships:
        return None
    if len(memberships) > 1:
        raise HTTPException(
            status_code=400,
            detail="business_id is required — caller is a member of multiple workspaces.",
        )
    return memberships[0]["business_id"]


def _visible_task_ids_for(sb: Client, business_id: str, user_id: str) -> Optional[set[str]]:
    """Set of task_ids the user has read visibility into within this business.

    Returns None for admin/owner (caller should skip the IN-filter and use a
    full-business scan instead). Empty set means "no visibility" — the caller
    should short-circuit to an empty response.

    Visibility = tasks under any initiative the user can see (cascade) PLUS
    tasks where the user is directly involved (primary, stakeholder, or
    watcher). The direct-involvement union covers edge cases like legacy
    tasks without an initiative_id.
    """
    if is_admin_or_owner(sb, business_id, user_id):
        return None  # admin: full-business

    vis_init_ids = visible_initiative_ids(sb, business_id, user_id)

    # Direct membership (defensive — covers any task missed by the
    # initiative-level cascade, e.g. legacy NULL-initiative rows).
    primary_rows, stake_rows, watcher_rows = _parallel(
        lambda: sb.table("tasks").select("id").eq("primary_stakeholder_id", user_id).execute().data,
        lambda: sb.table("task_stakeholders").select("task_id").eq("user_id", user_id).execute().data,
        lambda: sb.table("item_watchers").select("task_id").eq("user_id", user_id).execute().data,
    )
    direct_candidates: set[str] = (
        {r["id"] for r in primary_rows}
        | {r["task_id"] for r in stake_rows if r.get("task_id")}
        | {r["task_id"] for r in watcher_rows if r.get("task_id")}
    )
    # Multi-workspace fix: the lookups above are workspace-agnostic. Confine
    # the direct set to tasks whose initiative is in THIS business —
    # otherwise a user in two workspaces sees tasks from both pooled into
    # whichever workspace they're currently viewing.
    direct_ids: set[str] = set()
    if direct_candidates:
        biz_init_ids = [
            r["id"]
            for r in sb.table("initiatives")
            .select("id")
            .eq("business_id", business_id)
            .execute()
            .data
        ]
        if biz_init_ids:
            scoped = (
                sb.table("tasks")
                .select("id")
                .in_("id", list(direct_candidates))
                .in_("initiative_id", biz_init_ids)
                .execute()
                .data
            )
            direct_ids = {r["id"] for r in scoped}

    init_task_ids: set[str] = set()
    if vis_init_ids:
        rows = (
            sb.table("tasks")
            .select("id")
            .in_("initiative_id", list(vis_init_ids))
            .execute()
            .data
        )
        init_task_ids = {r["id"] for r in rows}

    return direct_ids | init_task_ids


@router.get("/my")
def get_my_tasks(
    business_id: Optional[str] = Query(default=None, description="Scope to a specific workspace. When omitted, picks the user's first membership row (legacy)."),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Flat list of tasks the caller can see (used by mobile).
    For the paginated web flow, see /my/page.

    Visibility follows the initiative cascade: primary/follower anywhere in
    an initiative tree → full read of that initiative's tasks. See
    `visible_initiative_ids` in deps.py. For multi-workspace members the
    FE passes business_id so the list reflects the active workspace only.
    """
    uid = user["id"]
    business_id = _user_business_id(sb, uid, prefer=business_id)
    if not business_id:
        return []

    visible = _visible_task_ids_for(sb, business_id, uid)
    if visible is None:
        # Admin: every task whose initiative is in this business
        biz_init_ids = [
            r["id"]
            for r in sb.table("initiatives")
            .select("id")
            .eq("business_id", business_id)
            .execute()
            .data
        ]
        if not biz_init_ids:
            return []
        tasks = (
            sb.table("tasks")
            .select("*")
            .in_("initiative_id", biz_init_ids)
            .order("created_at", desc=True)
            .execute()
            .data
        )
    else:
        if not visible:
            return []
        tasks = (
            sb.table("tasks")
            .select("*")
            .in_("id", list(visible))
            .order("created_at", desc=True)
            .execute()
            .data
        )
    return _hydrate_tasks_with_entities(sb, tasks)


@router.get("/my/page")
def get_my_tasks_page(
    limit: int = Query(default=20, ge=1, le=100),
    cursor: Optional[str] = Query(
        default=None,
        description="ISO timestamp of the last task's created_at — return tasks older than this",
    ),
    status: Optional[str] = Query(default=None, description="Filter by exact task status"),
    business_id: Optional[str] = Query(default=None, description="Scope to a specific workspace."),
    archived_only: bool = Query(
        default=False,
        description="Return ONLY archived tasks (the inline 'show archived' view). "
        "When false (default) archived tasks are excluded entirely.",
    ),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """B5: Cursor-paginated list of tasks the caller can see.

    Visibility follows the initiative cascade: involvement on any node of an
    initiative tree (initiative primary, task primary/stakeholder/creator,
    explicit initiative follower, or watcher on any task/subtask within it)
    grants full read of every task in that initiative.

    Returns: {"items": [...tasks], "next_cursor": "<iso>" | None}
    """
    uid = user["id"]
    business_id = _user_business_id(sb, uid, prefer=business_id)
    if not business_id:
        return {"items": [], "next_cursor": None}

    visible = _visible_task_ids_for(sb, business_id, uid)

    if visible is None:
        # Admin/owner: every task in this business.
        biz_init_ids = [
            r["id"]
            for r in sb.table("initiatives")
            .select("id")
            .eq("business_id", business_id)
            .execute()
            .data
        ]
        if not biz_init_ids:
            return {"items": [], "next_cursor": None}
        q = (
            sb.table("tasks")
            .select("*")
            .in_("initiative_id", biz_init_ids)
            .order("created_at", desc=True)
            .limit(limit + 1)
        )
    else:
        if not visible:
            return {"items": [], "next_cursor": None}
        q = (
            sb.table("tasks")
            .select("*")
            .in_("id", list(visible))
            .order("created_at", desc=True)
            .limit(limit + 1)
        )

    # Archive is orthogonal to status: by default the active list hides
    # archived tasks; the 'show archived' toggle asks for them explicitly.
    if archived_only:
        q = q.not_.is_("archived_at", "null")
    else:
        q = q.is_("archived_at", "null")
    if cursor:
        q = q.lt("created_at", cursor)
    if status:
        q = q.eq("status", status)
    tasks = q.execute().data

    has_more = len(tasks) > limit
    if has_more:
        tasks = tasks[:limit]
    next_cursor = tasks[-1]["created_at"] if has_more and tasks else None

    return {
        "items": _hydrate_tasks_with_entities(sb, tasks),
        "next_cursor": next_cursor,
    }


# Registered at both "" and "/" because the Vercel/Next.js rewrite strips the
# trailing slash, so the proxied request arrives as POST /api/v1/tasks (no
# slash) and FastAPI's slash-redirect does not survive the proxy.
@router.post("/", status_code=201)
@router.post("", status_code=201, include_in_schema=False)
def create_task(
    body: TaskCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Authorization + integrity gate. A task lives under an initiative, which
    # lives under a business. Previously this endpoint had NO auth at all: any
    # authenticated user could create a task under *any* initiative_id (a
    # cross-tenant IDOR), and bad/absent ids hit DB FK/NOT-NULL violations that
    # surfaced as raw 500s. The caller must be a member of the initiative's
    # business, and the primary stakeholder must be a member of it too.
    uid = user["id"]
    if not body.initiative_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="initiative_id is required",
        )
    init_rows = (
        sb.table("initiatives")
        .select("business_id, primary_stakeholder_id")
        .eq("id", body.initiative_id)
        .execute()
        .data
    )
    if not init_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Initiative not found")
    init_row = init_rows[0]
    business_id = init_row["business_id"]
    require_member(sb, business_id, uid)  # 403 if caller not in this workspace

    # Visibility scoping rule: non-admin members can only create tasks under
    # initiatives they have WRITE access to (primary on initiative OR existing
    # stake/creator on a task within it). Admin/owner always allowed.
    # Followers are explicitly excluded — they're read-only viewers and use
    # writable_initiative_ids() instead of aligned_initiative_ids() for that
    # reason.
    if not is_admin_or_owner(sb, business_id, uid):
        if init_row.get("primary_stakeholder_id") != uid:
            scope = writable_initiative_ids(sb, business_id, uid)
            if body.initiative_id not in scope:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You're not aligned to this initiative",
                )

    # Caller is a member (just verified). Only re-check when assigning the task
    # to someone else, to keep the common self-assignment path single-query.
    if body.primary_stakeholder_id != uid and get_member_role(
        sb, business_id, body.primary_stakeholder_id
    ) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="primary_stakeholder_id must be a member of this workspace",
        )

    _validate_task_dates(body.start_date, body.due_date)

    result = sb.table("tasks").insert({
        "title": body.title,
        "description": body.description,
        "initiative_id": body.initiative_id,
        "primary_stakeholder_id": body.primary_stakeholder_id,
        "created_by": uid,
        "priority": body.priority,
        "status": body.status,
        "start_date": body.start_date.isoformat(),
        "due_date": body.due_date.isoformat(),
        "date_mode": body.date_mode,
        "entity_inheritance": body.entity_inheritance,
    }).execute()

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create task",
        )

    task = result.data[0]
    task_id = task["id"]

    stakeholder_result = sb.table("task_stakeholders").insert({
        "task_id": task_id,
        "user_id": body.primary_stakeholder_id,
        "role": "primary",
    }).execute()

    if not stakeholder_result.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign primary stakeholder",
        )

    if body.entities:
        entity_rows = [
            {
                "task_id": task_id,
                "entity_type": te.entity_type,
                "entity_id": te.entity_id,
                "per_entity_end_date": te.per_entity_end_date.isoformat() if te.per_entity_end_date else None,
            }
            for te in body.entities
        ]
        entities_result = sb.table("task_entities").insert(entity_rows).execute()
        if not entities_result.data:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to assign entities to task",
            )

    return task


@router.get("/{task_id}")
def get_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # H1: single shared read gate. The previous bespoke check (primary /
    # stakeholder / watcher only) was strictly narrower than every other
    # read path, so a workspace admin or initiative primary got 403 here
    # while seeing the same task via /initiatives/business/{id}/with-tasks.
    # _assert_task_access covers all the cascade branches: admin/owner,
    # primary, stakeholder, watcher, initiative-visible.
    _assert_task_access(sb, task_id, user["id"])
    rows = sb.table("tasks").select("*, task_entities(*), task_stakeholders(*), subtasks(*), comments(*), attachments(*)").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]

    # Resolve entity names
    entities = task.get("task_entities") or []
    building_ids = [e["entity_id"] for e in entities if e.get("entity_type") == "building"]
    client_ids   = [e["entity_id"] for e in entities if e.get("entity_type") == "client"]
    name_map = {}
    if building_ids:
        for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            name_map[r["id"]] = r["name"]
    if client_ids:
        for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            name_map[r["id"]] = r["name"]
    for e in entities:
        e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
    task["task_entities"] = entities
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    rows = sb.table("tasks").select("primary_stakeholder_id, initiative_id").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task = rows[0]
    uid = user["id"]

    is_primary = task["primary_stakeholder_id"] == uid
    if not is_primary:
        allowed = False
        if task.get("initiative_id"):
            init_row = sb.table("initiatives").select("business_id").eq("id", task["initiative_id"]).execute().data
            if init_row:
                role = get_member_role(sb, init_row[0]["business_id"], uid)
                allowed = role in ("owner", "admin")
        if not allowed:
            raise HTTPException(status_code=403, detail="Only the primary stakeholder or a workspace admin can delete this task")

    # Delete task milestones (polymorphic parent_id — no DB cascade from tasks)
    milestone_rows = (
        sb.table("milestones")
        .select("id")
        .eq("parent_type", "task")
        .eq("parent_id", task_id)
        .execute()
        .data
    )
    if milestone_rows:
        milestone_ids = [m["id"] for m in milestone_rows]
        sb.table("milestone_entities").delete().in_("milestone_id", milestone_ids).execute()
        sb.table("milestones").delete().in_("id", milestone_ids).execute()

    # Delete the task — DB cascades to task_stakeholders, task_entities,
    # subtasks, task_date_change_log, comments, attachments
    sb.table("tasks").delete().eq("id", task_id).execute()


@router.post("/{task_id}/archive", status_code=200)
def archive_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Archive a *done* task out of the active list. Admin/owner only.

    Cascades: every subtask (and sub-subtask) under the task is archived too,
    so a restored task brings its whole attribute subtree back intact.
    """
    _assert_admin_or_owner(sb, task_id, user["id"])
    rows = sb.table("tasks").select("status, archived_at").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    if rows[0].get("archived_at"):
        raise HTTPException(status_code=400, detail="Task is already archived")
    if rows[0].get("status") != "done":
        raise HTTPException(status_code=400, detail="Only a completed (done) task can be archived")

    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table("tasks").update({"archived_at": now_iso, "updated_at": now_iso}).eq("id", task_id).execute()
    # Cascade to the whole subtask subtree (one level of nesting, but archive
    # everything keyed to this task regardless of depth).
    sb.table("subtasks").update({"archived_at": now_iso, "updated_at": now_iso}).eq(
        "task_id", task_id
    ).is_("archived_at", "null").execute()
    return {"id": task_id, "archived_at": now_iso}


@router.post("/{task_id}/restore", status_code=200)
def restore_task(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Restore an archived task (and its whole subtask subtree) back to the
    active list. Admin/owner only. Workflow status is untouched — it returns
    with the status it had when archived (always 'done')."""
    _assert_admin_or_owner(sb, task_id, user["id"])
    rows = sb.table("tasks").select("archived_at").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    if not rows[0].get("archived_at"):
        raise HTTPException(status_code=400, detail="Task is not archived")

    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table("tasks").update({"archived_at": None, "updated_at": now_iso}).eq("id", task_id).execute()
    sb.table("subtasks").update({"archived_at": None, "updated_at": now_iso}).eq(
        "task_id", task_id
    ).not_.is_("archived_at", "null").execute()
    return {"id": task_id, "archived_at": None}


@router.patch("/{task_id}")
def update_task(
    task_id: str,
    body: TaskUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Authz: primary | secondary stakeholder | workspace owner/admin.
    # Owners/admins were excluded by an inline stakeholder-only check —
    # divergent from the rest of the write surface (status/subtask/entity
    # already use _assert_task_write). That blocked owners from editing
    # dates on tasks they didn't personally own.
    _assert_task_write(sb, task_id, user["id"])
    # Snapshot current state BEFORE the update so we can detect transitions.
    prior = sb.table("tasks").select("start_date, due_date, status, closed_at").eq("id", task_id).execute().data
    prior_due_str = prior[0].get("due_date") if prior else None
    prior_start_str = prior[0].get("start_date") if prior else None
    prior_status = prior[0].get("status") if prior else None

    # Distinguish "field absent" from "field explicitly null" so the sheet
    # can clear description. model_fields_set is the only way to tell
    # `{title: 'x'}` apart from `{title: 'x', description: null}`.
    set_fields = body.model_fields_set
    payload: dict = {}
    if "title" in set_fields and body.title is not None:
        payload["title"] = body.title
    if "status" in set_fields and body.status is not None:
        payload["status"] = body.status
    if "priority" in set_fields and body.priority is not None:
        payload["priority"] = body.priority
    # start_date / due_date are mandatory (057) — reject clearing them.
    if "start_date" in set_fields:
        if body.start_date is None:
            raise HTTPException(status_code=422, detail="start_date cannot be cleared")
        payload["start_date"] = body.start_date.isoformat()
    if "due_date" in set_fields:
        if body.due_date is None:
            raise HTTPException(status_code=422, detail="due_date cannot be cleared")
        payload["due_date"] = body.due_date.isoformat()
    if "description" in set_fields:
        payload["description"] = body.description
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    # Keep start <= due when either date changes (compare effective values).
    if "start_date" in payload or "due_date" in payload:
        eff_start = payload.get("start_date", prior_start_str)
        eff_due = payload.get("due_date", prior_due_str)
        if eff_start and eff_due and str(eff_due) < str(eff_start):
            raise HTTPException(status_code=422, detail="due_date cannot be before start_date")

    now_iso = datetime.now(timezone.utc).isoformat()
    payload["updated_at"] = now_iso

    # Closure timestamp: set when entering 'done', clear when leaving it.
    # Approval is orthogonal — Done always anchors closed_at (the TAT), and
    # additionally enters 'pending' when an approver exists at this scope.
    if body.status is not None and body.status != prior_status:
        if body.status == "done":
            payload["closed_at"] = now_iso
            payload["approval_state"] = (
                "pending" if _scope_has_approver(sb, task_id, "task") else "none"
            )
        else:
            if prior_status == "done":
                payload["closed_at"] = None
            payload["approval_state"] = "none"

    result = sb.table("tasks").update(payload).eq("id", task_id).execute()
    updated = result.data[0] if result.data else {}

    # Record the due-date change against the pre-update value. Triggered on
    # any explicit due_date write — including clearing the field to null.
    if "due_date" in set_fields:
        old_date = date.fromisoformat(prior_due_str[:10]) if prior_due_str else None
        if old_date != body.due_date:
            sb.table("task_date_change_log").insert({
                "task_id": task_id,
                "changed_by": user["id"],
                "old_date": old_date.isoformat() if old_date else None,
                "new_date": body.due_date.isoformat() if body.due_date else None,
                "delay_days": (body.due_date - old_date).days if old_date and body.due_date else None,
                "reason": body.change_reason,
            }).execute()

    return updated


@router.patch("/{task_id}/status")
def update_task_status(
    task_id: str,
    body: TaskStatusUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Was previously unauthenticated — any user could drive any task/entity to
    # done (and thus into approval/closure). Gate it like other state writes.
    _assert_task_write(sb, task_id, user["id"])
    now = datetime.now(timezone.utc).isoformat()

    if body.entity_id is not None:
        ent_payload: dict = {"per_entity_status": body.status, "updated_at": now}
        if body.status == "done":
            ent_payload["closed_at"] = now
            ent_payload["approval_state"] = (
                "pending"
                if _scope_has_approver(sb, task_id, "entity", entity_id=body.entity_id)
                else "none"
            )
        else:
            ent_payload["closed_at"] = None
            ent_payload["approval_state"] = "none"
        result = sb.table("task_entities").update(ent_payload).eq(
            "task_id", task_id).eq("entity_id", body.entity_id).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task entity not found",
            )
    else:
        update_payload: dict = {"status": body.status, "updated_at": now}
        if body.blocker_reason is not None:
            update_payload["blocker_reason"] = body.blocker_reason
        if body.status == "done":
            update_payload["closed_at"] = now
            update_payload["approval_state"] = (
                "pending" if _scope_has_approver(sb, task_id, "task") else "none"
            )
        else:
            update_payload["closed_at"] = None
            update_payload["approval_state"] = "none"
        result = sb.table("tasks").update(update_payload).eq("id", task_id).execute()
        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Task not found",
            )

    return {"ok": True}


@router.post("/{task_id}/stakeholders", status_code=201)
def add_stakeholder(
    task_id: str,
    body: StakeholderAdd,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_can_manage_stakeholders(sb, task_id, user["id"])
    _assert_target_is_member(sb, task_id, body.user_id)
    result = sb.table("task_stakeholders").upsert(
        {"task_id": task_id, "user_id": body.user_id, "role": body.role},
        on_conflict="task_id,user_id",
    ).execute()
    return result.data[0] if result.data else {}


@router.delete("/{task_id}/stakeholders/{stakeholder_user_id}", status_code=204)
def remove_stakeholder(
    task_id: str,
    stakeholder_user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_can_manage_stakeholders(sb, task_id, user["id"])
    sb.table("task_stakeholders").delete().eq("task_id", task_id).eq("user_id", stakeholder_user_id).execute()


# ---------------------------------------------------------------------------
# Followers & Approvers (item_watchers) — one scope-parameterised CRUD set
# covering task / subtask / entity (building or client) scopes.
# ---------------------------------------------------------------------------

class WatcherCreate(BaseModel):
    scope_type: Literal["task", "subtask", "entity"]
    role: Literal["follower", "approver"]
    user_id: str
    subtask_id: Optional[str] = None
    entity_type: Optional[Literal["building", "client"]] = None
    entity_id: Optional[str] = None


def _assert_task_write(sb: Client, task_id: str, user_id: str):
    """Write-gate for state-changing endpoints (status, subtasks, entities,
    watcher roster). Caller must be the primary stakeholder, a task_stakeholder,
    or a workspace owner/admin. Deliberately does NOT include item_watchers —
    followers/approvers get full *read* via _assert_task_access but must not be
    able to mutate task state just by being on the watch list.
    """
    rows = (
        sb.table("tasks")
        .select("primary_stakeholder_id, initiative_id")
        .eq("id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    t = rows[0]
    if t["primary_stakeholder_id"] == user_id:
        return
    s = (
        sb.table("task_stakeholders")
        .select("user_id")
        .eq("task_id", task_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if s:
        return
    # Workspace owner/admin fallback — matches delete_task and the frontend's
    # canManageWatchers affordance so the UI and API agree.
    if t.get("initiative_id"):
        init_row = (
            sb.table("initiatives")
            .select("business_id")
            .eq("id", t["initiative_id"])
            .execute()
            .data
        )
        if init_row and get_member_role(
            sb, init_row[0]["business_id"], user_id
        ) in ("owner", "admin"):
            return
    raise HTTPException(
        status_code=403,
        detail="Only a task stakeholder or workspace admin can modify this task",
    )


def _assert_stakeholder(sb: Client, task_id: str, user_id: str):
    """Back-compat alias — watcher-roster management uses the same write-gate."""
    _assert_task_write(sb, task_id, user_id)


def _assert_can_manage_stakeholders(sb: Client, task_id: str, user_id: str):
    """Authz for add/remove stakeholders: primary OR workspace owner/admin.
    Deliberately NOT secondary stakeholders — a co-assignee shouldn't decide
    who else is on the task. Owner/admin can manage so they can reassign
    stranded tasks when the primary leaves.
    """
    rows = (
        sb.table("tasks")
        .select("primary_stakeholder_id, initiative_id")
        .eq("id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    t = rows[0]
    if t["primary_stakeholder_id"] == user_id:
        return
    if t.get("initiative_id"):
        init_row = (
            sb.table("initiatives")
            .select("business_id")
            .eq("id", t["initiative_id"])
            .execute()
            .data
        )
        if init_row and get_member_role(
            sb, init_row[0]["business_id"], user_id
        ) in ("owner", "admin"):
            return
    raise HTTPException(
        status_code=403,
        detail="Only the primary stakeholder or a workspace admin can manage stakeholders",
    )


def _assert_admin_or_owner(sb: Client, task_id: str, user_id: str):
    """Stricter gate than _assert_task_write: ONLY workspace owners/admins.

    Used for structural changes the product reserves for admins — adding or
    deleting attributes (subtasks), and archiving/restoring tasks or subtasks.
    Stakeholders can still edit a subtask's status/title/assignee via PATCH,
    but they can't reshape the attribute set or archive things.
    """
    rows = (
        sb.table("tasks")
        .select("initiative_id")
        .eq("id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    init_id = rows[0].get("initiative_id")
    if init_id:
        init_row = (
            sb.table("initiatives")
            .select("business_id")
            .eq("id", init_id)
            .execute()
            .data
        )
        if init_row and get_member_role(
            sb, init_row[0]["business_id"], user_id
        ) in ("owner", "admin"):
            return
    raise HTTPException(
        status_code=403,
        detail="Only a workspace owner or admin can perform this action",
    )


def _task_business_id(sb: Client, task_id: str) -> Optional[str]:
    """Resolve a task's owning business_id (task → initiative → business)."""
    rows = sb.table("tasks").select("initiative_id").eq("id", task_id).execute().data
    if not rows or not rows[0].get("initiative_id"):
        return None
    init = (
        sb.table("initiatives")
        .select("business_id")
        .eq("id", rows[0]["initiative_id"])
        .execute()
        .data
    )
    return init[0]["business_id"] if init else None


def _assert_target_is_member(sb: Client, task_id: str, target_user_id: str):
    """Reject adding a non-member (or cross-tenant) user to a task's roster
    (audit N4). The follower endpoints already guard this way; the
    stakeholder/approver paths did not, so a stakeholder could add an
    arbitrary user id — including an approver who could then act on
    approvals."""
    business_id = _task_business_id(sb, task_id)
    if business_id is None or get_member_role(sb, business_id, target_user_id) is None:
        raise HTTPException(
            status_code=400,
            detail="User is not a member of this workspace",
        )


def _scope_has_approver(sb: Client, task_id: str, scope_type: str,
                        *, subtask_id=None, entity_id=None) -> bool:
    """True if at least one approver is assigned at the given scope.

    When true, marking that item Done routes it through approval_state='pending'
    instead of closing outright.
    """
    q = (
        sb.table("item_watchers")
        .select("id")
        .eq("task_id", task_id)
        .eq("scope_type", scope_type)
        .eq("role", "approver")
    )
    if scope_type == "subtask":
        q = q.eq("subtask_id", subtask_id)
    elif scope_type == "entity":
        q = q.eq("entity_id", entity_id)
    return bool(q.limit(1).execute().data)


def _is_scope_approver(sb: Client, task_id: str, user_id: str, scope_type: str,
                       *, subtask_id=None, entity_id=None) -> bool:
    """True if this user is an approver on that exact scope."""
    q = (
        sb.table("item_watchers")
        .select("id")
        .eq("task_id", task_id)
        .eq("scope_type", scope_type)
        .eq("role", "approver")
        .eq("user_id", user_id)
    )
    if scope_type == "subtask":
        q = q.eq("subtask_id", subtask_id)
    elif scope_type == "entity":
        q = q.eq("entity_id", entity_id)
    return bool(q.limit(1).execute().data)


@router.get("/{task_id}/watchers")
@router.get("/{task_id}/watchers/", include_in_schema=False)
def list_watchers(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """All followers/approvers across every scope of this task tree."""
    _assert_task_access(sb, task_id, user["id"])
    by_task, by_entity, by_subtask = _watchers_for_tasks(sb, [task_id])
    flat: list = []
    for v in by_task.values():
        flat.extend(v)
    for v in by_entity.values():
        flat.extend(v)
    for v in by_subtask.values():
        flat.extend(v)
    return flat


@router.post("/{task_id}/watchers", status_code=201)
@router.post("/{task_id}/watchers/", status_code=201, include_in_schema=False)
def add_watcher(
    task_id: str,
    body: WatcherCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_stakeholder(sb, task_id, user["id"])
    _assert_target_is_member(sb, task_id, body.user_id)

    row: dict = {
        "task_id": task_id,
        "scope_type": body.scope_type,
        "user_id": body.user_id,
        "role": body.role,
    }
    if body.scope_type == "subtask":
        if not body.subtask_id:
            raise HTTPException(status_code=422, detail="subtask_id required for subtask scope")
        st = sb.table("subtasks").select("id").eq("id", body.subtask_id).eq("task_id", task_id).execute().data
        if not st:
            raise HTTPException(status_code=404, detail="Subtask not found on this task")
        row["subtask_id"] = body.subtask_id
    elif body.scope_type == "entity":
        if not body.entity_id or not body.entity_type:
            raise HTTPException(status_code=422, detail="entity_type and entity_id required for entity scope")
        row["entity_type"] = body.entity_type
        row["entity_id"] = body.entity_id

    # Idempotent: the unique index would reject a dupe — surface the existing row.
    existing_q = (
        sb.table("item_watchers")
        .select("*")
        .eq("task_id", task_id)
        .eq("scope_type", body.scope_type)
        .eq("user_id", body.user_id)
        .eq("role", body.role)
    )
    if body.scope_type == "subtask":
        existing_q = existing_q.eq("subtask_id", body.subtask_id)
    elif body.scope_type == "entity":
        existing_q = existing_q.eq("entity_id", body.entity_id)
    existing = existing_q.execute().data
    if existing:
        return existing[0]

    result = sb.table("item_watchers").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to add watcher")
    return result.data[0]


@router.delete("/{task_id}/watchers/{watcher_id}", status_code=204)
def remove_watcher(
    task_id: str,
    watcher_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_stakeholder(sb, task_id, user["id"])
    sb.table("item_watchers").delete().eq("id", watcher_id).eq("task_id", task_id).execute()


# ---------------------------------------------------------------------------
# Approve / Reject — an approver finalises a 'pending' item. First action wins.
# ---------------------------------------------------------------------------

class ApprovalAction(BaseModel):
    scope_type: Literal["task", "subtask", "entity"]
    action: Literal["approve", "reject"]
    reason: Optional[str] = None
    subtask_id: Optional[str] = None
    entity_id: Optional[str] = None


@router.post("/{task_id}/approvals", status_code=201)
@router.post("/{task_id}/approvals/", status_code=201, include_in_schema=False)
def act_on_approval(
    task_id: str,
    body: ApprovalAction,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    uid = user["id"]
    if not _is_scope_approver(
        sb, task_id, uid, body.scope_type,
        subtask_id=body.subtask_id, entity_id=body.entity_id,
    ):
        raise HTTPException(status_code=403, detail="You are not an approver on this item")

    # Resolve the target row and its current approval_state.
    if body.scope_type == "task":
        rows = sb.table("tasks").select("approval_state").eq("id", task_id).execute().data
    elif body.scope_type == "subtask":
        if not body.subtask_id:
            raise HTTPException(status_code=422, detail="subtask_id required")
        rows = (
            sb.table("subtasks").select("approval_state")
            .eq("id", body.subtask_id).eq("task_id", task_id).execute().data
        )
    else:
        if not body.entity_id:
            raise HTTPException(status_code=422, detail="entity_id required")
        rows = (
            sb.table("task_entities").select("approval_state")
            .eq("task_id", task_id).eq("entity_id", body.entity_id).execute().data
        )
    if not rows:
        raise HTTPException(status_code=404, detail="Target item not found")

    # First-action-wins: a later approver finds it already resolved.
    if rows[0].get("approval_state") != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Item is not awaiting approval (state: {rows[0].get('approval_state')})",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    c_entity = body.entity_id if body.scope_type == "entity" else None
    c_subtask = body.subtask_id if body.scope_type == "subtask" else None

    if body.action == "reject":
        reason = (body.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=422, detail="A reason is required to reject")
        if body.scope_type == "task":
            sb.table("tasks").update({
                "approval_state": "rejected", "status": "reopened",
                "closed_at": None, "updated_at": now_iso,
            }).eq("id", task_id).execute()
        elif body.scope_type == "subtask":
            sb.table("subtasks").update({
                "approval_state": "rejected", "status": "reopened",
                "closed_at": None, "updated_at": now_iso,
            }).eq("id", body.subtask_id).eq("task_id", task_id).execute()
        else:
            sb.table("task_entities").update({
                "approval_state": "rejected", "per_entity_status": "reopened",
                "closed_at": None, "updated_at": now_iso,
            }).eq("task_id", task_id).eq("entity_id", body.entity_id).execute()
        # Required reason lands in the item's own thread, red-highlighted.
        _create_comment_scoped(
            sb, task_id, uid, reason,
            entity_id=c_entity, subtask_id=c_subtask, kind="rejection",
        )
    else:  # approve — TAT/closed_at stay put; only the approval layer changes.
        if body.scope_type == "task":
            sb.table("tasks").update({
                "approval_state": "approved", "updated_at": now_iso,
            }).eq("id", task_id).execute()
        elif body.scope_type == "subtask":
            sb.table("subtasks").update({
                "approval_state": "approved", "updated_at": now_iso,
            }).eq("id", body.subtask_id).eq("task_id", task_id).execute()
        else:
            sb.table("task_entities").update({
                "approval_state": "approved", "updated_at": now_iso,
            }).eq("task_id", task_id).eq("entity_id", body.entity_id).execute()
        _create_comment_scoped(
            sb, task_id, uid, (body.reason or "").strip() or "Approved.",
            entity_id=c_entity, subtask_id=c_subtask, kind="approval",
        )

    sb.table("approval_log").insert({
        "task_id": task_id,
        "scope_type": body.scope_type,
        "subtask_id": c_subtask,
        "entity_id": c_entity,
        "actor_id": uid,
        "action": body.action,
        "reason": (body.reason or "").strip() or None,
        "created_at": now_iso,
    }).execute()

    # Notify the task owner that their item was approved/rejected.
    owner_rows = sb.table("tasks").select("primary_stakeholder_id, title").eq("id", task_id).execute().data
    if owner_rows:
        owner_id = owner_rows[0].get("primary_stakeholder_id")
        if owner_id and owner_id != uid:
            verb = "approved" if body.action == "approve" else "rejected"
            send_push_to_user(
                sb, owner_id,
                f"Item {verb}",
                owner_rows[0].get("title") or "Your task",
                {"task_id": task_id},
            )

    return {
        "ok": True,
        "approval_state": "approved" if body.action == "approve" else "rejected",
    }


# ---------------------------------------------------------------------------
# New endpoints
# ---------------------------------------------------------------------------

class BulkUpdateBody(BaseModel):
    task_ids: List[str]
    status: Optional[str] = None
    priority: Optional[str] = None


@router.post("/bulk-update")
def bulk_update_tasks(
    body: BulkUpdateBody,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Update status and/or priority on tasks where caller is a stakeholder."""
    if not body.task_ids:
        return {"updated_count": 0}
    if body.status is None and body.priority is None:
        raise HTTPException(status_code=422, detail="Provide at least one of status or priority")

    uid = user["id"]

    # Collect task_ids where user is primary stakeholder
    primary_rows = (
        sb.table("tasks")
        .select("id")
        .in_("id", body.task_ids)
        .eq("primary_stakeholder_id", uid)
        .execute()
        .data
    )
    primary_ids = {r["id"] for r in primary_rows}

    # Collect task_ids where user is secondary/observer stakeholder
    secondary_rows = (
        sb.table("task_stakeholders")
        .select("task_id")
        .in_("task_id", body.task_ids)
        .eq("user_id", uid)
        .execute()
        .data
    )
    secondary_ids = {r["task_id"] for r in secondary_rows}

    allowed_ids = list(primary_ids | secondary_ids)
    if not allowed_ids:
        return {"updated_count": 0}

    now = datetime.now(timezone.utc).isoformat()

    # Priority-only changes don't touch the lifecycle, so a single blanket
    # update is fine.
    if body.status is None:
        result = (
            sb.table("tasks")
            .update({"priority": body.priority, "updated_at": now})
            .in_("id", allowed_ids)
            .execute()
        )
        return {"updated_count": len(result.data) if result.data else 0}

    # N5: a status change — especially to "done" — must go through the SAME
    # approval/closure routing as the single-task PATCH /status. The old blanket
    # update let a stakeholder bulk-set "done" and silently close tasks that
    # have an approver, bypassing the approval workflow entirely. Route each
    # task individually so a "done" on an approver-gated task lands in
    # approval_state="pending" instead of closed, and closed_at is anchored
    # (and cleared on reopen) exactly like the single endpoint.
    updated = 0
    for tid in allowed_ids:
        payload: dict = {"status": body.status, "updated_at": now}
        if body.priority is not None:
            payload["priority"] = body.priority
        if body.status == "done":
            payload["closed_at"] = now
            payload["approval_state"] = (
                "pending" if _scope_has_approver(sb, tid, "task") else "none"
            )
        else:
            payload["closed_at"] = None
            payload["approval_state"] = "none"
        result = sb.table("tasks").update(payload).eq("id", tid).execute()
        if result.data:
            updated += 1
    return {"updated_count": updated}


# ---------------------------------------------------------------------------
# Subtask endpoints
# ---------------------------------------------------------------------------

class SubtaskCreate(BaseModel):
    title: str
    assignee_id: Optional[str] = None
    scoped_entity_id: Optional[str] = None
    scoped_entity_type: Optional[str] = None
    parent_subtask_id: Optional[str] = None  # B1: enables Task → Subtask → Sub-subtask
    # P2 field parity with tasks (migration 039). All optional / defaulted.
    description: Optional[str] = None
    # Optional span (057): a subtask shows a Gantt bar when both are set.
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: Literal["low", "medium", "high", "urgent"] = "medium"


class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    parent_subtask_id: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    due_date: Optional[date] = None
    priority: Optional[Literal["low", "medium", "high", "urgent"]] = None


def _assert_task_access(sb: Client, task_id: str, user_id: str):
    rows = (
        sb.table("tasks")
        .select("primary_stakeholder_id, initiative_id")
        .eq("id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    row = rows[0]
    if row["primary_stakeholder_id"] == user_id:
        return
    s_rows = (
        sb.table("task_stakeholders")
        .select("user_id")
        .eq("task_id", task_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if s_rows:
        return
    # Follower/approver at any scope still gets full task-tree read.
    w_rows = (
        sb.table("item_watchers")
        .select("id")
        .eq("task_id", task_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
        .data
    )
    if w_rows:
        return
    # Initiative-level cascade: if this task's initiative is in the user's
    # visible_initiative_ids (admin, initiative primary, explicit follower,
    # task primary/stake/creator elsewhere in the initiative, or watcher on
    # any sibling task), the user can read this task too.
    init_id = row.get("initiative_id")
    if init_id:
        init_rows = (
            sb.table("initiatives")
            .select("business_id")
            .eq("id", init_id)
            .execute()
            .data
        )
        if init_rows:
            biz_id = init_rows[0]["business_id"]
            if is_admin_or_owner(sb, biz_id, user_id):
                return
            if init_id in visible_initiative_ids(sb, biz_id, user_id):
                return
    raise HTTPException(status_code=403, detail="Access denied")


@router.get("/{task_id}/subtasks")
def list_subtasks(
    task_id: str,
    for_entity: Optional[str] = Query(default=None, description="entity_id to scope subtasks to"),
    include_archived: bool = Query(default=False, description="Include archived subtasks"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    query = (
        sb.table("subtasks")
        .select(
            "id, title, status, approval_state, assignee_id, created_at, closed_at, "
            "scoped_entity_id, scoped_entity_type, parent_subtask_id, "
            "description, due_date, priority, archived_at"
        )
        .eq("task_id", task_id)
        .order("created_at")
    )
    if not include_archived:
        query = query.is_("archived_at", "null")
    if for_entity is not None:
        query = query.eq("scoped_entity_id", for_entity)
    else:
        query = query.is_("scoped_entity_id", "null")
    subtasks = query.execute().data
    # Resolve assignee names
    assignee_ids = list({s["assignee_id"] for s in subtasks if s.get("assignee_id")})
    name_map: dict = {}
    if assignee_ids:
        for r in sb.table("users").select("id, name").in_("id", assignee_ids).execute().data:
            name_map[r["id"]] = r["name"]
    w_by_task, _, w_by_subtask = _watchers_for_tasks(sb, [task_id])
    task_inherited = _inherited_watchers_for(w_by_task.get(task_id, []))
    for s in subtasks:
        s["assignee_name"] = name_map.get(s.get("assignee_id") or "", "")
        s["watchers"] = _merge_inherited_watchers(
            w_by_subtask.get(s["id"], []), task_inherited
        )
    return subtasks


@router.get("/{task_id}/subtasks-grouped")
def list_subtasks_grouped(
    task_id: str,
    include_archived: bool = Query(default=False, description="Include archived subtasks"),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """B4: One-shot fetch of every subtask under a task, grouped by entity_id.

    Returns: {"by_entity": {entity_id: [subtask, ...], ...}, "task_flat": [...]}

    Replaces the per-entity N+1 pattern where each building row separately
    called /subtasks?for_entity=<id>. With 50 buildings, that was 50 trips;
    now it's one query that benefits from the (task_id, scoped_entity_id) index.

    Archived subtasks are excluded unless include_archived=true (the inline
    "show archived" toggle); each row carries archived_at so the client can
    separate the active set from the archived one.
    """
    _assert_task_access(sb, task_id, user["id"])
    q = (
        sb.table("subtasks")
        .select(
            "id, title, status, approval_state, assignee_id, created_at, closed_at, "
            "scoped_entity_id, scoped_entity_type, parent_subtask_id, "
            "description, due_date, priority, archived_at"
        )
        .eq("task_id", task_id)
        .order("created_at")
    )
    if not include_archived:
        q = q.is_("archived_at", "null")
    rows = q.execute().data

    # Resolve assignee names in one batch
    assignee_ids = list({s["assignee_id"] for s in rows if s.get("assignee_id")})
    name_map: dict = {}
    if assignee_ids:
        for r in sb.table("users").select("id, name").in_("id", assignee_ids).execute().data:
            name_map[r["id"]] = r.get("name") or ""
    for s in rows:
        s["assignee_name"] = name_map.get(s.get("assignee_id") or "", "")

    # Latest comment per subtask, batched.
    sub_ids = [s["id"] for s in rows]
    latest_sub_comment: dict = {}
    if sub_ids:
        c_rows = (
            sb.table("comments")
            .select("subtask_id, content, kind, user_id, created_at")
            .in_("subtask_id", sub_ids)
            .order("created_at", desc=True)
            .execute()
            .data
        )
        c_uids = list({c["user_id"] for c in c_rows if c.get("user_id")})
        c_names: dict = {}
        if c_uids:
            for u in sb.table("users").select("id, name").in_("id", c_uids).execute().data:
                c_names[u["id"]] = u.get("name") or ""
        for c in c_rows:  # newest-first
            sid = c.get("subtask_id")
            if sid:
                latest_sub_comment.setdefault(sid, {
                    "content": c["content"],
                    "kind": c.get("kind") or "note",
                    "author_name": c_names.get(c.get("user_id") or "", ""),
                    "created_at": c["created_at"],
                })
    w_by_task, _, w_by_subtask = _watchers_for_tasks(sb, [task_id])
    task_inherited = _inherited_watchers_for(w_by_task.get(task_id, []))
    for s in rows:
        s["latest_comment"] = latest_sub_comment.get(s["id"])
        s["watchers"] = _merge_inherited_watchers(
            w_by_subtask.get(s["id"], []), task_inherited
        )

    by_entity: dict = {}
    task_flat: list = []
    for s in rows:
        eid = s.get("scoped_entity_id")
        if eid:
            by_entity.setdefault(eid, []).append(s)
        else:
            task_flat.append(s)
    return {"by_entity": by_entity, "task_flat": task_flat}


@router.post("/{task_id}/subtasks", status_code=201)
def create_subtask(
    task_id: str,
    body: SubtaskCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    # Adding attributes is an admin/owner-only structural change.
    _assert_admin_or_owner(sb, task_id, user["id"])
    now = datetime.now(timezone.utc).isoformat()
    row: dict = {
        "task_id": task_id,
        "title": body.title,
        "status": "todo",
        "assignee_id": body.assignee_id or user["id"],
        "description": body.description,
        "start_date": body.start_date.isoformat() if body.start_date else None,
        "due_date": body.due_date.isoformat() if body.due_date else None,
        "priority": body.priority,
        "created_at": now,
        "updated_at": now,
    }

    # If parent_subtask_id is provided, verify it belongs to the same task and
    # inherit its entity scope (children of an entity-scoped subtask stay scoped
    # to that entity). Cap nesting at depth 2 (sub-subtask): no grandchildren.
    if body.parent_subtask_id:
        parent_rows = (
            sb.table("subtasks")
            .select("task_id, scoped_entity_id, scoped_entity_type, parent_subtask_id")
            .eq("id", body.parent_subtask_id)
            .execute()
            .data
        )
        if not parent_rows:
            raise HTTPException(status_code=404, detail="Parent subtask not found")
        parent = parent_rows[0]
        if parent["task_id"] != task_id:
            raise HTTPException(status_code=400, detail="Parent subtask belongs to a different task")
        if parent.get("parent_subtask_id"):
            raise HTTPException(status_code=400, detail="Subtasks can only nest one level deep")
        row["parent_subtask_id"] = body.parent_subtask_id
        # Inherit scope from parent so the child renders under the same entity
        if parent.get("scoped_entity_id"):
            row["scoped_entity_id"] = parent["scoped_entity_id"]
            row["scoped_entity_type"] = parent.get("scoped_entity_type")
    elif body.scoped_entity_id:
        row["scoped_entity_id"] = body.scoped_entity_id
        row["scoped_entity_type"] = body.scoped_entity_type

    result = sb.table("subtasks").insert(row).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create subtask")
    return result.data[0]


@router.get("/{task_id}/stakeholders")
def get_task_stakeholders(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    rows = sb.table("task_stakeholders").select("user_id, role").eq("task_id", task_id).execute().data
    user_ids = [r["user_id"] for r in rows]
    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name, email").in_("id", user_ids).execute().data:
            name_map[u["id"]] = {"name": u.get("name") or "", "email": u.get("email") or ""}
    for r in rows:
        info = name_map.get(r["user_id"], {})
        r["name"] = info.get("name", "")
        r["email"] = info.get("email", "")
    return rows


class TaskEntityUpdate(BaseModel):
    per_entity_status: Optional[str] = None
    per_entity_start_date: Optional[date] = None
    per_entity_end_date: Optional[date] = None
    change_reason: Optional[str] = None


@router.patch("/{task_id}/entities/{entity_id}")
def update_task_entity(
    task_id: str,
    entity_id: str,
    body: TaskEntityUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_write(sb, task_id, user["id"])

    prior = (
        sb.table("task_entities")
        .select("per_entity_status, per_entity_end_date")
        .eq("task_id", task_id)
        .eq("entity_id", entity_id)
        .execute()
        .data
    )
    prior_status = prior[0].get("per_entity_status") if prior else None
    prior_due_str = prior[0].get("per_entity_end_date") if prior else None

    set_fields = body.model_fields_set
    payload: dict = {}
    if body.per_entity_status is not None:
        payload["per_entity_status"] = body.per_entity_status
    # start/end are clearable (explicit null) so a per-entity span can be reset.
    if "per_entity_start_date" in set_fields:
        payload["per_entity_start_date"] = (
            body.per_entity_start_date.isoformat() if body.per_entity_start_date else None
        )
    if "per_entity_end_date" in set_fields:
        payload["per_entity_end_date"] = (
            body.per_entity_end_date.isoformat() if body.per_entity_end_date else None
        )
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    now_iso = datetime.now(timezone.utc).isoformat()
    payload["updated_at"] = now_iso

    if body.per_entity_status is not None and body.per_entity_status != prior_status:
        if body.per_entity_status == "done":
            payload["closed_at"] = now_iso
            payload["approval_state"] = (
                "pending"
                if _scope_has_approver(sb, task_id, "entity", entity_id=entity_id)
                else "none"
            )
        else:
            if prior_status == "done":
                payload["closed_at"] = None
            payload["approval_state"] = "none"

    result = (
        sb.table("task_entities")
        .update(payload)
        .eq("task_id", task_id)
        .eq("entity_id", entity_id)
        .execute()
    )

    if body.per_entity_end_date is not None:
        old_date = date.fromisoformat(prior_due_str[:10]) if prior_due_str else None
        if old_date != body.per_entity_end_date:
            sb.table("task_date_change_log").insert({
                "task_id": task_id,
                "entity_id": entity_id,
                "changed_by": user["id"],
                "old_date": old_date.isoformat() if old_date else None,
                "new_date": body.per_entity_end_date.isoformat(),
                "delay_days": (body.per_entity_end_date - old_date).days if old_date else None,
                "reason": body.change_reason,
            }).execute()

    return result.data[0] if result.data else {}


@router.post("/{task_id}/entities", status_code=201)
def add_task_entity(
    task_id: str,
    body: TaskEntityCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Attach a building/client (attribute) to an existing task. Admin/owner
    only. Returns the new row with its resolved name."""
    _assert_admin_or_owner(sb, task_id, user["id"])
    dup = (
        sb.table("task_entities")
        .select("entity_id")
        .eq("task_id", task_id)
        .eq("entity_id", body.entity_id)
        .execute()
        .data
    )
    if dup:
        raise HTTPException(status_code=409, detail="Already on this task")

    now_iso = datetime.now(timezone.utc).isoformat()
    row: dict = {
        "task_id": task_id,
        "entity_type": body.entity_type,
        "entity_id": body.entity_id,
        "per_entity_status": "backlog",
        "per_entity_start_date": body.per_entity_start_date.isoformat() if body.per_entity_start_date else None,
        "per_entity_end_date": body.per_entity_end_date.isoformat() if body.per_entity_end_date else None,
        "updated_at": now_iso,
    }
    result = sb.table("task_entities").insert(row).execute()
    out = result.data[0] if result.data else row
    tbl = "buildings" if body.entity_type == "building" else "clients"
    nm = sb.table(tbl).select("name").eq("id", body.entity_id).execute().data
    out["entity_name"] = nm[0]["name"] if nm else body.entity_id
    return out


@router.delete("/{task_id}/entities/{entity_id}", status_code=204)
def delete_task_entity(
    task_id: str,
    entity_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Remove a building/client (attribute) from a task. Admin/owner only.

    Cascade-deletes the entity-scoped subtasks under this task (and their
    nested children, which inherit the scope) plus any watchers scoped to the
    entity, so nothing is orphaned.
    """
    _assert_admin_or_owner(sb, task_id, user["id"])
    existing = (
        sb.table("task_entities")
        .select("entity_id")
        .eq("task_id", task_id)
        .eq("entity_id", entity_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Building/client not on this task")

    # Entity-scoped subtasks (and their inherited-scope children) go with it.
    sb.table("subtasks").delete().eq("task_id", task_id).eq(
        "scoped_entity_id", entity_id
    ).execute()
    # Watchers/approvers scoped to this entity row.
    sb.table("item_watchers").delete().eq("task_id", task_id).eq(
        "entity_id", entity_id
    ).execute()
    sb.table("task_entities").delete().eq("task_id", task_id).eq(
        "entity_id", entity_id
    ).execute()


@router.patch("/{task_id}/subtasks/{subtask_id}")
def update_subtask(
    task_id: str,
    subtask_id: str,
    body: SubtaskUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_write(sb, task_id, user["id"])
    # mode='json' converts date objects to ISO strings for PostgREST.
    # Same model_fields_set treatment as update_task: respect explicit null
    # so the sheet can clear due_date / description / assignee.
    set_fields = body.model_fields_set
    raw = body.model_dump(mode="json")
    payload: dict = {k: raw[k] for k in set_fields if k in raw}
    if not payload:
        raise HTTPException(status_code=422, detail="No fields to update")

    now_iso = datetime.now(timezone.utc).isoformat()
    payload["updated_at"] = now_iso

    if body.status is not None:
        prior = sb.table("subtasks").select("status").eq("id", subtask_id).execute().data
        prior_status = prior[0].get("status") if prior else None
        if body.status != prior_status:
            if body.status == "done":
                payload["closed_at"] = now_iso
                payload["approval_state"] = (
                    "pending"
                    if _scope_has_approver(sb, task_id, "subtask", subtask_id=subtask_id)
                    else "none"
                )
            else:
                if prior_status == "done":
                    payload["closed_at"] = None
                payload["approval_state"] = "none"

    result = sb.table("subtasks").update(payload).eq("id", subtask_id).eq("task_id", task_id).execute()
    return result.data[0] if result.data else {}


@router.delete("/{task_id}/subtasks/{subtask_id}", status_code=204)
def delete_subtask(
    task_id: str,
    subtask_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Delete a subtask. Cascade-deletes any nested sub-subtasks (parent_subtask_id
    children) to avoid orphans, since the schema allows one level of nesting.

    Deleting an attribute is an admin/owner-only structural change — stricter
    than PATCH (which stakeholders may use to move a subtask's status).
    """
    _assert_admin_or_owner(sb, task_id, user["id"])
    existing = (
        sb.table("subtasks")
        .select("id")
        .eq("id", subtask_id)
        .eq("task_id", task_id)
        .execute()
        .data
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Subtask not found")
    # Cascade: drop child sub-subtasks first so we don't leave orphans.
    sb.table("subtasks").delete().eq("parent_subtask_id", subtask_id).execute()
    sb.table("subtasks").delete().eq("id", subtask_id).eq("task_id", task_id).execute()


@router.post("/{task_id}/subtasks/{subtask_id}/archive", status_code=200)
def archive_subtask(
    task_id: str,
    subtask_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Archive a *done* subtask (attribute). Admin/owner only.

    Cascades to its sub-subtasks so a restored parent brings its children back.
    """
    _assert_admin_or_owner(sb, task_id, user["id"])
    rows = (
        sb.table("subtasks")
        .select("status, archived_at")
        .eq("id", subtask_id)
        .eq("task_id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Subtask not found")
    if rows[0].get("archived_at"):
        raise HTTPException(status_code=400, detail="Subtask is already archived")
    if rows[0].get("status") != "done":
        raise HTTPException(status_code=400, detail="Only a completed (done) subtask can be archived")

    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table("subtasks").update({"archived_at": now_iso, "updated_at": now_iso}).eq(
        "id", subtask_id
    ).eq("task_id", task_id).execute()
    # Cascade to nested sub-subtasks.
    sb.table("subtasks").update({"archived_at": now_iso, "updated_at": now_iso}).eq(
        "parent_subtask_id", subtask_id
    ).is_("archived_at", "null").execute()
    return {"id": subtask_id, "archived_at": now_iso}


@router.post("/{task_id}/subtasks/{subtask_id}/restore", status_code=200)
def restore_subtask(
    task_id: str,
    subtask_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Restore an archived subtask (and its sub-subtasks). Admin/owner only."""
    _assert_admin_or_owner(sb, task_id, user["id"])
    rows = (
        sb.table("subtasks")
        .select("archived_at")
        .eq("id", subtask_id)
        .eq("task_id", task_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Subtask not found")
    if not rows[0].get("archived_at"):
        raise HTTPException(status_code=400, detail="Subtask is not archived")

    now_iso = datetime.now(timezone.utc).isoformat()
    sb.table("subtasks").update({"archived_at": None, "updated_at": now_iso}).eq(
        "id", subtask_id
    ).eq("task_id", task_id).execute()
    sb.table("subtasks").update({"archived_at": None, "updated_at": now_iso}).eq(
        "parent_subtask_id", subtask_id
    ).not_.is_("archived_at", "null").execute()
    return {"id": subtask_id, "archived_at": None}


@router.get("/follow-up-today")
def follow_up_today(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return tasks where follow_up_date = today and user is primary/secondary stakeholder."""
    uid = user["id"]
    today_str = date.today().isoformat()

    # IDs user has access to
    primary_rows = (
        sb.table("tasks")
        .select("id")
        .eq("primary_stakeholder_id", uid)
        .eq("follow_up_date", today_str)
        .execute()
        .data
    )
    primary_ids = [r["id"] for r in primary_rows]

    secondary_rows = (
        sb.table("task_stakeholders")
        .select("task_id")
        .eq("user_id", uid)
        .execute()
        .data
    )
    secondary_task_ids = [r["task_id"] for r in secondary_rows]

    # Get secondary tasks that also have follow_up_date = today
    secondary_today: list = []
    if secondary_task_ids:
        secondary_today_rows = (
            sb.table("tasks")
            .select("id")
            .in_("id", secondary_task_ids)
            .eq("follow_up_date", today_str)
            .execute()
            .data
        )
        secondary_today = [r["id"] for r in secondary_today_rows]

    all_ids = list(set(primary_ids + secondary_today))
    if not all_ids:
        return []

    tasks = (
        sb.table("tasks")
        .select("*, task_entities(*), initiatives(title)")
        .in_("id", all_ids)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Resolve entity names
    for task in tasks:
        entities = task.get("task_entities") or []
        building_ids = [e["entity_id"] for e in entities if e.get("entity_type") == "building"]
        client_ids   = [e["entity_id"] for e in entities if e.get("entity_type") == "client"]
        name_map: dict = {}
        if building_ids:
            for r in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
                name_map[r["id"]] = r["name"]
        if client_ids:
            for r in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
                name_map[r["id"]] = r["name"]
        for e in entities:
            e["entity_name"] = name_map.get(e["entity_id"], e["entity_id"])
        task["task_entities"] = entities

    return tasks


_RECURRENCE_DELTAS: dict = {
    "daily": timedelta(days=1),
    "weekly": timedelta(days=7),
    "fortnightly": timedelta(days=14),
    "monthly": timedelta(days=30),
}


@router.patch("/{task_id}/recurring/mark-done")
def recurring_mark_done(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Mark a recurring task done for this cycle and advance next_meeting_at."""
    # Authz consistent with other write endpoints: primary | secondary
    # stakeholder | workspace owner/admin. Was stakeholder-only before, which
    # blocked owners from advancing recurring tasks they didn't personally own.
    _assert_task_write(sb, task_id, user["id"])
    rows = sb.table("tasks").select("primary_stakeholder_id, recurring_type, status").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task_row = rows[0]

    recurring_type = task_row.get("recurring_type")
    if not recurring_type or recurring_type not in _RECURRENCE_DELTAS:
        raise HTTPException(
            status_code=422,
            detail=f"Task recurring_type must be one of {list(_RECURRENCE_DELTAS.keys())}",
        )

    now = datetime.now(timezone.utc)
    next_meeting_at = now + _RECURRENCE_DELTAS[recurring_type]

    result = sb.table("tasks").update({
        "last_meeting_at": now.isoformat(),
        "next_meeting_at": next_meeting_at.isoformat(),
        "status": "in_progress",
        "updated_at": now.isoformat(),
    }).eq("id", task_id).execute()

    return result.data[0] if result.data else {}


# ---------------------------------------------------------------------------
# Comment endpoints — comments exist at three scopes:
#   task-level    : /tasks/{id}/comments                       (entity & subtask NULL)
#   entity-level  : /tasks/{id}/entities/{entity_id}/comments  (building/client row)
#   subtask-level : /tasks/{id}/subtasks/{subtask_id}/comments (subtask/sub-subtask)
# ---------------------------------------------------------------------------

class CommentCreate(BaseModel):
    content: str


def _list_comments_scoped(sb: Client, task_id: str, *, entity_id=None, subtask_id=None):
    """Return comments for a given scope, oldest first, with author names."""
    q = (
        sb.table("comments")
        .select("id, content, kind, user_id, created_at")
        .eq("task_id", task_id)
        .order("created_at")
    )
    if entity_id is not None:
        q = q.eq("entity_id", entity_id)
    elif subtask_id is not None:
        q = q.eq("subtask_id", subtask_id)
    else:
        # task-level: neither scope set
        q = q.is_("entity_id", "null").is_("subtask_id", "null")
    rows = q.execute().data

    user_ids = list({r["user_id"] for r in rows if r.get("user_id")})
    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name").in_("id", user_ids).execute().data:
            name_map[u["id"]] = u.get("name") or ""
    for r in rows:
        r["author_name"] = name_map.get(r["user_id"], "")
        r["author_id"] = r.pop("user_id")
    return rows


def _create_comment_scoped(sb: Client, task_id: str, user_id: str, content: str,
                           *, entity_id=None, subtask_id=None, kind: str = "note"):
    """Insert a comment for a given scope and return it with author name."""
    if not content.strip():
        raise HTTPException(status_code=422, detail="Comment content cannot be empty")
    now = datetime.now(timezone.utc).isoformat()
    payload: dict = {
        "task_id": task_id,
        "user_id": user_id,
        "content": content.strip(),
        "kind": kind,
        "created_at": now,
        "updated_at": now,
    }
    if entity_id is not None:
        payload["entity_id"] = entity_id
    if subtask_id is not None:
        payload["subtask_id"] = subtask_id
    result = sb.table("comments").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create comment")
    row = result.data[0]
    user_row = sb.table("users").select("name").eq("id", user_id).execute().data
    row["author_name"] = user_row[0].get("name", "") if user_row else ""
    row["author_id"] = row.pop("user_id")
    return row


def _list_comments_rollup(sb: Client, task_id: str) -> list:
    """P5: return every comment under the task tree (task, entity, subtask
    scope), each tagged with scope_type and the readable label of its source
    (subtask_title / entity_name) so the UI can render a scope chip.
    Oldest first — same order as the per-scope list."""
    rows = (
        sb.table("comments")
        .select(
            "id, content, kind, user_id, created_at, "
            "entity_id, subtask_id, entity_type"
        )
        .eq("task_id", task_id)
        .order("created_at")
        .execute()
        .data
    )
    if not rows:
        return []

    user_ids = list({r["user_id"] for r in rows if r.get("user_id")})
    subtask_ids = list({r["subtask_id"] for r in rows if r.get("subtask_id")})
    building_ids = list({
        r["entity_id"] for r in rows
        if r.get("entity_id") and r.get("entity_type") == "building"
    })
    client_ids = list({
        r["entity_id"] for r in rows
        if r.get("entity_id") and r.get("entity_type") == "client"
    })

    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name").in_("id", user_ids).execute().data:
            name_map[u["id"]] = u.get("name") or ""

    subtask_titles: dict = {}
    if subtask_ids:
        for s in sb.table("subtasks").select("id, title").in_("id", subtask_ids).execute().data:
            subtask_titles[s["id"]] = s.get("title") or ""

    entity_names: dict = {}
    if building_ids:
        for b in sb.table("buildings").select("id, name").in_("id", building_ids).execute().data:
            entity_names[b["id"]] = b.get("name") or ""
    if client_ids:
        for c in sb.table("clients").select("id, name").in_("id", client_ids).execute().data:
            entity_names[c["id"]] = c.get("name") or ""

    out = []
    for r in rows:
        scope_type = (
            "subtask" if r.get("subtask_id") else
            "entity" if r.get("entity_id") else
            "task"
        )
        out.append({
            "id": r["id"],
            "content": r["content"],
            "kind": r.get("kind") or "note",
            "author_id": r.get("user_id"),
            "author_name": name_map.get(r.get("user_id") or "", ""),
            "created_at": r["created_at"],
            "scope_type": scope_type,
            "subtask_id": r.get("subtask_id"),
            "subtask_title": subtask_titles.get(r.get("subtask_id") or "", "") if r.get("subtask_id") else None,
            "entity_id": r.get("entity_id"),
            "entity_type": r.get("entity_type"),
            "entity_name": entity_names.get(r.get("entity_id") or "", "") if r.get("entity_id") else None,
        })
    return out


# ── Task-level ────────────────────────────────────────────────────────────────

@router.get("/{task_id}/comments")
@router.get("/{task_id}/comments/", include_in_schema=False)
def list_task_comments(
    task_id: str,
    include_descendants: bool = Query(
        default=False,
        description="P5: when true, return every comment under the task tree "
                    "(task-, entity-, and subtask-scope) tagged by source.",
    ),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    if not include_descendants:
        rows = _list_comments_scoped(sb, task_id)
        for r in rows:
            r["scope_type"] = "task"
        return rows
    return _list_comments_rollup(sb, task_id)


@router.post("/{task_id}/comments", status_code=201)
@router.post("/{task_id}/comments/", status_code=201, include_in_schema=False)
def create_task_comment(
    task_id: str,
    body: CommentCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    return _create_comment_scoped(sb, task_id, user["id"], body.content)


# ── Entity-level ──────────────────────────────────────────────────────────────

@router.get("/{task_id}/entities/{entity_id}/comments")
def list_entity_comments(
    task_id: str,
    entity_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    return _list_comments_scoped(sb, task_id, entity_id=entity_id)


@router.post("/{task_id}/entities/{entity_id}/comments", status_code=201)
def create_entity_comment(
    task_id: str,
    entity_id: str,
    body: CommentCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    return _create_comment_scoped(sb, task_id, user["id"], body.content, entity_id=entity_id)


# ── Subtask-level (covers sub-subtasks too) ──────────────────────────────────

@router.get("/{task_id}/subtasks/{subtask_id}/comments")
def list_subtask_comments(
    task_id: str,
    subtask_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    return _list_comments_scoped(sb, task_id, subtask_id=subtask_id)


@router.post("/{task_id}/subtasks/{subtask_id}/comments", status_code=201)
def create_subtask_comment(
    task_id: str,
    subtask_id: str,
    body: CommentCreate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    _assert_task_access(sb, task_id, user["id"])
    return _create_comment_scoped(sb, task_id, user["id"], body.content, subtask_id=subtask_id)


# ---------------------------------------------------------------------------
# Due-date change history
# ---------------------------------------------------------------------------

@router.get("/{task_id}/date-changes")
def list_date_changes(
    task_id: str,
    entity_id: Optional[str] = Query(
        default=None,
        description="If set, return changes for that entity's due date; "
                    "otherwise the task-level due-date history.",
    ),
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return the due-date change history (newest first) with changer names."""
    _assert_task_access(sb, task_id, user["id"])
    q = (
        sb.table("task_date_change_log")
        .select("id, old_date, new_date, delay_days, reason, changed_by, created_at")
        .eq("task_id", task_id)
        .order("created_at", desc=True)
    )
    if entity_id is not None:
        q = q.eq("entity_id", entity_id)
    else:
        q = q.is_("entity_id", "null").is_("subtask_id", "null")
    rows = q.execute().data

    user_ids = list({r["changed_by"] for r in rows if r.get("changed_by")})
    name_map: dict = {}
    if user_ids:
        for u in sb.table("users").select("id, name").in_("id", user_ids).execute().data:
            name_map[u["id"]] = u.get("name") or ""
    for r in rows:
        r["changed_by_name"] = name_map.get(r.get("changed_by") or "", "")
    return rows


class DependenciesUpdate(BaseModel):
    depends_on: List[str]


@router.get("/{task_id}/dependencies")
def get_task_dependencies(
    task_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Return tasks this task depends on and tasks that depend on this task."""
    rows = sb.table("tasks").select("primary_stakeholder_id, depends_on").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")
    task_row = rows[0]

    # Auth
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = (
        task_row["primary_stakeholder_id"] == user["id"]
        or any(s["user_id"] == user["id"] for s in stakeholders)
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")

    # Tasks this task depends on
    depends_on_ids: list = task_row.get("depends_on") or []
    depends_on_tasks: list = []
    if depends_on_ids:
        depends_on_tasks = (
            sb.table("tasks")
            .select("id, title, status, priority")
            .in_("id", depends_on_ids)
            .execute()
            .data
        )

    # Tasks that depend ON this task (reverse lookup via RPC or filter)
    # Supabase postgrest: use cs (contains) operator for array column
    reverse_rows = (
        sb.table("tasks")
        .select("id, title, status, priority")
        .cs("depends_on", [task_id])
        .execute()
        .data
    )

    return {
        "depends_on": depends_on_tasks,
        "depended_on_by": reverse_rows,
    }


@router.patch("/{task_id}/dependencies")
def update_task_dependencies(
    task_id: str,
    body: DependenciesUpdate,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Replace the full depends_on array for a task."""
    rows = sb.table("tasks").select("primary_stakeholder_id").eq("id", task_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Task not found")

    # Auth
    stakeholders = sb.table("task_stakeholders").select("user_id").eq("task_id", task_id).execute().data
    is_member = (
        rows[0]["primary_stakeholder_id"] == user["id"]
        or any(s["user_id"] == user["id"] for s in stakeholders)
    )
    if not is_member:
        raise HTTPException(status_code=403, detail="Not a stakeholder")

    # Validate every dependency is a real task in the SAME workspace
    # (audit N6) — otherwise depends_on could point at another tenant's
    # tasks, leaking their existence and polluting the dependency graph.
    if body.depends_on:
        if task_id in body.depends_on:
            raise HTTPException(status_code=400, detail="A task cannot depend on itself")
        biz_id = _task_business_id(sb, task_id)
        dep_tasks = (
            sb.table("tasks").select("id, initiative_id")
            .in_("id", body.depends_on).execute().data
        )
        if len(dep_tasks) != len(set(body.depends_on)):
            raise HTTPException(status_code=400, detail="Unknown dependency task id(s)")
        dep_init_ids = list({t["initiative_id"] for t in dep_tasks if t.get("initiative_id")})
        dep_inits = (
            sb.table("initiatives").select("id, business_id")
            .in_("id", dep_init_ids).execute().data
            if dep_init_ids else []
        )
        if biz_id is None or any(i["business_id"] != biz_id for i in dep_inits):
            raise HTTPException(
                status_code=400,
                detail="Dependencies must be tasks in the same workspace",
            )

    result = sb.table("tasks").update({
        "depends_on": body.depends_on,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", task_id).execute()

    return result.data[0] if result.data else {}
