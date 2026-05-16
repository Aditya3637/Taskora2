"""In-memory PostgREST-style fake Supabase client for end-to-end logic tests.

Backs the supabase query-builder surface the tasks router actually uses
(table/select/insert/update/delete/upsert + eq/in_/is_/lt/order/limit/execute)
with plain dicts, and enforces the DB constraints that matter for the approval
workflow so logic bugs surface as failures instead of passing silently:

  * tasks/subtasks status CHECK (incl. 'reopened')
  * tasks/subtasks/task_entities approval_state CHECK
  * comments single-scope CHECK (entity_id IS NULL OR subtask_id IS NULL)
  * comments.kind CHECK
  * item_watchers scope-shape + the dedup unique index
"""
from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone

NIL = "00000000-0000-0000-0000-000000000000"

_TASK_STATUS = {"backlog", "todo", "in_progress", "pending_decision",
                "blocked", "done", "archived", "reopened"}
_SUB_STATUS = {"backlog", "todo", "in_progress", "pending_decision",
               "blocked", "done", "reopened"}
_APPROVAL = {"none", "pending", "approved", "rejected"}
_COMMENT_KIND = {"note", "rejection", "approval"}


class ConstraintError(Exception):
    """Raised on a violated CHECK/UNIQUE — mimics a Postgres rejection."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_row(table: str, row: dict, store: dict) -> None:
    if table == "tasks":
        if "status" in row and row["status"] not in _TASK_STATUS:
            raise ConstraintError(f"tasks_status_check: {row['status']}")
        if "approval_state" in row and row["approval_state"] not in _APPROVAL:
            raise ConstraintError(f"tasks_approval_state_check: {row['approval_state']}")
    elif table == "subtasks":
        if "status" in row and row["status"] not in _SUB_STATUS:
            raise ConstraintError(f"subtasks_status_check: {row['status']}")
        if "approval_state" in row and row["approval_state"] not in _APPROVAL:
            raise ConstraintError(f"subtasks_approval_state_check: {row['approval_state']}")
    elif table == "task_entities":
        if "per_entity_status" in row and row["per_entity_status"] not in _SUB_STATUS:
            raise ConstraintError(
                f"task_entities_per_entity_status_check: {row['per_entity_status']}"
            )
        if "approval_state" in row and row["approval_state"] not in _APPROVAL:
            raise ConstraintError(
                f"task_entities_approval_state_check: {row['approval_state']}"
            )
    elif table == "comments":
        if row.get("entity_id") is not None and row.get("subtask_id") is not None:
            raise ConstraintError("comments_single_scope")
        if row.get("kind", "note") not in _COMMENT_KIND:
            raise ConstraintError(f"comments_kind_check: {row.get('kind')}")
    elif table == "item_watchers":
        st = row.get("scope_type")
        sid, eid, et = row.get("subtask_id"), row.get("entity_id"), row.get("entity_type")
        ok = (
            (st == "task" and sid is None and eid is None)
            or (st == "subtask" and sid is not None and eid is None)
            or (st == "entity" and sid is None and eid is not None and et is not None)
        )
        if not ok:
            raise ConstraintError(f"item_watchers_scope_shape: {row}")
        key = (row.get("task_id"), st, sid or NIL, eid or NIL,
               row.get("user_id"), row.get("role"))
        for other in store.get("item_watchers", []):
            if other is row:
                continue
            okey = (other.get("task_id"), other.get("scope_type"),
                    other.get("subtask_id") or NIL, other.get("entity_id") or NIL,
                    other.get("user_id"), other.get("role"))
            if okey == key:
                raise ConstraintError("uq_item_watchers_assignment")
    elif table == "approval_log":
        if row.get("action") not in {"approve", "reject"}:
            raise ConstraintError(f"approval_log action: {row.get('action')}")


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, client: "FakeSupabase", table: str):
        self._c = client
        self._t = table
        self._op = "select"
        self._payload = None
        self._on_conflict = None
        self._filters = []          # list of (kind, col, val)
        self._order = None          # (col, desc)
        self._limit = None
        self._embeds = []           # nested relation names

    # ---- builders ---------------------------------------------------------
    def select(self, cols="*", **_):
        self._op = "select"
        if "(" in cols:
            # "*, task_entities(*), comments(*)" → grab relation names
            import re
            self._embeds = re.findall(r"(\w+)\(", cols)
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def upsert(self, payload, on_conflict=None):
        self._op = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def is_(self, col, _val):
        self._filters.append(("isnull", col, None))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
        return self

    def cs(self, col, val):
        self._filters.append(("cs", col, val))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    # ---- terminal ---------------------------------------------------------
    def _match(self, rows):
        out = []
        for r in rows:
            ok = True
            for kind, col, val in self._filters:
                if kind == "eq":
                    if r.get(col) != val:
                        ok = False
                        break
                elif kind == "in":
                    if r.get(col) not in val:
                        ok = False
                        break
                elif kind == "isnull":
                    if r.get(col) is not None:
                        ok = False
                        break
                elif kind == "lt":
                    if not (r.get(col) is not None and r.get(col) < val):
                        ok = False
                        break
                elif kind == "cs":
                    if val[0] not in (r.get(col) or []):
                        ok = False
                        break
            if ok:
                out.append(r)
        return out

    def execute(self):
        store = self._c.store
        rows = store.setdefault(self._t, [])

        if self._op == "select":
            res = self._match(rows)
            if self._order:
                col, desc = self._order
                res = sorted(res, key=lambda r: (r.get(col) is None, r.get(col)),
                             reverse=desc)
            if self._limit is not None:
                res = res[: self._limit]
            res = [copy.deepcopy(r) for r in res]
            for r in res:
                for rel in self._embeds:
                    rel_rows = store.get(rel, [])
                    fk = "task_id" if rel != "tasks" else "id"
                    r[rel] = [copy.deepcopy(x) for x in rel_rows
                              if x.get(fk) == r.get("id")]
            return _Result(res)

        if self._op in ("insert", "upsert"):
            if self._t in self._c.fail_inserts:
                raise ConstraintError(f"simulated insert failure on {self._t}")
            payload = self._payload
            many = isinstance(payload, list)
            items = payload if many else [payload]
            inserted = []
            for it in items:
                it = dict(it)
                if self._op == "upsert" and self._on_conflict:
                    keys = [k.strip() for k in self._on_conflict.split(",")]
                    existing = next(
                        (x for x in rows
                         if all(x.get(k) == it.get(k) for k in keys)), None
                    )
                    if existing:
                        existing.update(it)
                        _check_row(self._t, existing, store)
                        inserted.append(copy.deepcopy(existing))
                        continue
                it.setdefault("id", str(uuid.uuid4()))
                it.setdefault("created_at", _now())
                if self._t in ("tasks", "subtasks", "task_entities"):
                    it.setdefault("approval_state", "none")
                if self._t == "comments":
                    it.setdefault("kind", "note")
                    # Columns always exist in Postgres (NULL when unscoped).
                    it.setdefault("entity_id", None)
                    it.setdefault("subtask_id", None)
                _check_row(self._t, it, store)
                rows.append(it)
                inserted.append(copy.deepcopy(it))
            return _Result(inserted if many else inserted)

        if self._op == "update":
            updated = []
            for r in self._match(rows):
                r.update(self._payload)
                _check_row(self._t, r, store)
                updated.append(copy.deepcopy(r))
            return _Result(updated)

        if self._op == "delete":
            keep, removed = [], []
            matched = self._match(rows)
            for r in rows:
                (removed if r in matched else keep).append(r)
            store[self._t] = keep
            return _Result([copy.deepcopy(r) for r in removed])

        return _Result([])


class FakeSupabase:
    def __init__(self, store=None):
        self.store = store or {}
        # Tables whose next insert should raise (simulate a mid-flow failure
        # to exercise compensating-cleanup paths).
        self.fail_inserts: set = set()

    def table(self, name):
        return _Query(self, name)
