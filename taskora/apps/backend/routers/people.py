"""People board — the management cockpit.

Two surfaces over the same scoped data:

* ``GET /board``            — gallery: one summary card per person who owns
  work, ranked by a push-score so the person to chase floats to the top.
* ``GET /board/{user_id}``  — focus: that person's full picture, tasks grouped
  Program > Initiative and pre-bucketed into Kanban columns.

Access is owner/admin by default; admins can grant individual members the
``can_view_people_board`` flag (see migration 024). The board aggregates only
across businesses where the caller actually has that access.

Every external table is read with a single batched query and the task rows go
through the shared ``enrich_task_items`` once — query count is constant in the
number of tasks (no N+1), mirroring Daily Brief / War Room.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from supabase import Client

from auth import get_current_user
from deps import get_supabase, people_board_access_ok
from routers._decision_context import enrich_task_items, make_link

router = APIRouter(prefix="/api/v1/people", tags=["people"])

_STALE_DAYS = 7
_DONE = ("done", "archived")

# Kanban columns, in display order. The UI is dumb — it just renders these.
COLUMNS = [
    {"key": "todo", "label": "To Do"},
    {"key": "in_progress", "label": "In Progress"},
    {"key": "needs_decision", "label": "Needs Decision"},
    {"key": "blocked", "label": "Blocked"},
    {"key": "awaiting_approval", "label": "Awaiting Approval"},
    {"key": "done", "label": "Done"},
]


def _column_of(task: dict) -> str:
    """Approval is orthogonal to status: a pending-approval task belongs in the
    Approval column whatever its status (a Done task can still be awaiting it)."""
    if task.get("approval_state") == "pending":
        return "awaiting_approval"
    s = task.get("status")
    if s in _DONE:
        return "done"
    if s == "blocked":
        return "blocked"
    if s == "pending_decision":
        return "needs_decision"
    if s in ("in_progress", "reopened"):
        return "in_progress"
    return "todo"  # backlog, todo, anything else


def _member_biz_ids(sb: Client, uid: str) -> list[str]:
    return [
        r["business_id"]
        for r in (
            sb.table("business_members")
            .select("business_id")
            .eq("user_id", uid)
            .execute()
            .data
        )
    ]


def _scope(sb: Client, uid: str):
    """(mode, biz_ids, init_meta, tasks). Raises 403 if no access.

    mode='full' — owner/admin or explicitly granted in ≥1 business: sees the
    whole roster. mode='self' — no full access but the caller owns work
    (a task's primary, or an initiative owner/primary): sees only themselves.
    """
    member = _member_biz_ids(sb, uid)
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="People board access required",
        )
    full = [b for b in member if people_board_access_ok(sb, b, uid)]
    biz_ids = full if full else member

    init_meta: dict = {}
    for r in (
        sb.table("initiatives")
        .select("id, name, business_id, program_id, owner_id, "
                "primary_stakeholder_id, status")
        .in_("business_id", biz_ids)
        .execute()
        .data
    ):
        init_meta[r["id"]] = r

    tasks: list = []
    if init_meta:
        tasks = (
            sb.table("tasks")
            .select("*")
            .in_("initiative_id", sorted(init_meta.keys()))
            .execute()
            .data
        )

    if full:
        return "full", biz_ids, init_meta, tasks

    owns_work = (
        any(t.get("primary_stakeholder_id") == uid for t in tasks)
        or any(i.get("owner_id") == uid
               or i.get("primary_stakeholder_id") == uid
               for i in init_meta.values())
    )
    if not owns_work:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="People board access required",
        )
    return "self", biz_ids, init_meta, tasks


def _empty_counts() -> dict:
    return {"open": 0, "overdue": 0, "blocked": 0, "due_this_week": 0,
            "pending_decision": 0, "stale": 0, "awaiting_their_approval": 0}


def _count(tasks: list, approving_task_ids: set) -> dict:
    """Load counters over the given task rows. ``approving_task_ids`` are tasks
    where this person is a pending approver (drives awaiting_their_approval)."""
    today = date.today().isoformat()
    week = (date.today() + timedelta(days=7)).isoformat()
    stale_cut = (date.today() - timedelta(days=_STALE_DAYS)).isoformat()
    c = _empty_counts()
    for t in tasks:
        s = t.get("status")
        open_ = s not in _DONE
        due = t.get("due_date") or ""
        if open_:
            c["open"] += 1
        if open_ and due and due < today:
            c["overdue"] += 1
        if s == "blocked":
            c["blocked"] += 1
        if due and today <= due <= week:
            c["due_this_week"] += 1
        if s == "pending_decision":
            c["pending_decision"] += 1
        if open_ and (t.get("updated_at") or "") < stale_cut:
            c["stale"] += 1
    c["awaiting_their_approval"] = len(approving_task_ids)
    return c


def _push_score(c: dict) -> int:
    return (c["overdue"] * 3 + c["blocked"] * 2 + c["pending_decision"] * 2
            + c["awaiting_their_approval"] * 2 + c["stale"])


def _approver_ids_by_task(sb: Client, task_ids: list[str]) -> dict:
    """task_id -> set(user_id) of task-scope approvers (only meaningful while
    the task itself is pending)."""
    out: dict = {}
    if not task_ids:
        return out
    for r in (
        sb.table("item_watchers")
        .select("task_id, user_id, role, scope_type")
        .in_("task_id", task_ids)
        .eq("role", "approver")
        .eq("scope_type", "task")
        .execute()
        .data
    ):
        out.setdefault(r["task_id"], set()).add(r["user_id"])
    return out


_PUSH_STATES = ("pending_decision", "blocked", "reopened")


def _needs_push(status: str | None, due: str | None, today: str) -> str | None:
    """Reason this item needs a push, or None. Overdue takes precedence so the
    most actionable label wins."""
    if due and due < today and status not in _DONE:
        return "overdue"
    if status in _PUSH_STATES:
        return status
    return None


@router.get("/board")
def get_board(
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Gallery: people who own work, each with load counters + push-score."""
    uid = user["id"]
    mode, biz_ids, init_meta, tasks = _scope(sb, uid)

    task_ids = [t["id"] for t in tasks if t.get("id")]
    stk_rows = (
        sb.table("task_stakeholders")
        .select("task_id, user_id, role")
        .in_("task_id", task_ids)
        .execute()
        .data
        if task_ids else []
    )
    approver_ids = _approver_ids_by_task(sb, task_ids)

    # Roster = people who own work: a task's primary stakeholder, or an
    # initiative's owner / primary stakeholder.
    owner_ids: set = {t["primary_stakeholder_id"] for t in tasks
                      if t.get("primary_stakeholder_id")}
    for i in init_meta.values():
        if i.get("owner_id"):
            owner_ids.add(i["owner_id"])
        if i.get("primary_stakeholder_id"):
            owner_ids.add(i["primary_stakeholder_id"])
    owner_ids.discard(None)

    # Self mode: a work-owner without full access sees only their own card.
    if mode == "self":
        owner_ids = {uid} & owner_ids

    # Per-person resolved metadata
    name_map, avatar_map = {}, {}
    if owner_ids:
        for r in (
            sb.table("users")
            .select("id, name, avatar_url")
            .in_("id", sorted(owner_ids))
            .execute()
            .data
        ):
            name_map[r["id"]] = r.get("name") or ""
            avatar_map[r["id"]] = r.get("avatar_url")
    member_meta: dict = {}
    for r in (
        sb.table("business_members")
        .select("user_id, role, can_view_people_board")
        .in_("business_id", biz_ids)
        .execute()
        .data
    ):
        # First membership wins; owner/admin or any grant is the strongest.
        cur = member_meta.get(r["user_id"])
        if cur is None or r.get("role") in ("owner", "admin"):
            member_meta[r["user_id"]] = r

    people = []
    for pid in sorted(owner_ids):
        owned = [t for t in tasks if t.get("primary_stakeholder_id") == pid]
        approving = {tid for tid, us in approver_ids.items()
                     if pid in us
                     and next((t for t in tasks if t["id"] == tid), {})
                         .get("approval_state") == "pending"}
        counts = _count(owned, approving)
        led = [i for i in init_meta.values()
               if i.get("owner_id") == pid or i.get("primary_stakeholder_id") == pid]
        prog_ids = {init_meta[t["initiative_id"]].get("program_id")
                    for t in owned
                    if t.get("initiative_id") in init_meta}
        prog_ids |= {i.get("program_id") for i in led}
        prog_ids.discard(None)
        mm = member_meta.get(pid, {})
        people.append({
            "user_id": pid,
            "name": name_map.get(pid, ""),
            "avatar_url": avatar_map.get(pid),
            "role": mm.get("role"),
            "can_view_people_board": bool(mm.get("can_view_people_board")),
            "counts": counts,
            "push_score": _push_score(counts),
            "initiatives_led": len(led),
            "programs_touched": len(prog_ids),
        })
    people.sort(key=lambda p: (-p["push_score"], p["name"].lower()))

    totals = _empty_counts()
    for p in people:
        for k in totals:
            totals[k] += p["counts"][k]
    totals["people"] = len(people)

    return {"generated_at": date.today().isoformat(),
            "mode": mode, "people": people, "totals": totals}


@router.get("/board/{target_user_id}")
def get_person_focus(
    target_user_id: str,
    user: dict = Depends(get_current_user),
    sb: Client = Depends(get_supabase),
):
    """Focus: one person's full picture — tasks grouped Program > Initiative,
    each pre-bucketed into a Kanban column."""
    uid = user["id"]
    mode, biz_ids, init_meta, all_tasks = _scope(sb, uid)
    if mode == "self" and target_user_id != uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="People board access required",
        )

    all_ids = [t["id"] for t in all_tasks if t.get("id")]
    stk_for = {
        r["task_id"]
        for r in (
            sb.table("task_stakeholders")
            .select("task_id, user_id")
            .in_("task_id", all_ids)
            .eq("user_id", target_user_id)
            .execute()
            .data
            if all_ids else []
        )
    }
    approver_ids = _approver_ids_by_task(sb, all_ids)
    approving_for = {
        tid for tid, us in approver_ids.items() if target_user_id in us
    }

    # Tasks the person is on: primary, secondary, or pending approver.
    def _on(t: dict) -> bool:
        return (
            t.get("primary_stakeholder_id") == target_user_id
            or t["id"] in stk_for
            or (t["id"] in approving_for and t.get("approval_state") == "pending")
        )

    tasks = [t for t in all_tasks if _on(t)]
    if not tasks and target_user_id not in {
        i.get("owner_id") for i in init_meta.values()
    } | {i.get("primary_stakeholder_id") for i in init_meta.values()}:
        # Nothing owned and leads nothing in scope.
        urow = (
            sb.table("users").select("id, name, avatar_url")
            .eq("id", target_user_id).execute().data
        )
        if not urow:
            raise HTTPException(status_code=404, detail="User not found")

    enrich_task_items(sb, tasks)

    pending_appr = {
        tid for tid, us in approver_ids.items()
        if target_user_id in us
        and next((t for t in tasks if t["id"] == tid), {})
            .get("approval_state") == "pending"
    }

    # Group Program > Initiative > tasks
    prog_groups: dict = {}
    for t in tasks:
        t["column"] = _column_of(t)
        if t.get("primary_stakeholder_id") == target_user_id:
            t["role_of_person"] = "primary"
        elif t["id"] in pending_appr:
            t["role_of_person"] = "approver"
        else:
            t["role_of_person"] = "contributor"

        im = init_meta.get(t.get("initiative_id") or "", {})
        pid = im.get("program_id") or "_none"
        pg = prog_groups.setdefault(pid, {
            "program_id": im.get("program_id"),
            "program_name": t.get("program_name") or "Unprogrammed",
            "initiatives": {},
        })
        iid = t.get("initiative_id") or "_none"
        ig = pg["initiatives"].setdefault(iid, {
            "initiative_id": im.get("id"),
            "name": t.get("initiative_name") or "Unassigned",
            "role_of_person": (
                "owner" if im.get("owner_id") == target_user_id
                else "primary" if im.get("primary_stakeholder_id") == target_user_id
                else "contributor"
            ),
            "tasks": [],
        })
        ig["tasks"].append(t)

    programs = []
    for pg in prog_groups.values():
        inits = list(pg["initiatives"].values())
        for ig in inits:
            its = ig["tasks"]
            done = sum(1 for x in its if x.get("status") in _DONE)
            ig["completion_pct"] = round(done / len(its) * 100) if its else 0
            ig["counts"] = _count(
                [x for x in its if x.get("primary_stakeholder_id") == target_user_id],
                {x["id"] for x in its
                 if x["id"] in pending_appr},
            )
        inits.sort(key=lambda x: (x["name"] or "").lower())
        pg["initiatives"] = inits
        programs.append(pg)
    programs.sort(key=lambda p: (p["program_name"] or "").lower())

    owned = [t for t in tasks if t.get("primary_stakeholder_id") == target_user_id]
    counts = _count(owned, pending_appr)

    # ── Needs a push ────────────────────────────────────────────────────────
    # Across this person's owned tasks, what is stalled
    # (overdue/blocked/pending_decision/reopened) and pending with *someone
    # else* — a sub-task assignee, a secondary stakeholder, or a stuck
    # building/client row. Grouped by the person it is pending with so
    # management knows who to push, and how many items.
    today = date.today().isoformat()
    owned_ids = [t["id"] for t in owned]
    by_id = {t["id"]: t for t in owned}

    subs = (
        sb.table("subtasks")
        .select("id, task_id, title, status, assignee_id")
        .in_("task_id", owned_ids)
        .execute()
        .data
        if owned_ids else []
    )
    sec_by_task: dict = {}
    for r in (
        sb.table("task_stakeholders")
        .select("task_id, user_id, role")
        .in_("task_id", owned_ids)
        .execute()
        .data
        if owned_ids else []
    ):
        if r.get("role") == "secondary" and r["user_id"] != target_user_id:
            sec_by_task.setdefault(r["task_id"], []).append(r["user_id"])
    ents = (
        sb.table("task_entities")
        .select("task_id, entity_id, entity_type, per_entity_status, "
                "per_entity_end_date")
        .in_("task_id", owned_ids)
        .execute()
        .data
        if owned_ids else []
    )
    ent_name: dict = {}
    b_ids = [e["entity_id"] for e in ents if e.get("entity_type") == "building"]
    c_ids = [e["entity_id"] for e in ents if e.get("entity_type") == "client"]
    if b_ids:
        for r in sb.table("buildings").select("id, name").in_("id", b_ids).execute().data:
            ent_name[r["id"]] = r["name"]
    if c_ids:
        for r in sb.table("clients").select("id, name").in_("id", c_ids).execute().data:
            ent_name[r["id"]] = r["name"]

    UNASSIGNED = "__unassigned__"
    push_groups: dict = {}

    def _add(owner_id, item):
        key = owner_id or UNASSIGNED
        push_groups.setdefault(key, []).append(item)

    for t in owned:
        tr = _needs_push(t.get("status"), t.get("due_date"), today)
        secs = sec_by_task.get(t["id"], [])
        ctx = {"task_id": t["id"],
               "initiative_name": t.get("initiative_name"),
               "program_name": t.get("program_name")}
        if tr and secs:
            for s in secs:
                _add(s, {"kind": "task", "id": t["id"],
                         "title": t.get("title") or "Untitled",
                         "reason": tr, "link": make_link(t),
                         "days_overdue": t.get("days_overdue", 0), **ctx})
        for e in (e for e in ents if e["task_id"] == t["id"]):
            er = _needs_push(e.get("per_entity_status"),
                             e.get("per_entity_end_date"), today)
            if not er:
                continue
            owner = secs[0] if len(secs) == 1 else None
            _add(owner, {"kind": "entity", "id": e["entity_id"],
                         "title": ent_name.get(e["entity_id"],
                                               e.get("entity_type") or "Item"),
                         "reason": er, "link": make_link(t),
                         "days_overdue": 0, **ctx})
        for st in (s for s in subs if s["task_id"] == t["id"]):
            if st.get("status") in _DONE:
                continue
            sr = _needs_push(st.get("status"), None, today) or tr
            if not sr:
                continue
            if st.get("assignee_id") == target_user_id:
                continue
            _add(st.get("assignee_id"),
                 {"kind": "subtask", "id": st["id"],
                  "title": st.get("title") or "Untitled",
                  "reason": sr, "link": make_link(t, subtask_id=st["id"]),
                  "days_overdue": 0, **ctx})

    push_uids = [k for k in push_groups if k != UNASSIGNED]
    pname, pavatar = {}, {}
    if push_uids:
        for r in (
            sb.table("users").select("id, name, avatar_url")
            .in_("id", push_uids).execute().data
        ):
            pname[r["id"]] = r.get("name") or ""
            pavatar[r["id"]] = r.get("avatar_url")
    needs_push = []
    for key, items in push_groups.items():
        is_un = key == UNASSIGNED
        needs_push.append({
            "user_id": None if is_un else key,
            "name": "Unassigned" if is_un else pname.get(key, ""),
            "avatar_url": None if is_un else pavatar.get(key),
            "count": len(items),
            "items": items,
        })
    needs_push.sort(key=lambda g: (g["user_id"] is None, -g["count"],
                                   (g["name"] or "").lower()))

    urow = (
        sb.table("users").select("id, name, avatar_url")
        .eq("id", target_user_id).execute().data
    )
    if not urow:
        raise HTTPException(status_code=404, detail="User not found")
    mrow = (
        sb.table("business_members")
        .select("role, can_view_people_board")
        .in_("business_id", biz_ids)
        .eq("user_id", target_user_id)
        .execute()
        .data
    )
    mm = mrow[0] if mrow else {}

    return {
        "generated_at": date.today().isoformat(),
        "person": {
            "user_id": target_user_id,
            "name": urow[0].get("name") or "",
            "avatar_url": urow[0].get("avatar_url"),
            "role": mm.get("role"),
            "can_view_people_board": bool(mm.get("can_view_people_board")),
        },
        "counts": counts,
        "push_score": _push_score(counts),
        "columns": COLUMNS,
        "programs": programs,
        "needs_push": needs_push,
    }
