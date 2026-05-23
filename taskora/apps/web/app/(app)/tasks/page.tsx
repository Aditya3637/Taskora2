"use client";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, X, User, MessageSquare, Eye, ShieldCheck, GanttChartSquare, MoreHorizontal, Search, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { GanttModal } from "../gantt/GanttChart";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const token = session.access_token;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
      },
    });
  } catch (e: any) {
    throw new Error(`Network error: ${e?.message}`);
  }
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d: any) => d.detail ?? d.message ?? `HTTP ${res.status}`)
      .catch(() => `HTTP ${res.status}`);
    throw new Error(String(detail));
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

type MyInitiative = {
  id: string;
  name: string;
  status: string;
  impact?: string;
  impact_category?: string;
  primary_stakeholder_id?: string;
  primary_stakeholder_name?: string;
  programs?: { id: string; name: string; color: string } | null;
  target_end_date?: string;
};

type Watcher = {
  id: string;
  user_id: string;
  name?: string;
  email?: string;
  role: "follower" | "approver";
  scope_type: "task" | "subtask" | "entity";
  subtask_id?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
};

type TaskEntity = {
  entity_id: string;
  entity_name?: string;
  entity_type?: string;
  per_entity_status?: string;
  per_entity_end_date?: string;
  closed_at?: string | null;
  approval_state?: string;
  watchers?: Watcher[];
  date_change_count?: number;
  latest_comment?: LatestComment;
};

type Stakeholder = {
  user_id: string;
  role: string;
  name?: string;
  email?: string;
};

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date?: string;
  initiative_id?: string;
  task_entities?: TaskEntity[];
  is_stale?: boolean;
  primary_stakeholder_id?: string;
  created_at?: string;
  closed_at?: string | null;
  approval_state?: string;
  watchers?: Watcher[];
  date_change_count?: number;
  latest_comment?: LatestComment;
};

type Subtask = {
  id: string;
  title: string;
  status: string;
  assignee_id?: string;
  assignee_name?: string;
  parent_subtask_id?: string | null;
  scoped_entity_id?: string | null;
  scoped_entity_type?: string | null;
  closed_at?: string | null;
  approval_state?: string;
  watchers?: Watcher[];
  latest_comment?: LatestComment;
};

type DateChange = {
  id: string;
  old_date: string | null;
  new_date: string | null;
  delay_days: number | null;
  reason?: string | null;
  changed_by_name?: string;
  created_at: string;
};

// Shape returned by GET /tasks/{id}/subtasks-grouped (B4).
type SubtasksGrouped = {
  by_entity: Record<string, Subtask[]>;
  task_flat: Subtask[];
};

type Member = { user_id: string; name: string; email: string };
type BuildingEntity = { id: string; name: string; zone?: string };
type ClientEntity = { id: string; name: string };

type Comment = {
  id: string;
  content: string;
  author_name?: string;
  author_id?: string;
  kind?: string;
  created_at: string;
};

type LatestComment = {
  content: string;
  author_name?: string;
  kind?: string;
  created_at: string;
} | null;

// ── Constants ────────────────────────────────────────────────────────────────

// B6: Source of truth for task statuses. Matches the DB CHECK constraint on
// tasks.status (migration 002) and the Pydantic _TASK_STATUSES Literal.
const TASK_STATUS_ORDER = [
  "backlog",
  "todo",
  "in_progress",
  "pending_decision",
  "blocked",
  "done",
  "reopened",
  "archived",
] as const;

// Subtasks / per-entity statuses share the same values minus 'archived'.
const SUBTASK_STATUS_ORDER = [
  "backlog",
  "todo",
  "in_progress",
  "pending_decision",
  "blocked",
  "done",
  "reopened",
] as const;

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "In Progress",
  pending_decision: "Pending Decision",
  blocked: "Blocked",
  done: "Done",
  reopened: "Reopened",
  archived: "Archived",
};

const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-gray-100 text-gray-500",
  todo: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-800",
  pending_decision: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  done: "bg-green-100 text-green-800",
  reopened: "bg-red-100 text-red-800",
  archived: "bg-gray-100 text-gray-400",
};

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  critical: "border-l-red-600",
  high: "border-l-amber-400",
  medium: "border-l-blue-400",
  low: "border-l-gray-300",
};

const IMPACT_CATEGORY_COLOR: Record<string, string> = {
  cost: "bg-green-100 text-green-700 border-green-200",
  customer_experience: "bg-blue-100 text-blue-700 border-blue-200",
  process_efficiency: "bg-purple-100 text-purple-700 border-purple-200",
  others: "bg-gray-100 text-gray-600 border-gray-200",
  other: "bg-gray-100 text-gray-600 border-gray-200",
};

const IMPACT_CATEGORY_LABEL: Record<string, string> = {
  cost: "Cost",
  customer_experience: "Cx",
  process_efficiency: "Process",
  others: "Other",
  other: "Other",
};

// Filter pills shown at the top of the Tasks page. Backlog & archived are
// not included by default — they're set-only states.
const STATUSES = [
  "All",
  "todo",
  "in_progress",
  "pending_decision",
  "blocked",
  "done",
  "approval_pending",
  "reopened",
];

// Two pills don't map to a plain tasks.status value — they're driven by
// approval_state and applied client-side over the fetched page.
const FILTER_LABELS: Record<string, string> = {
  ...STATUS_LABELS,
  All: "All",
  approval_pending: "Sent for Approval",
  reopened: "Reopened",
};

// Filter state on /tasks is persisted under this key so the user keeps
// their view when they navigate to another page and come back.
const TASKS_FILTERS_KEY = "taskora_tasks_filters_v1";

// Approval-aware predicate for the special filter pills.
function matchesApprovalFilter(t: Task, filter: string): boolean {
  if (filter === "approval_pending") {
    return (
      t.approval_state === "pending" ||
      (t.task_entities ?? []).some((e) => e.approval_state === "pending")
    );
  }
  if (filter === "reopened") {
    return (
      t.status === "reopened" ||
      t.approval_state === "rejected" ||
      (t.task_entities ?? []).some(
        (e) => e.approval_state === "rejected" || e.per_entity_status === "reopened"
      )
    );
  }
  return true;
}

// ── Subtask Row (recursive: supports one level of child sub-subtasks) ────────

function SubtaskRow({
  subtask,
  subChildren,
  taskId,
  members,
  currentUserId,
  canManage,
  onChanged,
}: {
  subtask: Subtask;
  // Named `subChildren` (not `children`) so callers don't trip React's
  // reserved `children` prop — eslint react/no-children-prop.
  subChildren: Subtask[]; // child sub-subtasks; empty when subtask is itself a child
  taskId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // Inline editing state — title edit, assignee picker popover, overflow menu.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(subtask.title);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const assigneeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Schema caps nesting at 1 level: only top-level subtasks may have children.
  const isChild = !!subtask.parent_subtask_id;
  const hasChildren = subChildren.length > 0;
  const canAddChild = !isChild;

  const scope: WatcherScope = { scope_type: "subtask", subtask_id: subtask.id };
  const watchers = subtask.watchers ?? [];
  const isApprover = watchers.some(
    (w) => w.role === "approver" && w.user_id === currentUserId
  );
  const isRejected =
    subtask.approval_state === "rejected" || subtask.status === "reopened";

  // Close popovers on outside click — shared pattern with InitiativeGroup.
  useEffect(() => {
    if (!assigneeOpen && !menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (assigneeOpen && assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) {
        setAssigneeOpen(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [assigneeOpen, menuOpen]);

  async function setStatus(next: string) {
    if (next === subtask.status) return;
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      onChanged();
    } catch {
      /* silent */
    } finally {
      setUpdating(false);
    }
  }

  function toggleDone() {
    setStatus(subtask.status === "done" ? "todo" : "done");
  }

  async function saveTitle() {
    const next = titleInput.trim();
    if (!next || next === subtask.title) {
      setEditingTitle(false);
      setTitleInput(subtask.title);
      return;
    }
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: next }),
      });
      setEditingTitle(false);
      onChanged();
    } catch {
      // Restore the prior title on failure rather than leaving the input dirty.
      setTitleInput(subtask.title);
      setEditingTitle(false);
    } finally {
      setUpdating(false);
    }
  }

  async function changeAssignee(nextUserId: string | null) {
    if (nextUserId === (subtask.assignee_id ?? null)) {
      setAssigneeOpen(false);
      return;
    }
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assignee_id: nextUserId }),
      });
      setAssigneeOpen(false);
      onChanged();
    } catch {
      setAssigneeOpen(false);
    } finally {
      setUpdating(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete subtask "${subtask.title}"? This cannot be undone.`)) return;
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "DELETE",
      });
      setMenuOpen(false);
      onChanged();
    } catch (e: any) {
      alert("Failed to delete: " + (e?.message ?? "Unknown error"));
    } finally {
      setUpdating(false);
    }
  }

  // First letter of up to the first two words — "Aditya Singh" → "AS".
  function initials(name: string): string {
    if (!name) return "?";
    const words = name.trim().split(/\s+/).slice(0, 2);
    return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  }

  const statusCls = STATUS_COLORS[subtask.status] ?? "bg-gray-100 text-gray-600";
  const allAssignableMembers = useMemo(() => {
    const me: Member = {
      user_id: currentUserId,
      name: "Me",
      email: "",
    };
    const others = members.filter((m) => m.user_id !== currentUserId);
    return [me, ...others];
  }, [members, currentUserId]);

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded group ${
          isRejected
            ? "bg-red-50 border border-red-200 hover:bg-red-100/60"
            : "hover:bg-mist/30"
        }`}
      >
        {/* Chevron — only on top-level rows; placeholder keeps alignment */}
        {!isChild ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-3.5 h-3.5 flex items-center justify-center text-steel/50 hover:text-midnight flex-shrink-0"
            title={expanded ? "Collapse" : "Expand"}
          >
            {hasChildren || expanded ? (
              expanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )
            ) : null}
          </button>
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* Quick-toggle checkbox */}
        <button
          onClick={toggleDone}
          disabled={updating}
          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors disabled:opacity-50 ${
            subtask.status === "done"
              ? "bg-green-500 border-green-500"
              : "border-pebble hover:border-ocean"
          }`}
          title="Toggle done"
        >
          {subtask.status === "done" && (
            <span className="text-white text-[10px] font-bold">✓</span>
          )}
        </button>

        {/* Title — click to edit. Disabled if the user can't manage. */}
        {editingTitle ? (
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveTitle();
              } else if (e.key === "Escape") {
                setTitleInput(subtask.title);
                setEditingTitle(false);
              }
            }}
            disabled={updating}
            autoFocus
            className="text-xs flex-1 min-w-0 px-1.5 py-0.5 border border-pebble rounded bg-white focus:outline-none focus:border-taskora-red focus:ring-1 focus:ring-taskora-red/20"
            maxLength={500}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!canManage) return;
              setTitleInput(subtask.title);
              setEditingTitle(true);
            }}
            disabled={!canManage}
            title={canManage ? "Click to edit" : undefined}
            className={`text-xs flex-1 min-w-0 text-left truncate px-1 py-0.5 rounded ${
              subtask.status === "done"
                ? "line-through text-steel/50"
                : "text-midnight"
            } ${canManage ? "hover:bg-mist cursor-text" : "cursor-default"}`}
          >
            {subtask.title}
          </button>
        )}

        {/* Full status select */}
        <select
          value={subtask.status}
          onChange={(e) => setStatus(e.target.value)}
          disabled={updating}
          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-ocean/30 disabled:opacity-50 ${statusCls}`}
        >
          {SUBTASK_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>

        {/* Assignee chip — initials avatar; click to reassign. */}
        <div ref={assigneeRef} className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => canManage && setAssigneeOpen((v) => !v)}
            disabled={!canManage || updating}
            title={
              subtask.assignee_name
                ? `Assigned to ${subtask.assignee_name}${canManage ? " — click to change" : ""}`
                : canManage
                ? "Unassigned — click to assign"
                : "Unassigned"
            }
            className={`w-6 h-6 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors ${
              subtask.assignee_id
                ? subtask.assignee_id === currentUserId
                  ? "bg-taskora-red text-white"
                  : "bg-ocean/15 text-ocean"
                : "bg-mist text-steel/60 border border-dashed border-pebble"
            } ${canManage ? "cursor-pointer hover:opacity-90" : "cursor-default"} ${
              updating ? "opacity-50" : ""
            }`}
            aria-label="Assignee"
          >
            {subtask.assignee_name
              ? initials(subtask.assignee_name)
              : subtask.assignee_id === currentUserId
              ? "Me"
              : "?"}
          </button>
          {assigneeOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-pebble rounded-lg shadow-lg z-30 py-1 text-sm max-h-64 overflow-y-auto">
              {allAssignableMembers.map((m) => {
                const isSelected = m.user_id === subtask.assignee_id;
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => changeAssignee(m.user_id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-mist ${
                      isSelected ? "bg-mist/70 font-semibold" : ""
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 ${
                        m.user_id === currentUserId
                          ? "bg-taskora-red text-white"
                          : "bg-ocean/15 text-ocean"
                      }`}
                    >
                      {m.user_id === currentUserId ? "Me" : initials(m.name)}
                    </span>
                    <span className="truncate text-midnight">{m.name || m.email}</span>
                  </button>
                );
              })}
              {subtask.assignee_id && (
                <button
                  type="button"
                  onClick={() => changeAssignee(null)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-mist text-steel border-t border-pebble/60 mt-1 pt-2"
                >
                  <span className="w-5 h-5 rounded-full bg-mist border border-dashed border-pebble text-[9px] flex items-center justify-center flex-shrink-0">
                    ✕
                  </span>
                  Unassign
                </button>
              )}
            </div>
          )}
        </div>

        <ClosedStamp at={subtask.closed_at} />

        <ApprovalControls
          taskId={taskId}
          scope={scope}
          approvalState={subtask.approval_state}
          isApprover={isApprover}
          onActed={() => onChanged()}
          onOpenThread={() => setShowComments(true)}
        />

        <WatcherStrip
          taskId={taskId}
          scope={scope}
          watchers={watchers}
          members={members}
          canManage={canManage}
          onChanged={onChanged}
        />

        {/* Comments — every subtask & sub-subtask; shows latest inline */}
        <LatestCommentButton
          latest={subtask.latest_comment}
          onClick={() => setShowComments(true)}
        />

        {/* Add-child button — only on parent rows */}
        {canAddChild && (
          <button
            type="button"
            onClick={() => {
              setShowAddChild(true);
              setExpanded(true);
            }}
            className="text-[10px] text-steel/40 hover:text-taskora-red flex-shrink-0"
            title="Add sub-sub-task"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}

        {/* Overflow menu — Delete and (future) other actions. Hidden until
            hover/focus so the row stays clean by default. */}
        {canManage && (
          <div ref={menuRef} className="relative flex-shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              disabled={updating}
              title="More actions"
              aria-label="More actions"
              aria-expanded={menuOpen}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-5 h-5 rounded text-steel/50 hover:bg-mist hover:text-midnight flex items-center justify-center transition-opacity"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-pebble rounded-lg shadow-lg z-30 py-1 text-sm">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete subtask
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Children + add-child form */}
      {!isChild && expanded && (
        <div className="ml-6 pl-2 border-l border-pebble/30">
          {subChildren.map((c) => (
            <SubtaskRow
              key={c.id}
              subtask={c}
              subChildren={[]}
              taskId={taskId}
              members={members}
              currentUserId={currentUserId}
              canManage={canManage}
              onChanged={onChanged}
            />
          ))}
          {showAddChild && (
            <AddSubtaskInline
              taskId={taskId}
              members={members}
              currentUserId={currentUserId}
              parentSubtaskId={subtask.id}
              onCreated={() => {
                setShowAddChild(false);
                onChanged();
              }}
            />
          )}
        </div>
      )}

      {showComments && (
        <CommentsPopup
          apiPath={`/api/v1/tasks/${taskId}/subtasks/${subtask.id}/comments`}
          title={subtask.title}
          onClose={() => setShowComments(false)}
          onPosted={onChanged}
        />
      )}
    </div>
  );
}

// ── Add Subtask Inline ────────────────────────────────────────────────────────

function AddSubtaskInline({
  taskId,
  members,
  currentUserId,
  scopedEntityId,
  scopedEntityType,
  parentSubtaskId,
  onCreated,
}: {
  taskId: string;
  members: Member[];
  currentUserId: string;
  scopedEntityId?: string;
  scopedEntityType?: string;
  parentSubtaskId?: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          assignee_id: assigneeId || currentUserId,
          // Backend infers scope from parent when parent_subtask_id is set, so we
          // only send the entity scope when we're at the top level (no parent).
          ...(parentSubtaskId
            ? { parent_subtask_id: parentSubtaskId }
            : scopedEntityId && {
                scoped_entity_id: scopedEntityId,
                scoped_entity_type: scopedEntityType,
              }),
        }),
      });
      setTitle("");
      setAssigneeId("");
      onCreated();
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 mt-1 px-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add subtask…"
        autoFocus
        className="flex-1 text-xs border border-pebble rounded px-2 py-1.5 focus:outline-none focus:border-ocean"
      />
      {members.length > 0 && (
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="text-xs border border-pebble rounded px-1.5 py-1.5 focus:outline-none max-w-[110px]"
        >
          <option value="">Me</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name || m.email}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={saving || !title.trim()}
        className="text-xs px-2.5 py-1.5 bg-taskora-red text-white rounded font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
      >
        Add
      </button>
    </form>
  );
}

// ── Closure / date-change helpers ─────────────────────────────────────────────

function fmtClosure(ts?: string | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Small green closure stamp shown after a due date once an item is done.
function ClosedStamp({ at }: { at?: string | null }) {
  if (!at) return null;
  return (
    <span
      className="text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0"
      title={`Closed ${new Date(at).toLocaleString()}`}
    >
      ✓ Closed {fmtClosure(at)}
    </span>
  );
}

// Turnaround time: whole days from creation to closure (min 0).
function tatDays(createdAt?: string, closedAt?: string | null): number | null {
  if (!createdAt || !closedAt) return null;
  const ms = new Date(closedAt).getTime() - new Date(createdAt).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

function TatBadge({
  createdAt,
  closedAt,
}: {
  createdAt?: string;
  closedAt?: string | null;
}) {
  const d = tatDays(createdAt, closedAt);
  if (d === null) return null;
  return (
    <span
      className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0"
      title={`Turnaround: ${d} day${d === 1 ? "" : "s"} from creation to closure`}
    >
      TAT {d}d
    </span>
  );
}

// Comment entry point: shows the latest comment inline (truncated) when one
// exists, otherwise just the icon. Clicking always opens the full thread.
function LatestCommentButton({
  latest,
  onClick,
}: {
  latest?: LatestComment;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={
        latest
          ? `${latest.author_name || "Someone"}: ${latest.content}`
          : "Comments"
      }
      className={`flex items-center gap-1 transition-colors min-w-0 flex-shrink ${
        latest?.kind === "rejection"
          ? "text-red-600 hover:text-red-700"
          : "text-steel/50 hover:text-ocean"
      }`}
    >
      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
      {latest && (
        <span
          className={`text-[10px] truncate max-w-[160px] ${
            latest.kind === "rejection"
              ? "text-red-600 font-medium"
              : "text-steel/70"
          }`}
        >
          {latest.content}
        </span>
      )}
    </button>
  );
}

// ── Followers / Approvers + Approval controls ────────────────────────────────

type WatcherScope = {
  scope_type: "task" | "subtask" | "entity";
  subtask_id?: string;
  entity_id?: string;
  entity_type?: string;
};

function scopeBody(scope: WatcherScope) {
  if (scope.scope_type === "subtask") return { subtask_id: scope.subtask_id };
  if (scope.scope_type === "entity")
    return { entity_id: scope.entity_id, entity_type: scope.entity_type };
  return {};
}

// Compact follower (eye) / approver (shield) chips + add control. Reused at
// task, building/client, subtask and sub-subtask scope.
function WatcherStrip({
  taskId,
  scope,
  watchers,
  members,
  canManage,
  onChanged,
}: {
  taskId: string;
  scope: WatcherScope;
  watchers: Watcher[];
  members: Member[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [addRole, setAddRole] = useState<"" | "follower" | "approver">("");
  const [addUser, setAddUser] = useState("");

  async function add() {
    if (!addUser || !addRole) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/watchers`, {
        method: "POST",
        body: JSON.stringify({
          scope_type: scope.scope_type,
          role: addRole,
          user_id: addUser,
          ...scopeBody(scope),
        }),
      });
      setAddUser("");
      setAddRole("");
      onChanged();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/watchers/${id}`, { method: "DELETE" });
      onChanged();
    } catch {
      /* silent */
    } finally {
      setBusy(false);
    }
  }

  if (watchers.length === 0 && !canManage) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {watchers.map((w) => (
        <span
          key={w.id}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] border ${
            w.role === "approver"
              ? "bg-violet-50 text-violet-700 border-violet-200"
              : "bg-gray-50 text-steel border-pebble"
          }`}
          title={`${w.role === "approver" ? "Approver" : "Follower"}: ${
            w.name || w.email || "Member"
          }`}
        >
          {w.role === "approver" ? (
            <ShieldCheck className="w-3 h-3 flex-shrink-0" />
          ) : (
            <Eye className="w-3 h-3 flex-shrink-0" />
          )}
          <span className="max-w-[70px] truncate">
            {w.name || w.email || "Member"}
          </span>
          {canManage && (
            <button
              type="button"
              onClick={() => remove(w.id)}
              disabled={busy}
              className="ml-0.5 text-steel/40 hover:text-red-500 leading-none"
            >
              ×
            </button>
          )}
        </span>
      ))}

      {canManage && (
        <span className="inline-flex items-center gap-1">
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value as any)}
            className="text-[10px] border border-pebble rounded px-1 py-0.5 text-steel focus:outline-none focus:border-ocean"
          >
            <option value="">+ watcher</option>
            <option value="follower">Follower</option>
            <option value="approver">Approver</option>
          </select>
          {addRole && (
            <>
              <select
                value={addUser}
                onChange={(e) => setAddUser(e.target.value)}
                className="text-[10px] border border-pebble rounded px-1 py-0.5 text-steel max-w-[110px] focus:outline-none focus:border-ocean"
              >
                <option value="">Person…</option>
                {members
                  .filter(
                    (m) =>
                      !watchers.some(
                        (w) => w.user_id === m.user_id && w.role === addRole
                      )
                  )
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                    </option>
                  ))}
              </select>
              {addUser && (
                <button
                  type="button"
                  onClick={add}
                  disabled={busy}
                  className="text-[10px] px-1.5 py-0.5 bg-taskora-red text-white rounded font-medium disabled:opacity-50"
                >
                  Add
                </button>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
}

// "Sent for Approval" / "Approved" / "Rejected" badge + approver actions.
// Reject reason is required and is posted as a red comment into the item's
// own thread (clicking the Rejected badge opens that thread).
function ApprovalControls({
  taskId,
  scope,
  approvalState,
  isApprover,
  onActed,
  onOpenThread,
}: {
  taskId: string;
  scope: WatcherScope;
  approvalState?: string;
  isApprover: boolean;
  onActed: (action: "approve" | "reject") => void;
  onOpenThread: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function act(action: "approve" | "reject") {
    if (action === "reject" && !reason.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/approvals`, {
        method: "POST",
        body: JSON.stringify({
          scope_type: scope.scope_type,
          action,
          ...(action === "reject" ? { reason: reason.trim() } : {}),
          ...scopeBody(scope),
        }),
      });
      setRejecting(false);
      setReason("");
      onActed(action);
    } catch (e: any) {
      alert(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (approvalState === "approved") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 font-medium whitespace-nowrap flex-shrink-0">
        ✓ Approved
      </span>
    );
  }

  if (approvalState === "rejected") {
    return (
      <button
        type="button"
        onClick={onOpenThread}
        title="View rejection reason"
        className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-800 font-medium whitespace-nowrap flex-shrink-0 hover:bg-red-200"
      >
        ✕ Rejected
      </button>
    );
  }

  if (approvalState === "pending") {
    return (
      <span className="inline-flex items-center gap-1 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium whitespace-nowrap flex-shrink-0">
          ⏳ Sent for Approval
        </span>
        {isApprover && !rejecting && (
          <>
            <button
              type="button"
              onClick={() => act("approve")}
              disabled={busy}
              className="text-[10px] px-1.5 py-0.5 rounded bg-green-600 text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy}
              className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-medium hover:opacity-90 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
        {isApprover && rejecting && (
          <span className="inline-flex items-center gap-1">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (required)"
              autoFocus
              className="text-[10px] border border-red-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-red-500 max-w-[160px]"
            />
            <button
              type="button"
              onClick={() => act("reject")}
              disabled={busy || !reason.trim()}
              className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white font-medium disabled:opacity-50"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className="text-[10px] px-1 py-0.5 text-steel/60 hover:text-midnight"
            >
              Cancel
            </button>
          </span>
        )}
      </span>
    );
  }

  return null;
}

// ── Date Change Log Popup ─────────────────────────────────────────────────────

function DateChangeLogPopup({
  apiPath,
  title,
  onClose,
}: {
  apiPath: string;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<DateChange[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch(apiPath);
        if (active) setRows(Array.isArray(data) ? data : []);
      } catch {
        /* silent */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [apiPath]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 flex flex-col"
        style={{ maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-pebble flex-shrink-0">
          <h3 className="font-semibold text-midnight text-sm truncate pr-2">
            Due-date history — {title}
          </h3>
          <button onClick={onClose} className="flex-shrink-0">
            <X className="w-4 h-4 text-steel hover:text-midnight" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {loading && (
            <p className="text-xs text-steel/50 text-center py-6">Loading…</p>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-xs text-steel/50 text-center py-6 italic">
              No changes yet.
            </p>
          )}
          {!loading &&
            rows.map((r) => {
              const delay = r.delay_days;
              const delayLabel =
                delay == null
                  ? null
                  : delay > 0
                  ? `+${delay}d later`
                  : delay < 0
                  ? `${delay}d earlier`
                  : "same day";
              return (
                <div key={r.id} className="bg-mist/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs text-midnight">
                    <span className="text-steel/60">{r.old_date ?? "—"}</span>
                    <span className="text-steel/40">→</span>
                    <span className="font-medium">{r.new_date ?? "—"}</span>
                    {delayLabel && (
                      <span
                        className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          (delay ?? 0) > 0
                            ? "bg-red-100 text-red-700"
                            : (delay ?? 0) < 0
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {delayLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <span className="text-[10px] text-steel/60">
                      {r.changed_by_name || "Someone"}
                    </span>
                    <span className="text-[10px] text-steel/50">
                      {fmtClosure(r.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ── Comments Popup ────────────────────────────────────────────────────────────

// Scope-agnostic: takes the comments API path + a display title so it can be
// reused for task-level, entity-level, and subtask-level threads.
function CommentsPopup({
  apiPath,
  title,
  onClose,
  onPosted,
}: {
  apiPath: string;
  title: string;
  onClose: () => void;
  // Fired after a successful post with the freshly-created comment so callers
  // can refresh their inline "latest comment" preview instantly.
  onPosted?: (created: Comment) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadComments() {
    setLoading(true);
    try {
      const data = await apiFetch(apiPath);
      setComments(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadComments();
  }, [apiPath]);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const created = await apiFetch(apiPath, {
        method: "POST",
        body: JSON.stringify({ content: newComment.trim() }),
      });
      setNewComment("");
      loadComments();
      if (created && created.content) onPosted?.(created as Comment);
    } catch {
      /* silent */
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 flex flex-col"
        style={{ maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-pebble flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-ocean flex-shrink-0" />
            <h3 className="font-semibold text-midnight text-sm truncate">
              {title}
            </h3>
          </div>
          <button onClick={onClose} className="ml-2 flex-shrink-0">
            <X className="w-4 h-4 text-steel hover:text-midnight" />
          </button>
        </div>

        {/* Thread — latest on top */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
          {loading && (
            <p className="text-xs text-steel/50 text-center py-6">Loading…</p>
          )}
          {!loading && comments.length === 0 && (
            <p className="text-xs text-steel/50 text-center py-6 italic">
              No comments yet.
            </p>
          )}
          {!loading &&
            [...comments].reverse().map((c) => (
              <div
                key={c.id}
                className={`rounded-lg px-3 py-2.5 ${
                  c.kind === "rejection"
                    ? "bg-red-50 border border-red-200"
                    : c.kind === "approval"
                    ? "bg-green-50 border border-green-200"
                    : "bg-mist/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold text-midnight">
                    {c.author_name ?? "Team member"}
                    {c.kind === "rejection" && (
                      <span className="ml-1.5 text-[10px] font-bold text-red-700 uppercase">
                        Rejected
                      </span>
                    )}
                    {c.kind === "approval" && (
                      <span className="ml-1.5 text-[10px] font-bold text-green-700 uppercase">
                        Approved
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-steel/50 flex-shrink-0">
                    {new Date(c.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-xs text-midnight leading-relaxed whitespace-pre-wrap">
                  {c.content}
                </p>
              </div>
            ))}
        </div>

        {/* Add comment */}
        <form
          onSubmit={submitComment}
          className="border-t border-pebble px-4 py-3 flex gap-2 flex-shrink-0"
        >
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Write a comment…"
            autoFocus
            className="flex-1 text-xs border border-pebble rounded-lg px-3 py-2 focus:outline-none focus:border-ocean"
          />
          <button
            type="submit"
            disabled={submitting || !newComment.trim()}
            className="text-xs px-3 py-2 bg-taskora-red text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex-shrink-0"
          >
            {submitting ? "…" : "Post"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Entity Subtask Row (entity = first-level subtask, supports nested sub-subtasks) ──

function EntitySubtaskRow({
  entity,
  taskId,
  members,
  currentUserId,
  canManage,
  subtasks,
  subtasksLoading,
  onEntityUpdate,
  onSubtasksChanged,
}: {
  entity: TaskEntity;
  taskId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
  // B4: subtasks now come from a single parent-level fetch instead of one
  // request per entity. Empty array = no subtasks (not "not loaded yet").
  subtasks: Subtask[];
  subtasksLoading: boolean;
  onEntityUpdate?: (entityId: string, updates: Partial<TaskEntity>) => void;
  onSubtasksChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [entityStatus, setEntityStatus] = useState(entity.per_entity_status ?? "backlog");
  const [entityEndDate, setEntityEndDate] = useState(entity.per_entity_end_date?.slice(0, 10) ?? "");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showDateLog, setShowDateLog] = useState(false);

  // Split parents from children for recursive rendering.
  const parentSubtasks = subtasks.filter((s) => !s.parent_subtask_id);
  const childrenByParent: Record<string, Subtask[]> = {};
  for (const s of subtasks) {
    if (s.parent_subtask_id) {
      (childrenByParent[s.parent_subtask_id] ??= []).push(s);
    }
  }

  function toggle() {
    setExpanded((v) => !v);
  }

  async function handleEntityStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const newStatus = e.target.value;
    const prev = entityStatus;
    setEntityStatus(newStatus);
    setUpdatingStatus(true);
    try {
      const updated = await apiFetch(
        `/api/v1/tasks/${taskId}/entities/${entity.entity_id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ per_entity_status: newStatus }),
        }
      );
      onEntityUpdate?.(entity.entity_id, {
        per_entity_status: newStatus,
        // Reflect the server's closure stamp instantly (null when reopened).
        closed_at:
          updated?.closed_at ??
          (newStatus === "done" ? new Date().toISOString() : null),
      });
    } catch {
      setEntityStatus(prev);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleEntityDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const newDate = e.target.value;
    const priorDate = entityEndDate;
    setEntityEndDate(newDate);
    if (!newDate) return;
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, {
        method: "PATCH",
        body: JSON.stringify({ per_entity_end_date: newDate }),
      });
      onEntityUpdate?.(entity.entity_id, {
        per_entity_end_date: newDate,
        // Mirror the backend's change-log insert so the ↻ counter updates live.
        ...(newDate !== priorDate
          ? { date_change_count: (entity.date_change_count ?? 0) + 1 }
          : {}),
      });
    } catch { /* silent */ }
  }

  // Count is over parent rows only — children are a UI detail and shouldn't
  // double-count toward the "X/Y done" indicator.
  const doneCount = parentSubtasks.filter((s) => s.status === "done").length;
  const totalCount = parentSubtasks.length;
  const colorCls =
    entity.entity_type === "building"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-sky-50 text-sky-700 border-sky-200";
  const statusCls = STATUS_COLORS[entityStatus] ?? "bg-gray-100 text-gray-600";

  const scope: WatcherScope = {
    scope_type: "entity",
    entity_id: entity.entity_id,
    entity_type: entity.entity_type,
  };
  const watchers = entity.watchers ?? [];
  const isApprover = watchers.some(
    (w) => w.role === "approver" && w.user_id === currentUserId
  );
  const isRejected =
    entity.approval_state === "rejected" || entityStatus === "reopened";

  async function refreshEntityWatchers() {
    try {
      const all = await apiFetch(`/api/v1/tasks/${taskId}/watchers`);
      const w = (Array.isArray(all) ? all : []).filter(
        (x: Watcher) =>
          x.scope_type === "entity" && x.entity_id === entity.entity_id
      );
      onEntityUpdate?.(entity.entity_id, { watchers: w });
    } catch {
      /* silent */
    }
  }

  function handleApprovalActed(action: "approve" | "reject") {
    if (action === "approve") {
      onEntityUpdate?.(entity.entity_id, { approval_state: "approved" });
    } else {
      setEntityStatus("reopened");
      onEntityUpdate?.(entity.entity_id, {
        approval_state: "rejected",
        per_entity_status: "reopened",
        closed_at: null,
      });
    }
  }

  return (
    <div className="mb-1.5">
      <div
        className={`flex items-center gap-2 px-2 py-2 rounded flex-wrap ${
          isRejected
            ? "bg-red-50 border border-red-200 hover:bg-red-100/60"
            : "hover:bg-mist/30"
        }`}
      >
        {/* Entity name badge */}
        <span className={`text-xs px-2 py-0.5 rounded border font-medium flex-shrink-0 max-w-[120px] truncate ${colorCls}`}>
          {entity.entity_name ?? entity.entity_id}
        </span>

        {/* Per-entity status */}
        <select
          value={entityStatus}
          onChange={handleEntityStatusChange}
          onClick={(e) => e.stopPropagation()}
          disabled={updatingStatus}
          className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-ocean/30 disabled:opacity-50 ${statusCls}`}
        >
          {SUBTASK_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
          ))}
        </select>

        {/* Per-entity planned end date */}
        <input
          type="date"
          value={entityEndDate}
          onChange={handleEntityDateChange}
          onClick={(e) => e.stopPropagation()}
          title="Planned end date"
          className="text-xs border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean flex-shrink-0"
        />

        {/* Due-date change counter */}
        {(entity.date_change_count ?? 0) > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowDateLog(true); }}
            title="Due date changed — view history"
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium flex-shrink-0 hover:bg-amber-200"
          >
            ↻{entity.date_change_count}
          </button>
        )}

        {/* Closure stamp */}
        <ClosedStamp at={entity.closed_at} />

        <ApprovalControls
          taskId={taskId}
          scope={scope}
          approvalState={entity.approval_state}
          isApprover={isApprover}
          onActed={handleApprovalActed}
          onOpenThread={() => setShowComments(true)}
        />

        <WatcherStrip
          taskId={taskId}
          scope={scope}
          watchers={watchers}
          members={members}
          canManage={canManage}
          onChanged={refreshEntityWatchers}
        />

        {/* Comments — shows latest inline */}
        <LatestCommentButton
          latest={entity.latest_comment}
          onClick={() => setShowComments(true)}
        />

        {/* Expand / subtask count */}
        <button
          type="button"
          onClick={toggle}
          className="ml-auto flex items-center gap-1 text-xs text-steel hover:text-midnight flex-shrink-0"
        >
          {totalCount > 0 ? `${doneCount}/${totalCount}` : ""}
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="ml-4 pl-2 border-l border-pebble/40 mt-0.5">
          {subtasksLoading && totalCount === 0 && (
            <p className="text-xs text-steel/50 py-1">Loading…</p>
          )}
          {parentSubtasks.map((s) => (
            <SubtaskRow
              key={s.id}
              subtask={s}
              subChildren={childrenByParent[s.id] ?? []}
              taskId={taskId}
              members={members}
              currentUserId={currentUserId}
              canManage={canManage}
              onChanged={onSubtasksChanged}
            />
          ))}
          {!subtasksLoading && totalCount === 0 && (
            <p className="text-xs text-steel/50 py-1 italic">
              No sub-tasks yet.
            </p>
          )}
          {showAdd ? (
            <AddSubtaskInline
              taskId={taskId}
              members={members}
              currentUserId={currentUserId}
              scopedEntityId={entity.entity_id}
              scopedEntityType={entity.entity_type ?? "building"}
              onCreated={() => {
                setShowAdd(false);
                onSubtasksChanged();
              }}
            />
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="mt-0.5 text-xs text-taskora-red hover:underline font-medium flex items-center gap-1 py-0.5"
            >
              <Plus className="w-3 h-3" /> Add sub-task
            </button>
          )}
        </div>
      )}

      {showComments && (
        <CommentsPopup
          apiPath={`/api/v1/tasks/${taskId}/entities/${entity.entity_id}/comments`}
          title={entity.entity_name ?? entity.entity_id}
          onClose={() => setShowComments(false)}
          onPosted={(c) =>
            onEntityUpdate?.(entity.entity_id, {
              latest_comment: {
                content: c.content,
                author_name: c.author_name,
                kind: c.kind,
                created_at: c.created_at,
              },
            })
          }
        />
      )}

      {showDateLog && (
        <DateChangeLogPopup
          apiPath={`/api/v1/tasks/${taskId}/date-changes?entity_id=${entity.entity_id}`}
          title={entity.entity_name ?? entity.entity_id}
          onClose={() => setShowDateLog(false)}
        />
      )}
    </div>
  );
}

// ── Status Select ─────────────────────────────────────────────────────────────

function StatusSelect({
  task,
  onStatusChange,
}: {
  task: Task;
  onStatusChange: (taskId: string, newStatus: string) => void;
}) {
  const [updating, setUpdating] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const newStatus = e.target.value;
    if (newStatus === task.status) return;
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      onStatusChange(task.id, newStatus);
    } catch {
      /* silent — revert is not needed since we update optimistically after success */
    } finally {
      setUpdating(false);
    }
  }

  const colorCls =
    STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-600";

  return (
    <select
      value={task.status}
      onChange={handleChange}
      onClick={(e) => e.stopPropagation()}
      disabled={updating}
      className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-ocean/30 disabled:opacity-70 ${colorCls}`}
    >
      {Object.entries(STATUS_LABELS).map(([val, label]) => (
        <option key={val} value={val}>
          {label}
        </option>
      ))}
    </select>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  members,
  currentUserId,
  myRole,
  onStatusChange,
  onDelete,
  focusTaskId,
  focusSubtaskId,
}: {
  task: Task;
  members: Member[];
  currentUserId: string;
  myRole: string;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onDelete: (taskId: string) => void;
  focusTaskId?: string | null;
  focusSubtaskId?: string | null;
}) {
  const isFocused = !!focusTaskId && task.id === focusTaskId;
  const [expanded, setExpanded] = useState(isFocused);
  const cardRef = useRef<HTMLDivElement>(null);

  // Deep-link target (Daily Brief / War Room "↗ open"): open this card,
  // scroll it into view, and briefly ring it so the eye lands on it. When a
  // subtask is also targeted, the subtasks panel is opened too.
  useEffect(() => {
    if (!isFocused) return;
    setExpanded(true);
    if (focusSubtaskId) setShowComments(false);
    const id = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(id);
  }, [isFocused, focusSubtaskId]);
  const [showComments, setShowComments] = useState(false);
  const [showDateLog, setShowDateLog] = useState(false);
  // B4: a single grouped fetch covers every entity in the task. by_entity is
  // keyed by entity_id; task_flat holds subtasks not scoped to an entity.
  const [grouped, setGrouped] = useState<SubtasksGrouped>({ by_entity: {}, task_flat: [] });
  const [groupedLoaded, setGroupedLoaded] = useState(false);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const cardMenuRef = useRef<HTMLDivElement>(null);
  const [editDueDate, setEditDueDate] = useState(task.due_date ?? "");
  const [savingDate, setSavingDate] = useState(false);
  const [dateError, setDateError] = useState("");
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [stakeholdersLoaded, setStakeholdersLoaded] = useState(false);
  const [newStakeholderUserId, setNewStakeholderUserId] = useState("");
  const [localEnts, setLocalEnts] = useState<TaskEntity[]>(task.task_entities ?? []);
  // Local override so the inline preview updates instantly after posting,
  // without waiting for the next page load.
  const [taskLatest, setTaskLatest] = useState<LatestComment>(task.latest_comment ?? null);
  const [dateChangeCount, setDateChangeCount] = useState(task.date_change_count ?? 0);
  const [taskWatchers, setTaskWatchers] = useState<Watcher[]>(
    (task.watchers ?? []).filter((w) => w.scope_type === "task")
  );
  const [taskApproval, setTaskApproval] = useState<string | undefined>(
    task.approval_state
  );

  useEffect(() => {
    setLocalEnts(task.task_entities ?? []);
    setTaskLatest(task.latest_comment ?? null);
    setDateChangeCount(task.date_change_count ?? 0);
    setTaskWatchers((task.watchers ?? []).filter((w) => w.scope_type === "task"));
    setTaskApproval(task.approval_state);
  }, [task.id]);

  const canManageWatchers =
    task.primary_stakeholder_id === currentUserId ||
    myRole === "owner" ||
    myRole === "admin" ||
    stakeholders.some((s) => s.user_id === currentUserId);

  // Same shape as the backend write-gate (_assert_task_write): primary,
  // any secondary stakeholder, OR workspace owner/admin can edit the
  // task's due date directly from the row.
  const canEditTask = canManageWatchers;

  const isApproverTask = taskWatchers.some(
    (w) => w.role === "approver" && w.user_id === currentUserId
  );
  const taskRejected =
    task.status === "reopened" || taskApproval === "rejected";

  // Close the card overflow menu on outside click — same pattern as
  // InitiativeGroup / SubtaskRow.
  useEffect(() => {
    if (!cardMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target as Node)) {
        setCardMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [cardMenuOpen]);

  async function refreshTaskWatchers() {
    try {
      const all = await apiFetch(`/api/v1/tasks/${task.id}/watchers`);
      setTaskWatchers(
        (Array.isArray(all) ? all : []).filter(
          (w: Watcher) => w.scope_type === "task"
        )
      );
    } catch {
      /* silent */
    }
  }

  function handleTaskApprovalActed(action: "approve" | "reject") {
    if (action === "approve") {
      setTaskApproval("approved");
    } else {
      setTaskApproval("rejected");
      onStatusChange(task.id, "reopened");
    }
  }

  function handleEntityUpdate(entityId: string, updates: Partial<TaskEntity>) {
    setLocalEnts((prev) =>
      prev.map((e) => (e.entity_id === entityId ? { ...e, ...updates } : e))
    );
  }

  const canDelete =
    task.primary_stakeholder_id === currentUserId ||
    myRole === "owner" ||
    myRole === "admin";

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, { method: "DELETE" });
      onDelete(task.id);
    } catch (err: any) {
      alert("Failed to delete: " + (err?.message ?? "Unknown error"));
      setDeleting(false);
    }
  }

  async function loadSubtasksGrouped() {
    setLoadingSubtasks(true);
    try {
      const data = await apiFetch(`/api/v1/tasks/${task.id}/subtasks-grouped`);
      setGrouped({
        by_entity: data?.by_entity ?? {},
        task_flat: data?.task_flat ?? [],
      });
      setGroupedLoaded(true);
    } catch {
      /* silent */
    } finally {
      setLoadingSubtasks(false);
    }
  }

  async function loadStakeholders() {
    try {
      const data = await apiFetch(`/api/v1/tasks/${task.id}/stakeholders`);
      setStakeholders(Array.isArray(data) ? data : []);
      setStakeholdersLoaded(true);
    } catch { /* silent */ }
  }

  async function handleDueDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newDate = e.target.value;
    const priorDate = editDueDate;
    setEditDueDate(newDate);
    if (!newDate) return;
    setSavingDate(true);
    setDateError("");
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ due_date: newDate }),
      });
      // Backend logs a change only when the date actually differs; mirror
      // that here so the ↻ counter updates without a page reload.
      if (newDate !== priorDate) {
        setDateChangeCount((c) => c + 1);
      }
    } catch (err: any) {
      // Revert the optimistic UI update so the row reflects what's actually
      // persisted, and surface the cause inline. Silent-fail used to leave
      // the user thinking they'd edited successfully.
      setEditDueDate(priorDate);
      setDateError(err?.message || "Couldn't save the new date.");
    } finally {
      setSavingDate(false);
    }
  }

  async function addStakeholder() {
    if (!newStakeholderUserId) return;
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/stakeholders`, {
        method: "POST",
        body: JSON.stringify({ user_id: newStakeholderUserId, role: "secondary" }),
      });
      setNewStakeholderUserId("");
      loadStakeholders();
    } catch { /* silent */ }
  }

  async function removeStakeholder(userId: string) {
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/stakeholders/${userId}`, {
        method: "DELETE",
      });
      setStakeholders((prev) => prev.filter((s) => s.user_id !== userId));
    } catch { /* silent */ }
  }

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      if (!groupedLoaded) loadSubtasksGrouped();
      if (!stakeholdersLoaded) loadStakeholders();
    }
  }

  // doneCount only meaningful for the flat (no-entity) view; entity-scoped
  // tasks display their own X/Y counts per building.
  const doneCount = grouped.task_flat.filter((s) => s.status === "done").length;
  const flatTotal = grouped.task_flat.length;
  const flatParents = grouped.task_flat.filter((s) => !s.parent_subtask_id);
  const flatChildrenByParent: Record<string, Subtask[]> = {};
  for (const s of grouped.task_flat) {
    if (s.parent_subtask_id) {
      (flatChildrenByParent[s.parent_subtask_id] ??= []).push(s);
    }
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border border-l-4 shadow-sm scroll-mt-20 ${
        PRIORITY_BORDER[task.priority] ?? "border-l-gray-300"
      } ${
        taskRejected
          ? "bg-red-50 border-red-200"
          : "bg-white border-pebble"
      } ${isFocused ? "ring-2 ring-ocean ring-offset-2" : ""}`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-midnight truncate">{task.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* Inline status select */}
              <StatusSelect task={task} onStatusChange={onStatusChange} />

              {/* Due date — inline-editable from the row so users don't
                  have to expand the task to change it. Read-only fallback
                  for viewers who don't have write access. The ↻N badge
                  surfaces the change-count history right next to the
                  editor (mirrors the expanded-panel affordance). */}
              {canEditTask ? (
                <span className="inline-flex items-center gap-1 text-xs">
                  <span aria-hidden>📅</span>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={handleDueDateChange}
                    onClick={(e) => e.stopPropagation()}
                    disabled={savingDate}
                    aria-label="Due date"
                    title={dateError || "Click to change the due date"}
                    className={`border rounded px-1.5 py-0.5 text-midnight bg-transparent focus:outline-none focus:border-ocean disabled:opacity-50 ${dateError ? "border-red-300" : "border-pebble"}`}
                  />
                  {dateChangeCount > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowDateLog(true); }}
                      title="Due date changed — view history"
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium hover:bg-amber-200"
                    >
                      ↻{dateChangeCount}
                    </button>
                  )}
                  {dateError && (
                    <span className="text-red-600" title={dateError}>!</span>
                  )}
                </span>
              ) : (
                task.due_date && (
                  <span className="inline-flex items-center gap-1 text-xs text-steel">
                    <span>📅 {task.due_date}</span>
                    {dateChangeCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowDateLog(true); }}
                        title="Due date changed — view history"
                        className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium hover:bg-amber-200"
                      >
                        ↻{dateChangeCount}
                      </button>
                    )}
                  </span>
                )
              )}

              {/* Card-level closure stamp, right after the target date */}
              <ClosedStamp at={task.closed_at} />

              {task.is_stale && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Needs Update
                </span>
              )}

              <ApprovalControls
                taskId={task.id}
                scope={{ scope_type: "task" }}
                approvalState={taskApproval}
                isApprover={isApproverTask}
                onActed={handleTaskApprovalActed}
                onOpenThread={() => setShowComments(true)}
              />
            </div>



          </div>

          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {/* Task-level comments — shows latest inline; click opens thread */}
            <div className="px-2 py-1 rounded border border-pebble flex items-center">
              <LatestCommentButton
                latest={taskLatest}
                onClick={() => setShowComments(true)}
              />
            </div>
            <button
              onClick={toggleExpand}
              className="flex items-center gap-1 text-xs text-steel hover:text-midnight"
            >
              <span className="font-medium">
                {localEnts.length > 0
                  ? `${localEnts.length} ${localEnts[0]?.entity_type === "client" ? "client" : "building"}${localEnts.length !== 1 ? "s" : ""}`
                  : flatTotal > 0
                  ? `${doneCount}/${flatTotal}`
                  : "Subtasks"}
              </span>
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Turnaround time — right-most, only once closed */}
            <TatBadge createdAt={task.created_at} closedAt={task.closed_at} />

            {/* Overflow menu — keeps Delete out of the always-visible
                bar where it was both noisy (red) and easy to mis-click. */}
            {canDelete && (
              <div ref={cardMenuRef} className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardMenuOpen((v) => !v);
                  }}
                  disabled={deleting}
                  title="More actions"
                  aria-label="More actions"
                  aria-expanded={cardMenuOpen}
                  className="w-7 h-7 rounded text-steel/60 hover:bg-mist hover:text-midnight flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {cardMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-pebble rounded-lg shadow-lg z-30 py-1 text-sm">
                    <button
                      type="button"
                      onClick={(e) => {
                        setCardMenuOpen(false);
                        handleDelete(e);
                      }}
                      disabled={deleting}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {deleting ? "Deleting…" : "Delete task"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-pebble/50 px-4 pb-3 pt-2 bg-mist/10">

          {/* Due date used to live here too; removed because it's already
              inline-editable in the always-visible header row above. */}

          {/* ── Task meta: secondary stakeholders ── */}
          <div className="flex items-center gap-3 pb-2 mb-2 border-b border-pebble/30 flex-wrap text-xs">
            <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
              <span className="text-steel font-medium flex-shrink-0">Team:</span>
              {stakeholders.filter((s) => s.role !== "primary").map((s) => (
                <span key={s.user_id} className="inline-flex items-center gap-1 bg-white border border-pebble rounded-full px-2 py-0.5 text-midnight">
                  <User className="w-3 h-3 text-steel/50 flex-shrink-0" />
                  <span className="max-w-[80px] truncate">{s.name || s.email || "Member"}</span>
                  {task.primary_stakeholder_id === currentUserId && (
                    <button
                      onClick={() => removeStakeholder(s.user_id)}
                      className="ml-0.5 text-steel/40 hover:text-red-500 leading-none text-sm"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {task.primary_stakeholder_id === currentUserId && (
                <div className="flex items-center gap-1">
                  <select
                    value={newStakeholderUserId}
                    onChange={(e) => setNewStakeholderUserId(e.target.value)}
                    className="border border-pebble rounded px-1.5 py-0.5 text-steel max-w-[140px] focus:outline-none focus:border-ocean"
                  >
                    <option value="">+ Add person</option>
                    {members
                      .filter((m) => !stakeholders.some((s) => s.user_id === m.user_id))
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
                      ))}
                  </select>
                  {newStakeholderUserId && (
                    <button
                      onClick={addStakeholder}
                      className="px-2 py-0.5 bg-taskora-red text-white rounded font-medium text-[11px]"
                    >
                      Add
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Task-level followers / approvers ── */}
          <div className="flex items-center gap-1.5 pb-2 mb-2 border-b border-pebble/30 flex-wrap text-xs">
            <span className="text-steel font-medium flex-shrink-0">
              Watchers:
            </span>
            <WatcherStrip
              taskId={task.id}
              scope={{ scope_type: "task" }}
              watchers={taskWatchers}
              members={members}
              canManage={canManageWatchers}
              onChanged={refreshTaskWatchers}
            />
          </div>

          {localEnts.length > 0 ? (
            /* Entity tasks: each building/client is a collapsible row, subtasks come from the single grouped fetch */
            <>
              {localEnts.map((e) => (
                <EntitySubtaskRow
                  key={e.entity_id}
                  entity={e}
                  taskId={task.id}
                  members={members}
                  currentUserId={currentUserId}
                  canManage={canManageWatchers}
                  subtasks={grouped.by_entity[e.entity_id] ?? []}
                  subtasksLoading={loadingSubtasks}
                  onEntityUpdate={handleEntityUpdate}
                  onSubtasksChanged={loadSubtasksGrouped}
                />
              ))}
            </>
          ) : (
            /* General tasks: flat subtask list, recursive SubtaskRow handles nesting */
            <>
              {loadingSubtasks && flatTotal === 0 && (
                <p className="text-xs text-steel/50 py-1">Loading…</p>
              )}
              {flatParents.map((s) => (
                <SubtaskRow
                  key={s.id}
                  subtask={s}
                  subChildren={flatChildrenByParent[s.id] ?? []}
                  taskId={task.id}
                  members={members}
                  currentUserId={currentUserId}
                  canManage={canManageWatchers}
                  onChanged={loadSubtasksGrouped}
                />
              ))}
              {flatTotal === 0 && !loadingSubtasks && (
                <p className="text-xs text-steel/50 py-1 italic">
                  No subtasks yet.
                </p>
              )}
              {showAddSubtask ? (
                <AddSubtaskInline
                  taskId={task.id}
                  members={members}
                  currentUserId={currentUserId}
                  onCreated={() => {
                    setShowAddSubtask(false);
                    loadSubtasksGrouped();
                  }}
                />
              ) : (
                <button
                  onClick={() => setShowAddSubtask(true)}
                  className="mt-1 text-xs text-taskora-red hover:underline font-medium flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add subtask
                </button>
              )}
            </>
          )}
        </div>
      )}

      {showComments && (
        <CommentsPopup
          apiPath={`/api/v1/tasks/${task.id}/comments`}
          title={task.title}
          onClose={() => setShowComments(false)}
          onPosted={(c) =>
            setTaskLatest({
              content: c.content,
              author_name: c.author_name,
              kind: c.kind,
              created_at: c.created_at,
            })
          }
        />
      )}

      {showDateLog && (
        <DateChangeLogPopup
          apiPath={`/api/v1/tasks/${task.id}/date-changes`}
          title={task.title}
          onClose={() => setShowDateLog(false)}
        />
      )}
    </div>
  );
}

// ── Building Selector ─────────────────────────────────────────────────────────

function BuildingSelector({
  buildings,
  selected,
  onChange,
}: {
  buildings: BuildingEntity[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const zones = Array.from(
    new Set(buildings.map((b) => b.zone?.trim() || "Other"))
  ).sort();
  const allSelected =
    buildings.length > 0 && selected.length === buildings.length;
  const [collapsedZones, setCollapsedZones] = useState<string[]>([]);

  function toggleCollapse(zone: string) {
    setCollapsedZones((prev) =>
      prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]
    );
  }

  function toggleAll() {
    onChange(allSelected ? [] : buildings.map((b) => b.id));
  }

  function toggleZone(zone: string) {
    const ids = buildings
      .filter((b) => (b.zone?.trim() || "Other") === zone)
      .map((b) => b.id);
    const zoneAllSel = ids.every((id) => selected.includes(id));
    if (zoneAllSel) {
      onChange(selected.filter((id) => !ids.includes(id)));
    } else {
      const next = [...selected];
      ids.forEach((id) => { if (!next.includes(id)) next.push(id); });
      onChange(next);
    }
  }

  function toggleOne(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-steel uppercase tracking-wider">
          Select Buildings
        </label>
        <label className="flex items-center gap-1.5 text-xs text-steel cursor-pointer hover:text-midnight">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="rounded"
          />
          Select All ({buildings.length})
        </label>
      </div>
      <div className="border border-pebble rounded-lg max-h-56 overflow-y-auto divide-y divide-pebble/50">
        {buildings.length === 0 && (
          <p className="text-xs text-steel/60 italic px-3 py-3">No buildings found for this workspace.</p>
        )}
        {zones.map((zone) => {
          const zoneBuildings = buildings.filter(
            (b) => (b.zone?.trim() || "Other") === zone
          );
          const zoneAllSel = zoneBuildings.every((b) => selected.includes(b.id));
          const zoneSomeSel =
            !zoneAllSel && zoneBuildings.some((b) => selected.includes(b.id));
          const isCollapsed = collapsedZones.includes(zone);
          const zoneSelectedCount = zoneBuildings.filter((b) => selected.includes(b.id)).length;
          return (
            <div key={zone}>
              <div className="flex items-center gap-2 px-3 py-2 bg-mist/60 sticky top-0">
                <input
                  type="checkbox"
                  checked={zoneAllSel}
                  onChange={() => toggleZone(zone)}
                  ref={(el) => {
                    if (el) el.indeterminate = zoneSomeSel;
                  }}
                  className="rounded"
                />
                <button
                  type="button"
                  onClick={() => toggleCollapse(zone)}
                  className="flex items-center gap-1.5 flex-1 text-left"
                >
                  <span className="text-xs font-semibold text-midnight flex-1">
                    {zone}
                  </span>
                  <span className="text-[10px] text-steel/60">
                    {isCollapsed && zoneSelectedCount > 0
                      ? `${zoneSelectedCount}/${zoneBuildings.length}`
                      : zoneBuildings.length}
                  </span>
                  <svg
                    className={`w-3.5 h-3.5 text-steel/50 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {!isCollapsed && zoneBuildings.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-2 px-5 py-2 hover:bg-mist/30 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(b.id)}
                    onChange={() => toggleOne(b.id)}
                    className="rounded"
                  />
                  <span className="text-sm text-midnight truncate">{b.name}</span>
                </label>
              ))}
            </div>
          );
        })}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-steel mt-1.5">
          {selected.length} building{selected.length !== 1 ? "s" : ""} selected
          — will create {selected.length} task{selected.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ── Client Selector ───────────────────────────────────────────────────────────

function ClientSelector({
  clients,
  selected,
  onChange,
}: {
  clients: ClientEntity[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const allSelected =
    clients.length > 0 && selected.length === clients.length;

  function toggleAll() {
    onChange(allSelected ? [] : clients.map((c) => c.id));
  }

  function toggleOne(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-steel uppercase tracking-wider">
          Select Clients
        </label>
        <label className="flex items-center gap-1.5 text-xs text-steel cursor-pointer hover:text-midnight">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="rounded"
          />
          Select All ({clients.length})
        </label>
      </div>
      <div className="border border-pebble rounded-lg max-h-56 overflow-y-auto divide-y divide-pebble/50">
        {clients.length === 0 && (
          <p className="text-xs text-steel/60 italic px-3 py-3">No clients found for this workspace.</p>
        )}
        {clients.map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-2 px-3 py-2 hover:bg-mist/30 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selected.includes(c.id)}
              onChange={() => toggleOne(c.id)}
              className="rounded"
            />
            <span className="text-sm text-midnight truncate">{c.name}</span>
          </label>
        ))}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-steel mt-1.5">
          {selected.length} client{selected.length !== 1 ? "s" : ""} selected
          — will create {selected.length} task{selected.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ── Task Breakdown Modal ──────────────────────────────────────────────────────

function BreakdownModal({
  initiative,
  businessId,
  currentUserId,
  onClose,
  onCreated,
}: {
  initiative: MyInitiative;
  businessId: string;
  currentUserId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [taskType, setTaskType] = useState<"general" | "building" | "client">("general");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [buildings, setBuildings] = useState<BuildingEntity[]>([]);
  const [clients, setClients] = useState<ClientEntity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [title, setTitle] = useState("");
  const [secondaryStakeholderId, setSecondaryStakeholderId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load members once on mount
  useEffect(() => {
    apiFetch(`/api/v1/businesses/${businessId}/members`)
      .then((mems: any) => {
        setMembers(Array.isArray(mems) ? mems.filter((m: Member) => m.user_id !== currentUserId) : []);
      })
      .catch(() => {});
  }, [businessId, currentUserId]);

  // Load buildings or clients when task type changes
  useEffect(() => {
    if (taskType === "general") return;
    const bizId = businessId || (typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "");
    if (!bizId) return;
    setSelectedEntities([]);
    setLoadingEntities(true);
    const endpoint = taskType === "building"
      ? `/api/v1/businesses/${bizId}/buildings`
      : `/api/v1/businesses/${bizId}/clients`;
    apiFetch(endpoint)
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : [];
        if (taskType === "building") setBuildings(arr);
        else setClients(arr);
      })
      .catch(() => {})
      .finally(() => setLoadingEntities(false));
  }, [taskType, businessId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const task = await apiFetch("/api/v1/tasks/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          priority,
          status: "todo",
          primary_stakeholder_id: currentUserId,
          initiative_id: initiative.id,
          ...(dueDate && { due_date: dueDate }),
          entities: taskType !== "general"
            ? selectedEntities.map((id) => ({ entity_type: taskType, entity_id: id }))
            : [],
        }),
      });

      if (secondaryStakeholderId) {
        await apiFetch(`/api/v1/tasks/${task.id}/stakeholders`, {
          method: "POST",
          body: JSON.stringify({ user_id: secondaryStakeholderId, role: "secondary" }),
        }).catch(() => {});
      }

      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to create task: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const cat = initiative.impact_category ?? "others";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-midnight">Break Down Initiative</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>
        <div className="flex items-center gap-2 mb-5">
          <span className="text-sm text-steel">{initiative.name}</span>
          {initiative.impact_category && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border ${IMPACT_CATEGORY_COLOR[cat]}`}>
              {IMPACT_CATEGORY_LABEL[cat]}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Task Type — always first */}
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">
              Task Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["general", "building", "client"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTaskType(type); setSelectedEntities([]); }}
                  className={`py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    taskType === type
                      ? "bg-taskora-red text-white border-taskora-red"
                      : "border-pebble text-steel hover:border-ocean/40"
                  }`}
                >
                  {type === "general" ? "General" : type === "building" ? "Building" : "Client"}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Entity selector — appears immediately after task type for building/client */}
          {taskType === "building" && (
            loadingEntities
              ? <p className="text-xs text-steel/60 italic py-2">Loading buildings…</p>
              : <BuildingSelector buildings={buildings} selected={selectedEntities} onChange={setSelectedEntities} />
          )}
          {taskType === "client" && (
            loadingEntities
              ? <p className="text-xs text-steel/60 italic py-2">Loading clients…</p>
              : <ClientSelector clients={clients} selected={selectedEntities} onChange={setSelectedEntities} />
          )}

          {/* 3. Task Title */}
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
              Task Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Audit electricity consumption"
              required
              autoFocus
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red"
            />
          </div>

          {/* 4. Secondary Stakeholder */}
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
              Secondary Stakeholder{" "}
              <span className="text-steel/50 font-normal">(optional)</span>
            </label>
            <select
              value={secondaryStakeholderId}
              onChange={(e) => setSecondaryStakeholderId(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red"
            >
              <option value="">None</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
              ))}
            </select>
          </div>

          {/* 5. Priority + Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                {["low", "medium", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-pebble text-sm text-steel hover:bg-mist"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── New Task Modal ─────────────────────────────────────────────────────────────

function NewTaskModal({
  businessId,
  currentUserId,
  initiatives,
  onClose,
  onCreated,
}: {
  businessId: string;
  currentUserId: string;
  initiatives: MyInitiative[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [taskType, setTaskType] = useState<"general" | "building" | "client">("general");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [buildings, setBuildings] = useState<BuildingEntity[]>([]);
  const [clients, setClients] = useState<ClientEntity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [secondaryStakeholderId, setSecondaryStakeholderId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!businessId) return;
    apiFetch(`/api/v1/businesses/${businessId}/members`)
      .then((mems: any) => {
        setMembers(Array.isArray(mems) ? mems.filter((m: Member) => m.user_id !== currentUserId) : []);
      })
      .catch(() => {});
  }, [businessId, currentUserId]);

  useEffect(() => {
    if (taskType === "general") return;
    if (!businessId) return;
    setSelectedEntities([]);
    setLoadingEntities(true);
    const endpoint = taskType === "building"
      ? `/api/v1/businesses/${businessId}/buildings`
      : `/api/v1/businesses/${businessId}/clients`;
    apiFetch(endpoint)
      .then((data: any) => {
        const arr = Array.isArray(data) ? data : [];
        if (taskType === "building") setBuildings(arr);
        else setClients(arr);
      })
      .catch(() => {})
      .finally(() => setLoadingEntities(false));
  }, [taskType, businessId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setError("");
    try {
      const task = await apiFetch("/api/v1/tasks/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          priority,
          primary_stakeholder_id: currentUserId,
          ...(initiativeId && { initiative_id: initiativeId }),
          ...(dueDate && { due_date: dueDate }),
          entities: taskType !== "general"
            ? selectedEntities.map((id) => ({ entity_type: taskType, entity_id: id }))
            : [],
        }),
      });
      if (secondaryStakeholderId) {
        await apiFetch(`/api/v1/tasks/${task.id}/stakeholders`, {
          method: "POST",
          body: JSON.stringify({ user_id: secondaryStakeholderId, role: "secondary" }),
        }).catch(() => {});
      }
      onCreated();
      onClose();
    } catch (err: unknown) {
      setError("Failed to create task: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-midnight">New Task</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5 text-steel" />
          </button>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          {/* Task Type */}
          <div>
            <label className="text-xs text-steel font-semibold uppercase tracking-wider mb-2 block">
              Task Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["general", "building", "client"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => { setTaskType(type); setSelectedEntities([]); }}
                  className={`py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    taskType === type
                      ? "bg-taskora-red text-white border-taskora-red"
                      : "border-pebble text-steel hover:border-ocean/40"
                  }`}
                >
                  {type === "general" ? "General" : type === "building" ? "Building" : "Client"}
                </button>
              ))}
            </div>
          </div>

          {/* Entity selector */}
          {taskType === "building" && (
            loadingEntities
              ? <p className="text-xs text-steel/60 italic py-1">Loading buildings…</p>
              : <BuildingSelector buildings={buildings} selected={selectedEntities} onChange={setSelectedEntities} />
          )}
          {taskType === "client" && (
            loadingEntities
              ? <p className="text-xs text-steel/60 italic py-1">Loading clients…</p>
              : <ClientSelector clients={clients} selected={selectedEntities} onChange={setSelectedEntities} />
          )}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            required
            autoFocus
            className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"
              >
                {["low", "medium", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">
                Due date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"
              />
            </div>
          </div>
          {initiatives.length > 0 && (
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">
                Link to Initiative
              </label>
              <select
                value={initiativeId}
                onChange={(e) => setInitiativeId(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"
              >
                <option value="">None</option>
                {initiatives.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {members.length > 0 && (
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">
                Secondary Stakeholder <span className="text-steel/50">(optional)</span>
              </label>
              <select
                value={secondaryStakeholderId}
                onChange={(e) => setSecondaryStakeholderId(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"
              >
                <option value="">None</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
                ))}
              </select>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel hover:bg-mist"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Initiative Group ──────────────────────────────────────────────────────────

function InitiativeGroup({
  initiative,
  tasks,
  members,
  currentUserId,
  myRole,
  highlighted,
  onStatusChange,
  onTaskDeleted,
  onBreakdown,
  onGantt,
  onDelete,
  focusTaskId,
  focusSubtaskId,
}: {
  initiative: MyInitiative | null; // null = "Unlinked"
  tasks: Task[];
  members: Member[];
  currentUserId: string;
  myRole: string;
  highlighted: boolean;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onTaskDeleted: (taskId: string) => void;
  // Per-initiative actions, hoisted from the page so a single BreakdownModal/
  // GanttModal lives at page level. Null `initiative` means the "Unlinked"
  // group, where these callbacks aren't passed.
  onBreakdown?: () => void;
  onGantt?: () => void;
  onDelete?: () => void;
  focusTaskId?: string | null;
  focusSubtaskId?: string | null;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const containsFocus = !!focusTaskId && tasks.some((t) => t.id === focusTaskId);
  const [collapsed, setCollapsed] = useState(!highlighted && !containsFocus);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu when the user clicks outside of it.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const canDelete =
    !!initiative &&
    (initiative.primary_stakeholder_id === currentUserId ||
      myRole === "owner" ||
      myRole === "admin");
  const hasActions = !!initiative && !!(onBreakdown || onGantt || (onDelete && canDelete));

  // Auto-scroll to highlighted group
  useEffect(() => {
    if (highlighted && groupRef.current) {
      groupRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlighted]);

  // A deep-linked task lives in this group → make sure it's open so the
  // card can reveal & scroll itself.
  useEffect(() => {
    if (containsFocus) setCollapsed(false);
  }, [containsFocus]);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;

  const programColor = initiative?.programs?.color ?? "#6B7280";
  const cat = initiative?.impact_category;
  const catColor = cat ? IMPACT_CATEGORY_COLOR[cat] : null;
  const catLabel = cat ? IMPACT_CATEGORY_LABEL[cat] : null;

  return (
    <div
      ref={groupRef}
      className={`rounded-xl border overflow-hidden transition-colors ${
        highlighted
          ? "border-ocean/20 bg-ocean/5"
          : "border-pebble bg-white"
      }`}
    >
      {/* Group Header — clickable to collapse, with action buttons that
          stop propagation so they don't trigger the collapse toggle. */}
      <div className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-black/[0.02] transition-colors">
        {/* Colored dot */}
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: programColor }}
          />

          {/* Initiative name */}
          <span className="flex-1 font-semibold text-midnight text-sm truncate">
            {initiative ? initiative.name : "Unlinked Tasks"}
          </span>

          {/* Program badge */}
          {initiative?.programs && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium text-white flex-shrink-0"
              style={{ backgroundColor: initiative.programs.color ?? "#6366F1" }}
            >
              {initiative.programs.name}
            </span>
          )}

          {/* Category badge */}
          {catColor && catLabel && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border flex-shrink-0 ${catColor}`}
            >
              {catLabel}
            </span>
          )}

          {/* X/Y done — or a "No tasks yet" hint when the initiative
              hasn't been broken down. Surfaces empty work so an admin
              filtering by owner sees who has open initiatives but no tasks. */}
          {total === 0 ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">
              No tasks yet
            </span>
          ) : (
            <span className="text-xs text-steel/60 flex-shrink-0 tabular-nums">
              {doneCount}/{total} done
            </span>
          )}

          {/* Chevron */}
          <span className="text-steel/40 flex-shrink-0">
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </span>
        </button>

        {/* Per-initiative actions — only on real initiatives, not the Unlinked group */}
        {hasActions && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {onBreakdown && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBreakdown();
                }}
                title="Add a task to this initiative"
                aria-label="Add task"
                className="w-8 h-8 rounded-lg text-steel hover:bg-mist hover:text-taskora-red flex items-center justify-center transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                title="More actions"
                aria-label="More actions"
                aria-expanded={menuOpen}
                className="w-8 h-8 rounded-lg text-steel hover:bg-mist hover:text-midnight flex items-center justify-center transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-pebble rounded-lg shadow-lg z-20 py-1 text-sm">
                  {onGantt && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onGantt();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-midnight hover:bg-mist"
                    >
                      <GanttChartSquare className="w-4 h-4 text-steel" />
                      View Gantt
                    </button>
                  )}
                  {onDelete && canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete initiative
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Tasks list */}
      {!collapsed && (
        <div className="border-t border-pebble/50 px-4 py-3 space-y-2.5">
          {tasks.length === 0 ? (
            <p className="text-xs text-steel/60 py-1.5">
              No tasks have been created under this initiative yet.
              {onBreakdown && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onBreakdown}
                    className="text-taskora-red font-medium hover:underline"
                  >
                    Add the first one
                  </button>
                  .
                </>
              )}
            </p>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                members={members}
                currentUserId={currentUserId}
                myRole={myRole}
                onStatusChange={onStatusChange}
                onDelete={onTaskDeleted}
                focusTaskId={focusTaskId}
                focusSubtaskId={focusSubtaskId}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Inner Page (needs useSearchParams) ────────────────────────────────────────

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightInitiativeId = searchParams.get("initiative");
  const focusTaskId = searchParams.get("task");
  const focusSubtaskId = searchParams.get("subtask");

  const PAGE_SIZE = 20;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [initiatives, setInitiatives] = useState<MyInitiative[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [myRole, setMyRole] = useState("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  // B5: cursor pagination on /tasks/my/page
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Filters layered on top of the paged result (status is still server-side
  // via `filter`). These are client-side: they narrow the current page only.
  // For workspaces with many tasks per status, this is a known limitation
  // we'll address with a real server query when it becomes a real problem.
  const [search, setSearch] = useState("");
  const [programFilter, setProgramFilter] = useState<string>(""); // program id or "" = all
  const [ownerFilter, setOwnerFilter] = useState<string>("__me__"); // user id, "" = anyone, "__me__" = currentUser
  // Persisted to localStorage so navigating away (People, Daily Brief, …)
  // and back doesn't clear what the user was looking at. Gated by
  // `filtersHydrated` so the initial /tasks/my/page fetch waits for the
  // restored status filter — otherwise the load would fire with the default
  // "All" and immediately re-fire with the restored value.
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  // Per-initiative modals — owned by the page so any group can open them.
  const [breakdownFor, setBreakdownFor] = useState<MyInitiative | null>(null);
  const [ganttFor, setGanttFor] = useState<MyInitiative | null>(null);

  // Fetches a page of tasks. When `append` is true, results are appended to the
  // current list (used by Load More). Otherwise the list is replaced and the
  // cursor is reset (used by initial load and filter changes).
  const fetchTaskPage = useCallback(
    async (statusFilter: string, cursor: string | null, append: boolean) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) params.set("cursor", cursor);
      // The approval pills aren't plain tasks.status values — fetch the full
      // page and filter them client-side via matchesApprovalFilter.
      const isApprovalPill =
        statusFilter === "approval_pending" || statusFilter === "reopened";
      if (statusFilter !== "All" && !isApprovalPill)
        params.set("status", statusFilter);
      const page = await apiFetch(`/api/v1/tasks/my/page?${params.toString()}`);
      const items: Task[] = Array.isArray(page?.items) ? page.items : [];
      setTasks((prev) => (append ? [...prev, ...items] : items));
      setNextCursor(page?.next_cursor ?? null);
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login?next=/tasks");
        return;
      }
      const userId = session.user.id;
      setCurrentUserId(userId);

      // Fetch biz, first page of tasks, and initiatives in parallel.
      const [biz, , initData] = await Promise.all([
        apiFetch("/api/v1/businesses/my"),
        fetchTaskPage(filter, null, false),
        apiFetch("/api/v1/initiatives/my"),
      ]);

      setInitiatives(Array.isArray(initData) ? initData : []);
      if (biz?.id) {
        setBusinessId(biz.id);
        // Members and role are non-blocking
        Promise.all([
          apiFetch(`/api/v1/businesses/${biz.id}/members`),
          apiFetch(`/api/v1/businesses/${biz.id}/my-role`),
        ])
          .then(([memberData, roleData]: any[]) => {
            setMembers(
              Array.isArray(memberData)
                ? memberData.filter((m: Member) => m.user_id !== userId)
                : []
            );
            if (roleData?.role) setMyRole(roleData.role);
          })
          .catch(() => {});
      }
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (
        msg.toLowerCase().includes("not authenticated") ||
        msg.toLowerCase().includes("invalid or expired token")
      ) {
        router.replace("/login?next=/tasks");
        return;
      }
      setError("Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [filter, fetchTaskPage, router]);

  // Hydrate filter state from localStorage on mount, then mark hydrated.
  // After this, every filter change is persisted.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TASKS_FILTERS_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (typeof stored?.search === "string") setSearch(stored.search);
        if (typeof stored?.programFilter === "string")
          setProgramFilter(stored.programFilter);
        if (typeof stored?.ownerFilter === "string")
          setOwnerFilter(stored.ownerFilter);
        if (typeof stored?.filter === "string") setFilter(stored.filter);
      }
    } catch {
      /* corrupted storage — fall through with defaults */
    }
    setFiltersHydrated(true);
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;
    try {
      localStorage.setItem(
        TASKS_FILTERS_KEY,
        JSON.stringify({ search, programFilter, ownerFilter, filter }),
      );
    } catch {
      /* quota or storage disabled — silently ignore */
    }
  }, [filtersHydrated, search, programFilter, ownerFilter, filter]);

  useEffect(() => {
    // Wait for the saved status filter to hydrate before kicking off the
    // first server fetch — `load` depends on `filter`, so otherwise the
    // initial load fires with default "All" and immediately re-fires with
    // the restored value.
    if (!filtersHydrated) return;
    load();
    // load is intentionally re-created when filter changes, which retriggers this.
  }, [load, filtersHydrated]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchTaskPage(filter, nextCursor, true);
    } catch {
      /* silent */
    } finally {
      setLoadingMore(false);
    }
  }

  // Optimistic status update
  function handleStatusChange(taskId: string, newStatus: string) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: newStatus,
              // Mirror the backend's closure stamp optimistically; the next
              // page load replaces this with the exact server timestamp.
              closed_at:
                newStatus === "done"
                  ? t.closed_at ?? new Date().toISOString()
                  : null,
            }
          : t
      )
    );
  }

  // Optimistic delete
  function handleTaskDelete(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function handleInitiativeDelete(initiativeId: string) {
    setInitiatives((prev) => prev.filter((i) => i.id !== initiativeId));
    // Also remove tasks that belonged to this initiative
    setTasks((prev) => prev.filter((t) => t.initiative_id !== initiativeId));
  }

  async function handleDeleteInitiative(init: MyInitiative) {
    if (
      !confirm(
        `Delete initiative "${init.name}" and all its tasks? This cannot be undone.`,
      )
    )
      return;
    try {
      await apiFetch(`/api/v1/initiatives/${init.id}`, { method: "DELETE" });
      handleInitiativeDelete(init.id);
    } catch (err: any) {
      alert("Failed to delete: " + (err?.message ?? "Unknown error"));
    }
  }

  // Group tasks by initiative
  const initiativeMap = useMemo(
    () => Object.fromEntries(initiatives.map((i) => [i.id, i])),
    [initiatives]
  );

  // Unique program list, derived from the initiatives the user can see.
  // Used to populate the Program filter dropdown.
  const programs = useMemo(() => {
    const m = new Map<string, { id: string; name: string; color: string }>();
    initiatives.forEach((i) => {
      if (i.programs) m.set(i.programs.id, i.programs);
    });
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [initiatives]);

  // Server filters the page by status (B5). The two approval pills are
  // applied client-side over the fetched page, and so are search/program/owner.
  const isApprovalPill =
    filter === "approval_pending" || filter === "reopened";
  const isAdmin = myRole === "owner" || myRole === "admin";
  // Members can only filter by themselves — even if state somehow holds a
  // different ownerFilter (URL param, stale localStorage, etc.), force the
  // resolved id to the current user so we never list someone else's tasks
  // from a member's view.
  const resolvedOwnerId = !isAdmin
    ? currentUserId
    : ownerFilter === "__me__"
    ? currentUserId
    : ownerFilter;
  const searchLower = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (isApprovalPill && !matchesApprovalFilter(t, filter)) return false;
      if (programFilter) {
        const init = t.initiative_id ? initiativeMap[t.initiative_id] : null;
        if (init?.programs?.id !== programFilter) return false;
      }
      if (resolvedOwnerId) {
        if (t.primary_stakeholder_id !== resolvedOwnerId) return false;
      }
      if (searchLower) {
        if (!(t.title || "").toLowerCase().includes(searchLower)) return false;
      }
      return true;
    });
  }, [
    tasks,
    isApprovalPill,
    filter,
    programFilter,
    resolvedOwnerId,
    searchLower,
    initiativeMap,
  ]);

  // Build groups: one per initiative that has tasks, plus unlinked
  const tasksByInitiative: Record<string, Task[]> = {};
  const unlinkedTasks: Task[] = [];

  for (const task of filtered) {
    if (task.initiative_id) {
      if (!tasksByInitiative[task.initiative_id]) {
        tasksByInitiative[task.initiative_id] = [];
      }
      tasksByInitiative[task.initiative_id].push(task);
    } else {
      unlinkedTasks.push(task);
    }
  }

  // Initiatives matching the program/owner filter (regardless of whether
  // they have tasks). Used so an admin filtering by a primary user can see
  // initiatives in that user's name that don't have any tasks yet — the
  // group renders empty with a "No tasks yet" badge instead of being
  // silently hidden. Status and search filters are intentionally NOT
  // applied here: those are about finding existing tasks, not surfacing
  // empty initiatives.
  const filteredInitiatives = useMemo(() => {
    return initiatives.filter((i) => {
      if (programFilter && i.programs?.id !== programFilter) return false;
      if (resolvedOwnerId && i.primary_stakeholder_id !== resolvedOwnerId)
        return false;
      return true;
    });
  }, [initiatives, programFilter, resolvedOwnerId]);

  // Display ids = (initiatives with matching tasks) UNION (initiatives
  // matching program+owner). Empty-but-matching initiatives sort to the
  // bottom so active work stays on top.
  const displayInitiativeIds = useMemo(() => {
    const withTasks = new Set(Object.keys(tasksByInitiative));
    const ids = new Set<string>(withTasks);
    for (const i of filteredInitiatives) ids.add(i.id);
    return Array.from(ids).sort((a, b) => {
      const aHas = withTasks.has(a);
      const bHas = withTasks.has(b);
      if (aHas !== bHas) return aHas ? -1 : 1;
      const nameA = initiativeMap[a]?.name ?? "";
      const nameB = initiativeMap[b]?.name ?? "";
      return nameA.localeCompare(nameB);
    });
  }, [tasksByInitiative, filteredInitiatives, initiativeMap]);

  const activeFilterCount =
    (programFilter ? 1 : 0) +
    (ownerFilter !== "__me__" && ownerFilter !== "" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Tasks Section — initiatives now render as group headers inline */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-midnight">My Work</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>

        {/* Filter toolbar: search + program + owner + clear. */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-steel/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full h-9 pl-9 pr-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-taskora-red focus:ring-2 focus:ring-taskora-red/10"
            />
          </div>
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="h-9 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red"
            title="Filter by program"
          >
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {isAdmin ? (
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="h-9 px-3 border border-pebble rounded-lg text-sm bg-white focus:outline-none focus:border-taskora-red"
              title="Filter by primary owner"
            >
              <option value="__me__">Owner: Me</option>
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
          ) : (
            // Members can only filter by themselves — admins/owners get the
            // full picker above. Static chip makes the lock visible and the
            // resolvedOwnerId computation forces the current user even if
            // state somehow holds a different value.
            <div
              className="h-9 px-3 border border-pebble rounded-lg text-sm bg-mist/40 flex items-center text-steel/80 cursor-not-allowed select-none"
              title="Only admins and owners can filter by other people"
              aria-disabled
            >
              Owner: Me
            </div>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setSearch("");
                setProgramFilter("");
                setOwnerFilter("__me__");
              }}
              className="h-9 px-3 text-xs font-medium text-steel hover:text-midnight rounded-lg hover:bg-mist transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === s
                  ? "bg-taskora-red text-white"
                  : "bg-white border border-pebble text-steel hover:text-midnight"
              }`}
            >
              {FILTER_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        {/* Loading / error states */}
        {loading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-pebble p-4 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-3 h-3 rounded bg-gray-200" />
                  <div className="h-4 bg-gray-200 rounded w-2/5" />
                </div>
                <div className="space-y-2 pl-6">
                  {[...Array(2)].map((_, j) => (
                    <div key={j} className="flex items-center gap-3">
                      <div className="w-4 h-4 rounded border border-gray-200 bg-gray-100" />
                      <div className="h-3 bg-gray-200 rounded w-3/5" />
                      <div className="ml-auto h-5 bg-gray-200 rounded-full w-16" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="text-red-600 text-sm">
            {error}{" "}
            <button onClick={load} className="underline">
              Retry
            </button>
          </p>
        )}

        {!loading &&
          !error &&
          displayInitiativeIds.length === 0 &&
          unlinkedTasks.length === 0 && (
            <div className="text-center py-16 bg-white rounded-xl border border-pebble">
              <p className="text-steel text-sm italic">
                {activeFilterCount > 0
                  ? "No tasks or initiatives match your filters."
                  : "No tasks here yet."}
              </p>
            </div>
          )}

        {/* Grouped tasks */}
        {!loading &&
          !error &&
          (displayInitiativeIds.length > 0 || unlinkedTasks.length > 0) && (
          <div className="space-y-3">
            {/* Initiative groups — includes empty initiatives that match
                the program/owner filter, so e.g. "Owner: Hitesh" still
                shows his initiatives even if no tasks have been created. */}
            {displayInitiativeIds.map((initId) => {
              const init = initiativeMap[initId] ?? null;
              return (
                <InitiativeGroup
                  key={initId}
                  initiative={init}
                  tasks={tasksByInitiative[initId] ?? []}
                  members={members}
                  currentUserId={currentUserId}
                  myRole={myRole}
                  highlighted={highlightInitiativeId === initId}
                  onStatusChange={handleStatusChange}
                  onTaskDeleted={handleTaskDelete}
                  onBreakdown={init ? () => setBreakdownFor(init) : undefined}
                  onGantt={init ? () => setGanttFor(init) : undefined}
                  onDelete={
                    init ? () => handleDeleteInitiative(init) : undefined
                  }
                  focusTaskId={focusTaskId}
                  focusSubtaskId={focusSubtaskId}
                />
              );
            })}

            {/* Unlinked tasks group */}
            {unlinkedTasks.length > 0 && (
              <InitiativeGroup
                key="unlinked"
                initiative={null}
                tasks={unlinkedTasks}
                members={members}
                currentUserId={currentUserId}
                myRole={myRole}
                highlighted={false}
                onStatusChange={handleStatusChange}
                onTaskDeleted={handleTaskDelete}
                focusTaskId={focusTaskId}
                focusSubtaskId={focusSubtaskId}
              />
            )}

            {/* B5: Load more — visible only when the server says there are more pages */}
            {nextCursor && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-pebble bg-white text-steel hover:bg-mist disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <NewTaskModal
          businessId={businessId}
          currentUserId={currentUserId}
          initiatives={initiatives}
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}

      {/* Per-initiative modals — opened from any group header */}
      {breakdownFor && (
        <BreakdownModal
          initiative={breakdownFor}
          businessId={businessId}
          currentUserId={currentUserId}
          onClose={() => setBreakdownFor(null)}
          onCreated={() => {
            load();
            setBreakdownFor(null);
          }}
        />
      )}
      {ganttFor && (
        <GanttModal
          initiativeId={ganttFor.id}
          initiativeName={ganttFor.name}
          onClose={() => setGanttFor(null)}
        />
      )}
    </div>
  );
}

// ── Page export (Suspense boundary for useSearchParams) ───────────────────────

export default function TasksPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}
