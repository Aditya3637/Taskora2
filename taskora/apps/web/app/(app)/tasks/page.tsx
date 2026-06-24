"use client";
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, X, User, MessageSquare, Eye, ShieldCheck, GanttChartSquare, MoreHorizontal, Search, Trash2, Inbox, Filter, ChevronsUpDown, Archive, ArchiveRestore, FileText } from "lucide-react";
import { WorkDocPanel } from "../programs/_components/WorkDocPanel";
import { supabase } from "@/lib/supabase";
import { GanttModal } from "../gantt/GanttChart";
import { Button, Badge, Skeleton, EmptyState, PageHeader, cn, useToast, Select, DatePicker } from "@/components/ui";

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
  start_date?: string;
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
  // P4: present on read paths that cascade parent-task watchers down to
  // subtask rows. Underlying row stays at task scope; this just tags the
  // chip so the UI fades it and skips the remove button.
  inherited_from?: "task" | null;
};

type TaskEntity = {
  entity_id: string;
  entity_name?: string;
  entity_type?: string;
  per_entity_status?: string;
  per_entity_start_date?: string;
  per_entity_end_date?: string;
  closed_at?: string | null;
  approval_state?: string;
  watchers?: Watcher[];
  date_change_count?: number;
  latest_comment?: LatestComment;
  owner_id?: string | null;
  priority?: string | null;
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
  start_date?: string;
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
  // Set when the task has been archived out of the active list (admin action).
  archived_at?: string | null;
  // Resolved client-side from the task's initiative, so a due date beyond
  // the initiative's target end can be flagged (#6).
  initiative_target_end_date?: string;
  // Recurring cadence (005): 'none' | daily | weekly | fortnightly | monthly,
  // and the next occurrence the cron advances on mark-done.
  recurring_type?: string | null;
  next_meeting_at?: string | null;
  blocker_reason?: string | null;
  blocked_on_user_id?: string | null;
  blocked_since?: string | null;
};

// Whole days a task has sat blocked (deck: stuck-duration). null when n/a.
function blockedDays(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86400000);
}

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
  // P2 field parity with tasks (migration 039).
  description?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  priority?: "low" | "medium" | "high" | "urgent" | null;
  // Set when this attribute has been archived (admin action).
  archived_at?: string | null;
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
  // P5: present on the task-level rollup so the UI can render a source chip.
  scope_type?: "task" | "subtask" | "entity";
  subtask_id?: string | null;
  subtask_title?: string | null;
  entity_id?: string | null;
  entity_type?: string | null;
  entity_name?: string | null;
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

// Inline pill shown next to task titles for high/urgent priority so the
// signal isn't carried by the left-border color alone (which is easy to
// miss in a long list).
const PRIORITY_CHIP: Record<string, { label: string; cls: string }> = {
  urgent: {
    label: "Urgent",
    cls: "bg-red-50 text-red-700 border-red-200",
  },
  critical: {
    label: "Critical",
    cls: "bg-red-100 text-red-800 border-red-300",
  },
  high: { label: "High", cls: "bg-amber-50 text-amber-700 border-amber-200" },
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

// Expanded initiative-group ids are persisted so what a user has open
// survives navigation. On the very first visit (no entry yet) the page
// auto-expands the first non-empty group as a "where do I start" hint.
const TASKS_EXPANDED_GROUPS_KEY = "taskora_tasks_expanded_groups_v1";

// Approval-aware predicate for the special filter pills.
// Compact filter dropdown — styled <select> with a leading chevron and
// brand-colored active state (when a non-default value is picked).
function FilterSelect({
  value,
  onChange,
  label,
  placeholder,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder?: string;
  options: { value: string; label: string }[];
}) {
  // Active = a value other than the *first* option (typically the default
  // "all"/"me" choice). Highlights the chip when filtering is engaged so
  // the toolbar reads at a glance.
  const defaultValue = options[0]?.value ?? "";
  const active = value !== defaultValue && value !== "";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={label}
        aria-label={label}
        className={cn(
          "h-9 pl-3 pr-8 bg-surface border rounded-md text-[13px] appearance-none cursor-pointer",
          "transition-colors duration-fast",
          "focus:outline-none focus:ring-2 focus:ring-brand-500/20",
          active
            ? "border-brand-500/50 text-brand-700 focus:border-brand-500"
            : "border-line text-fg-muted hover:border-line-strong focus:border-brand-500/60",
        )}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronsUpDown
        aria-hidden="true"
        className={cn(
          "h-3 w-3 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none",
          active ? "text-brand-600" : "text-fg-subtle",
        )}
        strokeWidth={2}
      />
    </div>
  );
}

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
  isAdmin,
  onChanged,
  parentTask,
  programName,
  programColor,
  initiativeName,
  onOpenSheet,
  getChildren,
}: {
  subtask: Subtask;
  // Named `subChildren` (not `children`) so callers don't trip React's
  // reserved `children` prop — eslint react/no-children-prop.
  subChildren: Subtask[]; // child sub-subtasks; empty when subtask is itself a child
  taskId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
  // Workspace owner/admin — gates structural actions: add/delete attribute,
  // archive/restore. canManage (stakeholders) still covers status/title edits.
  isAdmin: boolean;
  onChanged: () => void;
  // P3: breadcrumb + sheet handoff. Optional so the deep-link / War Room
  // callers that don't render via TaskCard still work.
  parentTask?: Task;
  programName?: string;
  programColor?: string;
  initiativeName?: string;
  onOpenSheet?: (scope: SheetScope) => void;
  // Arbitrary-depth nesting: look up a row's direct children so each level can
  // render its own subtree recursively. Absent → behaves as a leaf.
  getChildren?: (parentId: string) => Subtask[];
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
  // Arbitrary-depth nesting: any subtask may now hold children.
  const canAddChild = true;

  const scope: WatcherScope = { scope_type: "subtask", subtask_id: subtask.id };
  const watchers = subtask.watchers ?? [];
  // P4: subtask.watchers now includes parent-task watchers tagged
  // inherited_from='task' so the cascade renders. Approval rights stay
  // scoped to the subtask — derive isApprover from non-inherited rows only,
  // otherwise a task-scope approver would see Approve/Reject buttons on
  // every subtask row and the backend would 4xx those calls.
  const isApprover = watchers.some(
    (w) =>
      w.role === "approver" &&
      w.user_id === currentUserId &&
      !w.inherited_from
  );
  const isRejected =
    subtask.approval_state === "rejected" || subtask.status === "reopened";
  const isArchived = !!subtask.archived_at;
  // Only a *done*, not-yet-archived attribute can be archived (admin only).
  const canArchive = isAdmin && !isArchived && subtask.status === "done";

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

  async function handleArchive() {
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}/archive`, {
        method: "POST",
      });
      setMenuOpen(false);
      onChanged();
    } catch (e: any) {
      alert("Failed to archive: " + (e?.message ?? "Unknown error"));
    } finally {
      setUpdating(false);
    }
  }

  async function handleRestore() {
    setUpdating(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}/restore`, {
        method: "POST",
      });
      setMenuOpen(false);
      onChanged();
    } catch (e: any) {
      alert("Failed to restore: " + (e?.message ?? "Unknown error"));
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
          isArchived
            ? "opacity-60 bg-mist/20"
            : isRejected
            ? "bg-red-50 border border-red-200 hover:bg-red-100/60"
            : "hover:bg-mist/30"
        }`}
      >
        {/* Chevron — any row can hold children now (arbitrary nesting) */}
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
          <div className="flex-1 min-w-0 flex items-center gap-1 group/title">
            <button
              type="button"
              onClick={() => {
                if (onOpenSheet && parentTask) {
                  onOpenSheet({
                    kind: "subtask",
                    subtask,
                    task: parentTask,
                    programName,
                    programColor,
                    initiativeName,
                  });
                  return;
                }
                // Fallback (no sheet wired): preserve legacy inline edit.
                if (!canManage) return;
                setTitleInput(subtask.title);
                setEditingTitle(true);
              }}
              title="Open subtask details"
              className={`text-xs min-w-0 text-left truncate px-1 py-0.5 rounded flex-1 ${
                subtask.status === "done"
                  ? "line-through text-steel/50"
                  : "text-midnight"
              } hover:bg-mist hover:text-ocean focus:outline-none focus:text-ocean`}
            >
              {subtask.title}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTitleInput(subtask.title);
                  setEditingTitle(true);
                }}
                aria-label="Rename inline"
                title="Rename inline"
                className="opacity-0 group-hover/title:opacity-100 focus:opacity-100 text-[10px] text-steel/50 hover:text-midnight px-1 transition-opacity"
              >
                ✎
              </button>
            )}
          </div>
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

        {subtask.due_date && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-steel flex-shrink-0"
            title={`Due ${subtask.due_date}`}
          >
            📅 {subtask.due_date}
          </span>
        )}

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

        {isArchived && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-steel/10 text-steel flex-shrink-0">
            Archived
          </span>
        )}

        {/* Add-child button — only on parent rows, admin-only, not on archived */}
        {canAddChild && isAdmin && !isArchived && (
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

        {/* Overflow menu — admin-only structural actions: archive/restore and
            delete. Hidden until hover/focus so the row stays clean. */}
        {isAdmin && (
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
              className="opacity-60 hover:opacity-100 focus:opacity-100 w-5 h-5 rounded text-steel/50 hover:bg-mist hover:text-midnight flex items-center justify-center transition-opacity"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-pebble rounded-lg shadow-lg z-30 py-1 text-sm">
                {isArchived ? (
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={updating}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-midnight hover:bg-mist disabled:opacity-50"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    Restore
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleArchive}
                    disabled={updating || !canArchive}
                    title={canArchive ? "Archive this attribute" : "Only a completed attribute can be archived"}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-midnight hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Archive
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={updating}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete subtask
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Children + add-child form. Recurses to any depth via getChildren. */}
      {expanded && (
        <div className="ml-6 pl-2 border-l border-pebble/30">
          {subChildren.map((c) => (
            <SubtaskRow
              key={c.id}
              subtask={c}
              subChildren={getChildren ? getChildren(c.id) : []}
              taskId={taskId}
              members={members}
              currentUserId={currentUserId}
              canManage={canManage}
              isAdmin={isAdmin}
              onChanged={onChanged}
              parentTask={parentTask}
              programName={programName}
              programColor={programColor}
              initiativeName={initiativeName}
              onOpenSheet={onOpenSheet}
              getChildren={getChildren}
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

// Inline "show archived" toggle — reveals archived rows in place so the
// archive lives within the list it belongs to (no separate page).
function ShowArchivedToggle({
  on,
  count,
  onToggle,
  label,
}: {
  on: boolean;
  count: number;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-1 inline-flex items-center gap-1 text-[11px] text-steel/60 hover:text-midnight font-medium py-0.5"
    >
      <Archive className="w-3 h-3" />
      {on
        ? "Hide archived"
        : `Show ${count > 0 ? count + " " : ""}${label}`}
    </button>
  );
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
      {watchers.map((w) => {
        // P4: parent-task watchers surface on subtask rows tagged inherited_from
        // = 'task'. Render them faded so users see the cascade, and disable
        // the remove × (the underlying row lives at task scope, not here).
        const inherited = w.inherited_from === "task";
        return (
          <span
            key={`${w.id}-${inherited ? "inh" : "own"}`}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] border ${
              w.role === "approver"
                ? "bg-violet-50 text-violet-700 border-violet-200"
                : "bg-gray-50 text-steel border-pebble"
            } ${inherited ? "opacity-60" : ""}`}
            title={
              inherited
                ? `${w.role === "approver" ? "Approver" : "Follower"} on parent task: ${w.name || w.email || "Member"}`
                : `${w.role === "approver" ? "Approver" : "Follower"}: ${w.name || w.email || "Member"}`
            }
          >
            {w.role === "approver" ? (
              <ShieldCheck className="w-3 h-3 flex-shrink-0" />
            ) : (
              <Eye className="w-3 h-3 flex-shrink-0" />
            )}
            <span className="max-w-[70px] truncate">
              {w.name || w.email || "Member"}
            </span>
            {inherited && (
              <span className="text-[8px] uppercase tracking-wide text-steel/60 ml-0.5">
                inh
              </span>
            )}
            {canManage && !inherited && (
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
        );
      })}

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
                      // P4: inherited rows reflect membership at a higher
                      // scope; admins can still explicitly add the same
                      // person here. Only filter own-scope duplicates.
                      !watchers.some(
                        (w) =>
                          w.user_id === m.user_id &&
                          w.role === addRole &&
                          !w.inherited_from
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
  includeDescendants,
}: {
  apiPath: string;
  title: string;
  onClose: () => void;
  // Fired after a successful post with the freshly-created comment so callers
  // can refresh their inline "latest comment" preview instantly.
  onPosted?: (created: Comment) => void;
  // P5: when true, the task-scope thread is loaded with ?include_descendants=true
  // so the rollup of every subtree comment renders here with scope chips.
  // Posting still hits the base apiPath (task scope) — posts under subtasks
  // happen by clicking into that subtask's own thread.
  includeDescendants?: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadComments() {
    setLoading(true);
    try {
      const url = includeDescendants
        ? `${apiPath}${apiPath.includes("?") ? "&" : "?"}include_descendants=true`
        : apiPath;
      const data = await apiFetch(url);
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

  // Portal to <body>: rendered in place, `fixed` is relative to any
  // transformed/scrolled ancestor panel (so the modal lands at the top of
  // that container and you must scroll up to see it). Mounted on <body>
  // it's truly viewport-centered regardless of where it's opened from.
  if (typeof document === "undefined") return null;
  return createPortal(
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
                  <span className="text-xs font-semibold text-midnight flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{c.author_name ?? "Team member"}</span>
                    {c.kind === "rejection" && (
                      <span className="text-[10px] font-bold text-red-700 uppercase">
                        Rejected
                      </span>
                    )}
                    {c.kind === "approval" && (
                      <span className="text-[10px] font-bold text-green-700 uppercase">
                        Approved
                      </span>
                    )}
                    {/* P5: scope chip — only shown when the rollup is on AND
                        the comment is from a descendant scope. */}
                    {c.scope_type && c.scope_type !== "task" && (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-ocean/10 text-ocean border border-ocean/20 truncate max-w-[140px]"
                        title={
                          c.scope_type === "subtask"
                            ? `Subtask: ${c.subtask_title || ""}`
                            : `${c.entity_type ?? "Entity"}: ${c.entity_name || ""}`
                        }
                      >
                        {c.scope_type === "subtask"
                          ? `↳ ${c.subtask_title || "subtask"}`
                          : `▢ ${c.entity_name || "entity"}`}
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
    </div>,
    document.body,
  );
}

// ── Entity Subtask Row (entity = first-level subtask, supports nested sub-subtasks) ──

// Attach another building/client to a task (admin/owner). Lists the
// workspace's entities of the task's type, minus the ones already attached.
function AddEntityInline({
  taskId,
  entityType,
  existingIds,
  onAdded,
}: {
  taskId: string;
  entityType: "building" | "client";
  existingIds: Set<string>;
  onAdded: (e: TaskEntity) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [sel, setSel] = useState("");
  const [saving, setSaving] = useState(false);
  const label = entityType === "building" ? "building" : "client";

  useEffect(() => {
    if (!open) return;
    const bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    if (!bizId) return;
    const ep = entityType === "building" ? "buildings" : "clients";
    apiFetch(`/api/v1/businesses/${bizId}/${ep}`)
      .then((d: any) => setOptions(Array.isArray(d) ? d : []))
      .catch(() => setOptions([]));
  }, [open, entityType]);

  const available = options.filter((o) => !existingIds.has(o.id));

  async function add() {
    if (!sel) return;
    setSaving(true);
    try {
      const created = await apiFetch(`/api/v1/tasks/${taskId}/entities`, {
        method: "POST",
        body: JSON.stringify({ entity_type: entityType, entity_id: sel }),
      });
      onAdded({
        entity_id: created.entity_id,
        entity_type: created.entity_type,
        entity_name: created.entity_name,
        per_entity_status: created.per_entity_status ?? "backlog",
      });
      setSel("");
      setOpen(false);
    } catch (e: any) {
      alert("Failed to add: " + (e?.message ?? "Unknown error"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs text-taskora-red hover:underline font-medium flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> Add {label}
      </button>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-2">
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        className="flex-1 text-xs border border-pebble rounded px-2 py-1.5 focus:outline-none focus:border-ocean max-w-[220px]"
      >
        <option value="">{available.length ? `Select a ${label}…` : `No more ${label}s`}</option>
        {available.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={add}
        disabled={!sel || saving}
        className="text-xs px-2.5 py-1.5 rounded bg-taskora-red text-white font-medium hover:opacity-90 disabled:opacity-40"
      >
        {saving ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setSel(""); }}
        className="text-xs px-2 py-1.5 rounded text-steel hover:bg-mist"
      >
        Cancel
      </button>
    </div>
  );
}

function EntitySubtaskRow({
  entity,
  taskId,
  members,
  currentUserId,
  canManage,
  isAdmin,
  subtasks,
  subtasksLoading,
  onEntityUpdate,
  onEntityRemoved,
  onSubtasksChanged,
  parentTask,
  programName,
  programColor,
  initiativeName,
  onOpenSheet,
}: {
  entity: TaskEntity;
  taskId: string;
  members: Member[];
  currentUserId: string;
  canManage: boolean;
  isAdmin: boolean;
  // B4: subtasks now come from a single parent-level fetch instead of one
  // request per entity. Empty array = no subtasks (not "not loaded yet").
  subtasks: Subtask[];
  subtasksLoading: boolean;
  onEntityUpdate?: (entityId: string, updates: Partial<TaskEntity>) => void;
  onEntityRemoved?: (entityId: string) => void;
  onSubtasksChanged: () => void;
  // P3: pass-through so the entity-scoped subtasks can also open the sheet.
  parentTask?: Task;
  programName?: string;
  programColor?: string;
  initiativeName?: string;
  onOpenSheet?: (scope: SheetScope) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [entityStatus, setEntityStatus] = useState(entity.per_entity_status ?? "backlog");
  const [entityStartDate, setEntityStartDate] = useState(entity.per_entity_start_date?.slice(0, 10) ?? "");
  const [entityEndDate, setEntityEndDate] = useState(entity.per_entity_end_date?.slice(0, 10) ?? "");
  const [entityOwner, setEntityOwner] = useState(entity.owner_id ?? "");
  const [entityPriority, setEntityPriority] = useState(entity.priority ?? "medium");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function patchEntity(patch: Record<string, unknown>) {
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, {
        method: "PATCH", body: JSON.stringify(patch),
      });
      onEntityUpdate?.(entity.entity_id, patch as Partial<TaskEntity>);
    } catch { /* silent */ }
  }
  const [removing, setRemoving] = useState(false);
  const [showComments, setShowComments] = useState(false);

  // Remove this building/client (attribute) from the task — admin/owner only.
  async function handleRemoveEntity() {
    const label = entity.entity_name ?? "this building/client";
    if (!confirm(`Remove "${label}" from this task? Its sub-tasks under this building are also removed. This cannot be undone.`)) return;
    setRemoving(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, { method: "DELETE" });
      onEntityRemoved?.(entity.entity_id);
    } catch (e: any) {
      alert("Failed to remove: " + (e?.message ?? "Unknown error"));
      setRemoving(false);
    }
  }
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

  async function handleEntityStartChange(e: React.ChangeEvent<HTMLInputElement>) {
    e.stopPropagation();
    const newDate = e.target.value;
    setEntityStartDate(newDate);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, {
        method: "PATCH",
        body: JSON.stringify({ per_entity_start_date: newDate || null }),
      });
      onEntityUpdate?.(entity.entity_id, { per_entity_start_date: newDate });
    } catch { /* silent */ }
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
  // Counts exclude archived attributes (those only show when "show archived"
  // is on, which is controlled at the parent task level).
  const activeParents = parentSubtasks.filter((s) => !s.archived_at);
  const doneCount = activeParents.filter((s) => s.status === "done").length;
  const totalCount = activeParents.length;
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

        {/* Per-entity planned start date — needed for a real Gantt bar */}
        <input
          type="date"
          value={entityStartDate}
          onChange={handleEntityStartChange}
          onClick={(e) => e.stopPropagation()}
          title="Planned start date"
          className="text-xs border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean flex-shrink-0"
        />
        <span className="text-steel/40 text-xs flex-shrink-0">→</span>

        {/* Per-entity planned end date */}
        <input
          type="date"
          value={entityEndDate}
          min={entityStartDate || undefined}
          onChange={handleEntityDateChange}
          onClick={(e) => e.stopPropagation()}
          title="Planned end date"
          className="text-xs border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean flex-shrink-0"
        />

        {/* Per-entity owner (who's accountable at this site) */}
        <select
          value={entityOwner}
          onChange={(e) => { setEntityOwner(e.target.value); patchEntity({ owner_id: e.target.value || null }); }}
          onClick={(e) => e.stopPropagation()}
          disabled={!canManage}
          title="Site owner"
          className="text-xs border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean flex-shrink-0 max-w-[110px] disabled:opacity-60"
        >
          <option value="">Owner…</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? "Member"}</option>
          ))}
        </select>

        {/* Per-entity priority */}
        <select
          value={entityPriority}
          onChange={(e) => { setEntityPriority(e.target.value); patchEntity({ priority: e.target.value }); }}
          onClick={(e) => e.stopPropagation()}
          disabled={!canManage}
          title="Site priority"
          className="text-xs border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean flex-shrink-0 disabled:opacity-60"
        >
          {["low", "medium", "high", "urgent"].map((p) => (
            <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
          ))}
        </select>

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

        {/* Remove this building/client — admin/owner only. */}
        {isAdmin && (
          <button
            type="button"
            onClick={handleRemoveEntity}
            disabled={removing}
            title="Remove this building/client from the task"
            aria-label="Remove building/client"
            className="opacity-60 hover:opacity-100 w-5 h-5 rounded text-steel/50 hover:bg-red-50 hover:text-red-600 flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
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
              isAdmin={isAdmin}
              onChanged={onSubtasksChanged}
              parentTask={parentTask}
              programName={programName}
              programColor={programColor}
              initiativeName={initiativeName}
              onOpenSheet={onOpenSheet}
              getChildren={(pid) => childrenByParent[pid] ?? []}
            />
          ))}
          {!subtasksLoading && totalCount === 0 && (
            <p className="text-xs text-steel/50 py-1 italic">
              No sub-tasks yet.
            </p>
          )}
          {/* Adding attributes is admin/owner only. */}
          {isAdmin && (showAdd ? (
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
          ))}
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
  onArchived,
  onRestored,
  focusTaskId,
  focusSubtaskId,
  programName,
  programColor,
  initiativeName,
  onOpenSheet,
  selected,
  onToggleSelect,
}: {
  task: Task;
  members: Member[];
  currentUserId: string;
  myRole: string;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onDelete: (taskId: string) => void;
  // Admin archive/restore. Archiving an active card removes it from the
  // active list; restoring an archived card removes it from the archived list.
  onArchived?: (taskId: string) => void;
  onRestored?: (taskId: string) => void;
  focusTaskId?: string | null;
  focusSubtaskId?: string | null;
  // P3: breadcrumb context for the detail sheet — supplied by InitiativeGroup.
  programName?: string;
  programColor?: string;
  initiativeName?: string;
  onOpenSheet?: (scope: SheetScope) => void;
  // Bulk-select: when onToggleSelect is supplied the card shows a checkbox.
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
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
  const [archiving, setArchiving] = useState(false);
  // When on, the grouped fetch also returns archived attributes so they can
  // be revealed inline (admin "show archived" toggle within the task). An
  // archived task's children are all archived too, so default it on there.
  const [showArchivedSubs, setShowArchivedSubs] = useState(!!task.archived_at);
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

  const isAdmin = myRole === "owner" || myRole === "admin";

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

  function handleEntityRemoved(entityId: string) {
    setLocalEnts((prev) => prev.filter((e) => e.entity_id !== entityId));
    loadSubtasksGrouped();
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

  const isArchived = !!task.archived_at;
  // Only a *done*, not-yet-archived task can be archived (admin only).
  const canArchiveTask = isAdmin && !isArchived && task.status === "done";

  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation();
    setArchiving(true);
    setCardMenuOpen(false);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/archive`, { method: "POST" });
      onArchived?.(task.id);
    } catch (err: any) {
      alert("Failed to archive: " + (err?.message ?? "Unknown error"));
      setArchiving(false);
    }
  }

  async function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
    setArchiving(true);
    setCardMenuOpen(false);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}/restore`, { method: "POST" });
      onRestored?.(task.id);
    } catch (err: any) {
      alert("Failed to restore: " + (err?.message ?? "Unknown error"));
      setArchiving(false);
    }
  }

  const loadSubtasksGrouped = useCallback(async () => {
    setLoadingSubtasks(true);
    try {
      const qs = showArchivedSubs ? "?include_archived=true" : "";
      const data = await apiFetch(`/api/v1/tasks/${task.id}/subtasks-grouped${qs}`);
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
  }, [task.id, showArchivedSubs]);

  // Refetch when the archived toggle flips (after the first load).
  useEffect(() => {
    if (groupedLoaded) loadSubtasksGrouped();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchivedSubs]);

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

  // Mark-done quick-toggle — mirrors SubtaskRow.toggleDone so tasks and
  // subtasks share the round-checkbox affordance.
  const [togglingDone, setTogglingDone] = useState(false);
  async function toggleDone(e: React.MouseEvent) {
    e.stopPropagation();
    if (togglingDone) return;
    const next = task.status === "done" ? "todo" : "done";
    setTogglingDone(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      onStatusChange(task.id, next);
    } catch {
      /* silent — parent will eventually refetch */
    } finally {
      setTogglingDone(false);
    }
  }

  // doneCount only meaningful for the flat (no-entity) view; entity-scoped
  // tasks display their own X/Y counts per building. Counts exclude archived
  // attributes (those only appear when "show archived" is on).
  const activeFlat = grouped.task_flat.filter((s) => !s.archived_at);
  const doneCount = activeFlat.filter((s) => s.status === "done").length;
  const flatTotal = activeFlat.length;
  const archivedSubCount = grouped.task_flat.filter((s) => !!s.archived_at).length;
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
      className={`rounded-xl border border-l-4 shadow-sm hover:shadow-md transition-shadow scroll-mt-20 ${
        PRIORITY_BORDER[task.priority] ?? "border-l-gray-300"
      } ${
        isArchived
          ? "bg-mist/20 border-pebble opacity-70"
          : taskRejected
          ? "bg-red-50 border-red-200"
          : "bg-white border-pebble"
      } ${isFocused ? "ring-2 ring-ocean ring-offset-2" : ""}`}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 flex items-start gap-2">
            {/* Quick-done checkbox — same affordance subtasks use. Disabled
                for users who can't write to this task. */}
            <button
              type="button"
              onClick={toggleDone}
              disabled={!canEditTask || togglingDone}
              className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors disabled:opacity-40 ${
                task.status === "done"
                  ? "bg-green-500 border-green-500"
                  : "border-pebble hover:border-ocean"
              }`}
              title={
                task.status === "done"
                  ? "Mark as not done"
                  : canEditTask
                  ? "Mark as done"
                  : "Read-only"
              }
              aria-label="Toggle done"
            >
              {task.status === "done" && (
                <span className="text-white text-[10px] font-bold leading-none">✓</span>
              )}
            </button>
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => onOpenSheet?.({
                  kind: "task",
                  task,
                  programName,
                  programColor,
                  initiativeName,
                })}
                className={`text-sm font-medium truncate text-left hover:text-ocean focus:outline-none focus:text-ocean ${
                  task.status === "done" ? "line-through text-steel/60" : "text-midnight"
                }`}
                title="Open task details"
              >
                {task.title}
              </button>
              {PRIORITY_CHIP[task.priority] && (
                <span
                  className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${PRIORITY_CHIP[task.priority].cls}`}
                  title={`Priority: ${PRIORITY_CHIP[task.priority].label}`}
                >
                  {PRIORITY_CHIP[task.priority].label}
                </span>
              )}
              {isArchived && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-steel/10 text-steel flex-shrink-0 inline-flex items-center gap-1">
                  <Archive className="w-2.5 h-2.5" /> Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Bulk-select checkbox (only when selection is active). */}
              {onToggleSelect && (
                <input
                  type="checkbox"
                  checked={!!selected}
                  onChange={() => onToggleSelect(task.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Select task"
                  className="h-3.5 w-3.5 rounded border-pebble accent-taskora-red cursor-pointer"
                />
              )}
              {/* Inline status select */}
              <StatusSelect task={task} onStatusChange={onStatusChange} />

              {/* Stuck-duration: how long it's sat blocked (deck). */}
              {task.status === "blocked" && blockedDays(task.blocked_since) !== null && (
                <span
                  className="inline-flex items-center text-[10.5px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 font-medium"
                  title={`Blocked since ${new Date(task.blocked_since!).toLocaleDateString()}`}
                >
                  blocked {blockedDays(task.blocked_since)}d
                </span>
              )}

              {/* Recurring cadence + next occurrence (read-only badge). */}
              {task.recurring_type && task.recurring_type !== "none" && (
                <span
                  className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium"
                  title={task.next_meeting_at ? `Next: ${new Date(task.next_meeting_at).toLocaleString()}` : "Recurring task"}
                >
                  🔁 {task.recurring_type}
                  {task.next_meeting_at &&
                    ` · ${new Date(task.next_meeting_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`}
                </span>
              )}

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
                    {(() => {
                      const beyond = !!task.initiative_target_end_date
                        && !!task.due_date
                        && task.due_date > task.initiative_target_end_date;
                      return (
                        <span
                          className={beyond ? "text-amber-700 font-semibold" : undefined}
                          title={beyond
                            ? `Beyond initiative due date (target end ${task.initiative_target_end_date})`
                            : undefined}
                        >
                          📅 {task.due_date}{beyond ? " ⚠" : ""}
                        </span>
                      );
                    })()}
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

              {/* Quick "+ Subtask" — expands the card and opens the
                  AddSubtaskInline form so users can add a subtask without
                  first hunting for the chevron. Visible only for users who
                  can write to this task. */}
              {canManageWatchers && localEnts.length === 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!expanded) toggleExpand();
                    setShowAddSubtask(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-pebble text-steel hover:border-taskora-red hover:text-taskora-red transition-colors"
                  title="Add a subtask"
                >
                  <Plus className="w-3 h-3" /> Subtask
                </button>
              )}
            </div>



          </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
            {/* Assignee chip — primary stakeholder. Sits before the
                comments/remarks button so the eye lands on "who owns this"
                first when scanning the right edge of the card. */}
            {(() => {
              const assigneeId = task.primary_stakeholder_id;
              if (!assigneeId) return null;
              const isMe = assigneeId === currentUserId;
              const assignee = members.find((m) => m.user_id === assigneeId);
              const name = isMe ? "Me" : assignee?.name || assignee?.email || "Member";
              const inits = isMe
                ? "Me"
                : (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?");
              return (
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium max-w-[140px] ${
                    isMe
                      ? "bg-taskora-red/10 text-taskora-red"
                      : "bg-ocean/10 text-ocean"
                  }`}
                  title={isMe ? "Assigned to you" : `Assigned to ${name}`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                      isMe ? "bg-taskora-red text-white" : "bg-ocean/20 text-ocean"
                    }`}
                  >
                    {inits}
                  </span>
                  <span className="truncate hidden sm:inline">{name}</span>
                </span>
              );
            })()}

            {/* Action group — comments / details / overflow live inside one
                bordered container with subtle inner dividers so the right
                edge reads as a single control surface instead of three
                detached pills. TatBadge floats outside since it's a status
                indicator, not an action. */}
            <div className="inline-flex items-stretch gap-1">
            <div className="inline-flex items-stretch rounded-md border border-pebble divide-x divide-pebble/60 bg-white overflow-hidden">
              {/* Comments / remarks — opens the rollup thread */}
              <div className="px-2 py-1 flex items-center">
                <LatestCommentButton
                  latest={taskLatest}
                  onClick={() => setShowComments(true)}
                />
              </div>
              {/* Inline expand — same pattern as InitiativeCard in /programs.
                  Toggles the inline detail (watchers, team, subtasks). Title
                  click opens the wider sheet for the full-screen edit
                  surface. */}
              <button
                onClick={toggleExpand}
                className="px-2 py-1 flex items-center gap-1 text-xs text-steel hover:bg-mist hover:text-midnight transition-colors"
                title={expanded ? "Hide details" : "Show details"}
              >
                <span className="font-medium">
                  {localEnts.length > 0
                    ? `${localEnts.length} ${localEnts[0]?.entity_type === "client" ? "client" : "building"}${localEnts.length !== 1 ? "s" : ""}`
                    : flatTotal > 0
                    ? `${doneCount}/${flatTotal}`
                    : "Details"}
                </span>
                {expanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
              {/* Overflow menu — Archive / Restore / Delete. Kept OUTSIDE the
                  overflow-hidden group above so the dropdown isn't clipped. */}
              {(canDelete || isAdmin) && (
                <div ref={cardMenuRef} className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCardMenuOpen((v) => !v);
                  }}
                  disabled={deleting || archiving}
                  title="More actions"
                  aria-label="More actions"
                  aria-expanded={cardMenuOpen}
                  className="h-full px-2 rounded-md border border-pebble bg-white text-steel/60 hover:bg-mist hover:text-midnight flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {cardMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-pebble rounded-lg shadow-lg z-30 py-1 text-sm">
                    {isAdmin && isArchived && (
                      <button
                        type="button"
                        onClick={handleRestore}
                        disabled={archiving}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-midnight hover:bg-mist disabled:opacity-50"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                        {archiving ? "Restoring…" : "Restore task"}
                      </button>
                    )}
                    {isAdmin && !isArchived && (
                      <button
                        type="button"
                        onClick={handleArchive}
                        disabled={archiving || !canArchiveTask}
                        title={canArchiveTask ? "Archive this task" : "Only a completed (done) task can be archived"}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-midnight hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        {archiving ? "Archiving…" : "Archive task"}
                      </button>
                    )}
                    {canDelete && (
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
                    )}
                  </div>
                )}
              </div>
              )}
            </div>

            {/* Turnaround time — outside the action group; informational
                badge, not an action. Only visible once closed. */}
            <TatBadge createdAt={task.created_at} closedAt={task.closed_at} />
          </div>
        </div>
      </div>

      {/* Inline expand mirrors the InitiativeCard pattern: the row stays
          scannable; click chevron to expose team / watchers / subtasks /
          add-subtask. Title click opens the wider sheet for the full-screen
          edit surface — both paths share onChanged so state stays in sync. */}
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
                  isAdmin={isAdmin}
                  subtasks={grouped.by_entity[e.entity_id] ?? []}
                  subtasksLoading={loadingSubtasks}
                  onEntityUpdate={handleEntityUpdate}
                  onEntityRemoved={handleEntityRemoved}
                  onSubtasksChanged={loadSubtasksGrouped}
                  parentTask={task}
                  programName={programName}
                  programColor={programColor}
                  initiativeName={initiativeName}
                  onOpenSheet={onOpenSheet}
                />
              ))}
              {/* Attach another building/client — admin/owner only. */}
              {isAdmin && (
                <AddEntityInline
                  taskId={task.id}
                  entityType={(localEnts[0]?.entity_type as "building" | "client") ?? "building"}
                  existingIds={new Set(localEnts.map((e) => e.entity_id))}
                  onAdded={(ne) => setLocalEnts((prev) => [...prev, ne])}
                />
              )}
              {(archivedSubCount > 0 || showArchivedSubs) && (
                <ShowArchivedToggle
                  on={showArchivedSubs}
                  count={archivedSubCount}
                  onToggle={() => setShowArchivedSubs((v) => !v)}
                  label="archived attributes"
                />
              )}
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
                  isAdmin={isAdmin}
                  onChanged={loadSubtasksGrouped}
                  parentTask={task}
                  programName={programName}
                  programColor={programColor}
                  initiativeName={initiativeName}
                  onOpenSheet={onOpenSheet}
                  getChildren={(pid) => flatChildrenByParent[pid] ?? []}
                />
              ))}
              {flatTotal === 0 && !loadingSubtasks && (
                <p className="text-xs text-steel/50 py-1 italic">
                  No subtasks yet.
                </p>
              )}
              {(archivedSubCount > 0 || showArchivedSubs) && (
                <ShowArchivedToggle
                  on={showArchivedSubs}
                  count={archivedSubCount}
                  onToggle={() => setShowArchivedSubs((v) => !v)}
                  label="archived attributes"
                />
              )}
              {/* Adding attributes is admin/owner only. */}
              {isAdmin && (showAddSubtask ? (
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
              ))}
            </>
          )}
        </div>
      )}

      {showComments && (
        <CommentsPopup
          apiPath={`/api/v1/tasks/${task.id}/comments`}
          title={task.title}
          includeDescendants
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
  // Mandatory task span (057) — prefill from the initiative so the common case
  // is one click.
  const [startDate, setStartDate] = useState(initiative.start_date ?? "");
  const [dueDate, setDueDate] = useState(initiative.target_end_date ?? "");
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
    if (startDate && dueDate && dueDate < startDate) {
      setError("End date can't be before the start date.");
      return;
    }
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
          start_date: startDate,
          due_date: dueDate,
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

          {/* 5. Priority + Start + End */}
          <div className="grid grid-cols-3 gap-3">
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
                Start Date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
                End Date *
              </label>
              <input
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
                required
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
  const [startDate, setStartDate] = useState("");
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

  // Prefill the mandatory span from the chosen initiative (only while still
  // blank, so the user's own edits stick).
  useEffect(() => {
    if (!initiativeId) return;
    const init = initiatives.find((i) => i.id === initiativeId);
    if (!init) return;
    setStartDate((s) => s || init.start_date || "");
    setDueDate((d) => d || init.target_end_date || "");
  }, [initiativeId, initiatives]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (startDate && dueDate && dueDate < startDate) {
      setError("End date can't be before the start date.");
      return;
    }
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
          start_date: startDate,
          due_date: dueDate,
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
          <div className="grid grid-cols-3 gap-3">
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
                Start date *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">
                End date *
              </label>
              <input
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
                required
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
  archivedTasks,
  members,
  currentUserId,
  myRole,
  highlighted,
  collapsed,
  onSetCollapsed,
  onStatusChange,
  onTaskDeleted,
  onTaskArchived,
  onTaskRestored,
  onBreakdown,
  onGantt,
  onDelete,
  focusTaskId,
  focusSubtaskId,
  onOpenSheet,
  selectedIds,
  onToggleSelect,
}: {
  initiative: MyInitiative | null; // null = "Unlinked"
  tasks: Task[];
  // Archived tasks for this initiative — revealed behind the group's
  // "show archived" toggle.
  archivedTasks: Task[];
  members: Member[];
  currentUserId: string;
  myRole: string;
  highlighted: boolean;
  // Controlled collapse state — owned by the page so it can persist
  // expanded ids to localStorage and survive navigations.
  collapsed: boolean;
  onSetCollapsed: (next: boolean) => void;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onTaskDeleted: (taskId: string) => void;
  onTaskArchived: (taskId: string) => void;
  onTaskRestored: (taskId: string) => void;
  // Per-initiative actions, hoisted from the page so a single BreakdownModal/
  // GanttModal lives at page level. Null `initiative` means the "Unlinked"
  // group, where these callbacks aren't passed.
  onBreakdown?: () => void;
  onGantt?: () => void;
  onDelete?: () => void;
  focusTaskId?: string | null;
  focusSubtaskId?: string | null;
  // P3: bubble up sheet-open requests so the page owns the open scope.
  onOpenSheet?: (scope: SheetScope) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const containsFocus = !!focusTaskId && tasks.some((t) => t.id === focusTaskId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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
    if (containsFocus && collapsed) onSetCollapsed(false);
  }, [containsFocus, collapsed, onSetCollapsed]);

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
          onClick={() => onSetCollapsed(!collapsed)}
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
                onArchived={onTaskArchived}
                onRestored={onTaskRestored}
                focusTaskId={focusTaskId}
                focusSubtaskId={focusSubtaskId}
                programName={initiative?.programs?.name}
                programColor={initiative?.programs?.color}
                initiativeName={initiative?.name}
                onOpenSheet={onOpenSheet}
                selected={selectedIds?.has(task.id)}
                onToggleSelect={onToggleSelect}
              />
            ))
          )}

          {/* Archived tasks — revealed inline behind a toggle, each restorable. */}
          {(archivedTasks.length > 0 || showArchived) && (
            <div className="pt-1">
              <ShowArchivedToggle
                on={showArchived}
                count={archivedTasks.length}
                onToggle={() => setShowArchived((v) => !v)}
                label="archived tasks"
              />
              {showArchived && (
                <div className="mt-2 space-y-2.5">
                  {archivedTasks.length === 0 ? (
                    <p className="text-xs text-steel/50 italic py-1">
                      No archived tasks.
                    </p>
                  ) : (
                    archivedTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        members={members}
                        currentUserId={currentUserId}
                        myRole={myRole}
                        onStatusChange={onStatusChange}
                        onDelete={onTaskDeleted}
                        onArchived={onTaskArchived}
                        onRestored={onTaskRestored}
                        focusTaskId={focusTaskId}
                        focusSubtaskId={focusSubtaskId}
                        programName={initiative?.programs?.name}
                        programColor={initiative?.programs?.color}
                        initiativeName={initiative?.name}
                        onOpenSheet={onOpenSheet}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Board view (deck: "List / Board / Mine") ───────────────────────────────
const BOARD_COLUMNS = ["backlog", "todo", "in_progress", "pending_decision", "blocked", "reopened", "done"] as const;

function TaskBoard({
  tasks,
  onStatusChange,
  onOpenSheet,
}: {
  tasks: Task[];
  onStatusChange: (taskId: string, newStatus: string) => void;
  onOpenSheet: (scope: SheetScope) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const byStatus: Record<string, Task[]> = {};
  for (const c of BOARD_COLUMNS) byStatus[c] = [];
  for (const t of tasks) {
    const col = (BOARD_COLUMNS as readonly string[]).includes(t.status) ? t.status : "backlog";
    byStatus[col].push(t);
  }

  async function move(taskId: string, newStatus: string) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t || t.status === newStatus) return;
    try {
      await apiFetch(`/api/v1/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      onStatusChange(taskId, newStatus);
    } catch { /* silent — list reload corrects on next fetch */ }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {BOARD_COLUMNS.map((col) => (
        <div
          key={col}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col); }}
          onDragLeave={() => setOverCol((c) => (c === col ? null : c))}
          onDrop={(e) => { e.preventDefault(); if (dragId) move(dragId, col); setDragId(null); setOverCol(null); }}
          className={cn(
            "flex-shrink-0 w-[230px] rounded-xl border bg-mist/30 flex flex-col",
            overCol === col ? "border-taskora-red/50 bg-taskora-red/[0.03]" : "border-pebble",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-pebble/70">
            <span className="text-[12px] font-semibold text-midnight">{STATUS_LABELS[col] ?? col}</span>
            <span className="text-[11px] text-steel/70">{byStatus[col].length}</span>
          </div>
          <div className="p-2 space-y-2 min-h-[80px]">
            {byStatus[col].map((t) => (
              <div
                key={t.id}
                draggable
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => { setDragId(null); setOverCol(null); }}
                onClick={() => onOpenSheet({ kind: "task", task: t })}
                className={cn(
                  "rounded-lg border border-pebble bg-white px-2.5 py-2 cursor-pointer hover:border-steel/40 hover:shadow-sm transition-all",
                  dragId === t.id && "opacity-50",
                )}
              >
                <p className="text-[12.5px] text-midnight leading-snug line-clamp-2">{t.title}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", PRIORITY_BADGE[t.priority] ?? "bg-gray-100 text-gray-600")}>
                    {t.priority}
                  </span>
                  {t.due_date && (
                    <span className="text-[10.5px] text-steel">{new Date(t.due_date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  )}
                </div>
              </div>
            ))}
            {byStatus[col].length === 0 && (
              <p className="text-[11px] text-steel/50 text-center py-3">Drop here</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const PRIORITY_BADGE: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-sky-100 text-sky-700",
  high: "bg-amber-100 text-amber-700",
  urgent: "bg-red-100 text-red-700",
};

// ── Inner Page (needs useSearchParams) ────────────────────────────────────────

function TasksPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightInitiativeId = searchParams.get("initiative");
  const focusTaskId = searchParams.get("task");
  const focusSubtaskId = searchParams.get("subtask");

  const PAGE_SIZE = 20;

  const [tasks, setTasks] = useState<Task[]>([]);
  // Archived tasks across the workspace — loaded once and grouped per
  // initiative so each group's "show archived" toggle reveals its own.
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [initiatives, setInitiatives] = useState<MyInitiative[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [myRole, setMyRole] = useState("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);
  // ⌘K "New task" deep-link: /tasks?new=1 opens the create modal on arrival.
  useEffect(() => {
    if (searchParams.get("new")) setShowCreate(true);
  }, [searchParams]);
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
  // Initiative-group expand state, lifted from InitiativeGroup so the page
  // can persist it. `null` = pre-hydration; treat as "use defaults" while
  // loading so we don't briefly render every group collapsed.
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);
  const [autoExpandedOnce, setAutoExpandedOnce] = useState(false);
  // Per-initiative modals — owned by the page so any group can open them.
  const [breakdownFor, setBreakdownFor] = useState<MyInitiative | null>(null);
  const [ganttFor, setGanttFor] = useState<MyInitiative | null>(null);
  // P3: TaskDetailSheet — opens on title click, replaces inline-expand for
  // detail. Inline expand-children stays alongside this phase.
  const [sheetScope, setSheetScope] = useState<SheetScope | null>(null);
  // Bulk-select on Work: pick multiple tasks, then set status/priority in one go.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // List / Board view toggle (deck: "List / Board / Mine").
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const { toast } = useToast();

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
      // Scope to the active workspace (multi-workspace members otherwise
      // fall back to the user's "first" workspace by default).
      if (typeof window !== "undefined") {
        const bid = localStorage.getItem("business_id");
        if (bid) params.set("business_id", bid);
      }
      const page = await apiFetch(`/api/v1/tasks/my/page?${params.toString()}`);
      const items: Task[] = Array.isArray(page?.items) ? page.items : [];
      setTasks((prev) => (append ? [...prev, ...items] : items));
      setNextCursor(page?.next_cursor ?? null);
    },
    []
  );

  // Load every archived task in the workspace (cursor-walked). Archived
  // volume is small, so a full walk is cheap and lets each initiative group
  // reveal its own archived tasks instantly when toggled.
  const loadArchivedTasks = useCallback(async () => {
    const bid =
      typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
    const all: Task[] = [];
    let cursor: string | null = null;
    try {
      // Guard the loop so a bad cursor can never spin forever.
      for (let i = 0; i < 50; i++) {
        const params = new URLSearchParams({
          limit: "100",
          archived_only: "true",
        });
        if (bid) params.set("business_id", bid);
        if (cursor) params.set("cursor", cursor);
        const page = await apiFetch(`/api/v1/tasks/my/page?${params.toString()}`);
        const items: Task[] = Array.isArray(page?.items) ? page.items : [];
        all.push(...items);
        cursor = page?.next_cursor ?? null;
        if (!cursor) break;
      }
      setArchivedTasks(all);
    } catch {
      /* non-blocking — archived view just stays empty */
    }
  }, []);

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
      // /businesses/my honours the cached preference; /initiatives/my needs
      // the workspace id explicitly so multi-workspace members see the
      // right list.
      const cachedBid =
        typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
      const initQ = cachedBid
        ? `/api/v1/initiatives/my?business_id=${encodeURIComponent(cachedBid)}`
        : "/api/v1/initiatives/my";
      const myBizQ = cachedBid
        ? `/api/v1/businesses/my?prefer=${encodeURIComponent(cachedBid)}`
        : "/api/v1/businesses/my";
      const [biz, , initData] = await Promise.all([
        apiFetch(myBizQ),
        fetchTaskPage(filter, null, false),
        apiFetch(initQ),
      ]);

      setInitiatives(Array.isArray(initData) ? initData : []);
      // Archived tasks load in the background — they only render behind the
      // per-initiative "show archived" toggle, so they never block the page.
      loadArchivedTasks();
      if (biz?.id) {
        setBusinessId(biz.id);
        // Members and role are non-blocking — and INDEPENDENT: a failing
        // /members request must not drop the role (which gates delete/archive
        // affordances for owners/admins).
        apiFetch(`/api/v1/businesses/${biz.id}/members`)
          .then((memberData: any) =>
            setMembers(
              Array.isArray(memberData)
                ? memberData.filter((m: Member) => m.user_id !== userId)
                : []
            )
          )
          .catch(() => {});
        apiFetch(`/api/v1/businesses/${biz.id}/my-role`)
          .then((roleData: any) => { if (roleData?.role) setMyRole(roleData.role); })
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
  }, [filter, fetchTaskPage, loadArchivedTasks, router]);

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

  // Hydrate expanded-group state from localStorage. If there's no entry
  // yet (first-ever visit), leave the Set empty — the auto-expand effect
  // below will pick the first non-empty group once data arrives.
  useEffect(() => {
    let initial: Set<string> = new Set();
    try {
      const raw = localStorage.getItem(TASKS_EXPANDED_GROUPS_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          initial = new Set(arr.filter((x): x is string => typeof x === "string"));
        }
      }
    } catch {
      /* corrupted storage — fall through with empty set */
    }
    setExpandedGroups(initial);
  }, []);

  useEffect(() => {
    if (expandedGroups === null) return;
    try {
      localStorage.setItem(
        TASKS_EXPANDED_GROUPS_KEY,
        JSON.stringify(Array.from(expandedGroups)),
      );
    } catch {
      /* quota or storage disabled — silently ignore */
    }
  }, [expandedGroups]);

  // Deep-link `?initiative=X` always wins over saved state — if the user
  // arrived from a notification or link, that group must open.
  useEffect(() => {
    if (!highlightInitiativeId) return;
    setExpandedGroups((prev) => {
      const base = prev ?? new Set<string>();
      if (base.has(highlightInitiativeId)) return base;
      const next = new Set(base);
      next.add(highlightInitiativeId);
      return next;
    });
  }, [highlightInitiativeId]);

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
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyBulk(field: "status" | "priority", value: string) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || !value) return;
    setBulkBusy(true);
    try {
      const res = await apiFetch("/api/v1/tasks/bulk-update", {
        method: "POST",
        body: JSON.stringify({ task_ids: ids, [field]: value }),
      });
      // Optimistic local apply (mirrors handleStatusChange).
      setTasks((prev) =>
        prev.map((t) =>
          ids.includes(t.id)
            ? {
                ...t,
                [field]: value,
                ...(field === "status"
                  ? { closed_at: value === "done" ? t.closed_at ?? new Date().toISOString() : null }
                  : {}),
              }
            : t,
        ),
      );
      const n = (res as { updated_count?: number })?.updated_count ?? ids.length;
      setSelectedIds(new Set());
      toast({ title: `Updated ${n} task${n === 1 ? "" : "s"}` });
    } catch (e: any) {
      toast({ title: "Bulk update failed", description: e?.message, variant: "error" });
    } finally {
      setBulkBusy(false);
    }
  }

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
    setArchivedTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  // Archived: drop from the active list and refresh the archived set so the
  // task reappears under its initiative's "show archived" view.
  function handleTaskArchived(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    loadArchivedTasks();
    // Universal undo: archiving is reversible, so offer a one-tap restore.
    toast({
      title: "Task archived",
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            await apiFetch(`/api/v1/tasks/${taskId}/restore`, { method: "POST" });
            handleTaskRestored(taskId);
          } catch { /* ignore */ }
        },
      },
    });
  }

  // Restored: drop from the archived set and refetch the active page so it
  // reappears in the live list.
  function handleTaskRestored(taskId: string) {
    setArchivedTasks((prev) => prev.filter((t) => t.id !== taskId));
    fetchTaskPage(filter, null, false);
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
    }).map((t) =>
      // #6: stamp each task with its initiative's target end so any due-date
      // render can flag dates that fall beyond it.
      t.initiative_id && initiativeMap[t.initiative_id]?.target_end_date
        ? { ...t, initiative_target_end_date: initiativeMap[t.initiative_id]!.target_end_date }
        : t
    );
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

  // Archived tasks grouped the same way — revealed per initiative behind the
  // group's "show archived" toggle. Not subject to the active-list status
  // filter (they're all done) but mirror it for unlinked.
  const archivedByInitiative: Record<string, Task[]> = {};
  const unlinkedArchived: Task[] = [];
  for (const task of archivedTasks) {
    if (task.initiative_id) {
      (archivedByInitiative[task.initiative_id] ??= []).push(task);
    } else {
      unlinkedArchived.push(task);
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

  // Auto-expand the first non-empty group on first arrival so the page
  // doesn't read empty when every group is collapsed. Runs once per session
  // after data + hydration are ready, and only if nothing is already open.
  useEffect(() => {
    if (autoExpandedOnce) return;
    if (loading) return;
    if (expandedGroups === null) return;
    if (expandedGroups.size > 0) return;
    if (displayInitiativeIds.length === 0) return;
    const firstWithTasks = displayInitiativeIds.find(
      (id) => (tasksByInitiative[id] ?? []).length > 0,
    );
    if (firstWithTasks) {
      setExpandedGroups(new Set([firstWithTasks]));
    }
    setAutoExpandedOnce(true);
  }, [
    autoExpandedOnce,
    loading,
    expandedGroups,
    displayInitiativeIds,
    tasksByInitiative,
  ]);

  const setGroupCollapsed = useCallback((id: string, collapsed: boolean) => {
    setExpandedGroups((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (collapsed) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const activeFilterCount =
    (programFilter ? 1 : 0) +
    (ownerFilter !== "__me__" && ownerFilter !== "" ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10 animate-fade-up">
      <PageHeader
        eyebrow="Workspace"
        title="My Work"
        description="Active initiatives and the tasks driving them forward."
        className="mb-6"
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowCreate(true)}
            iconLeft={<Plus className="h-4 w-4" strokeWidth={2} />}
          >
            New task
          </Button>
        }
      />

      {/* Filter toolbar: search + program + owner + clear. */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search aria-hidden="true" className="h-4 w-4 text-fg-subtle absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" strokeWidth={1.8} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            autoComplete="off"
            spellCheck={false}
            className="w-full h-9 pl-9 pr-3 bg-surface border border-line rounded-md text-[13px] text-fg placeholder:text-fg-subtle focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 transition-colors duration-fast"
          />
        </div>
        <FilterSelect
          value={programFilter}
          onChange={setProgramFilter}
          label="Filter by program"
          placeholder="All programs"
          options={programs.map((p) => ({ value: p.id, label: p.name }))}
        />
        {isAdmin ? (
          <FilterSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            label="Filter by primary owner"
            options={[
              { value: "__me__", label: "Owner: Me" },
              { value: "", label: "Anyone" },
              ...members.map((m) => ({ value: m.user_id, label: m.name || m.email || "" })),
            ]}
          />
        ) : (
          <div
            className="h-9 px-3 border border-line rounded-md text-[13px] bg-muted/60 flex items-center gap-2 text-fg-subtle cursor-not-allowed select-none"
            title="Only admins and owners can filter by other people"
            aria-disabled
          >
            <User className="h-3.5 w-3.5" strokeWidth={1.8} />
            Me
          </div>
        )}
        {activeFilterCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSearch("");
              setProgramFilter("");
              setOwnerFilter("__me__");
            }}
            iconLeft={<X className="h-3.5 w-3.5" strokeWidth={1.8} />}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Status filter tabs + List/Board toggle */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
      <div role="tablist" aria-label="Status filter" className="flex gap-1.5 flex-wrap p-0.5 bg-muted rounded-lg w-fit">
        {STATUSES.map((s) => {
          const active = filter === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                active
                  ? "bg-surface text-fg shadow-xs"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {FILTER_LABELS[s] ?? s}
            </button>
          );
        })}
      </div>
        <div className="inline-flex p-0.5 bg-muted rounded-lg">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewMode(v)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[12px] font-semibold capitalize transition-all duration-fast",
                viewMode === v ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / error states */}
      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="surface-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <Skeleton className="h-3 w-3 rounded" />
                <Skeleton className="h-3.5 w-2/5" />
              </div>
              <div className="space-y-2 pl-6">
                {[...Array(2)].map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded-sm" />
                    <Skeleton className="h-3 w-3/5" />
                    <Skeleton className="ml-auto h-5 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="surface-card p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-danger-700">{error}</p>
          <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
        </div>
      )}

      {!loading &&
        !error &&
        displayInitiativeIds.length === 0 &&
        unlinkedTasks.length === 0 && (
          <div className="surface-card">
            <EmptyState
              icon={<Inbox className="h-6 w-6" strokeWidth={1.6} />}
              title={
                activeFilterCount > 0
                  ? "No matches for these filters"
                  : "Nothing on your plate"
              }
              description={
                activeFilterCount > 0
                  ? "Try clearing a filter, or broaden the search."
                  : "When you create or get assigned to a task, it lands here."
              }
              primary={
                activeFilterCount > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    iconLeft={<X className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    onClick={() => {
                      setSearch("");
                      setProgramFilter("");
                      setOwnerFilter("__me__");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    size="md"
                    variant="primary"
                    iconLeft={<Plus className="h-4 w-4" strokeWidth={2} />}
                    onClick={() => setShowCreate(true)}
                  >
                    New task
                  </Button>
                )
              }
            />
          </div>
        )}

        {/* Board view */}
        {!loading && !error && viewMode === "board" &&
          (displayInitiativeIds.length > 0 || unlinkedTasks.length > 0) && (
            <TaskBoard
              tasks={[...Object.values(tasksByInitiative).flat(), ...unlinkedTasks]}
              onStatusChange={handleStatusChange}
              onOpenSheet={setSheetScope}
            />
          )}

        {/* Grouped tasks (list view) */}
        {!loading &&
          !error &&
          viewMode === "list" &&
          (displayInitiativeIds.length > 0 || unlinkedTasks.length > 0) && (
          <div className="space-y-3">
            {/* Bulk action bar — appears once tasks are selected. */}
            {selectedIds.size > 0 && (
              <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-pebble bg-white shadow-lg px-3 py-2">
                <span className="text-[13px] font-semibold text-midnight">
                  {selectedIds.size} selected
                </span>
                <span className="mx-1 h-4 w-px bg-pebble" />
                <label className="text-[11px] text-steel">Set status</label>
                <select
                  defaultValue=""
                  disabled={bulkBusy}
                  onChange={(e) => { if (e.target.value) { applyBulk("status", e.target.value); e.target.value = ""; } }}
                  className="border border-pebble rounded px-2 py-1 text-[12.5px] focus:outline-none focus:border-ocean"
                >
                  <option value="">—</option>
                  {TASK_STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
                  ))}
                </select>
                <label className="text-[11px] text-steel ml-1">Set priority</label>
                <select
                  defaultValue=""
                  disabled={bulkBusy}
                  onChange={(e) => { if (e.target.value) { applyBulk("priority", e.target.value); e.target.value = ""; } }}
                  className="border border-pebble rounded px-2 py-1 text-[12.5px] focus:outline-none focus:border-ocean"
                >
                  <option value="">—</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkBusy}
                  className="ml-auto text-[12px] text-steel hover:text-midnight"
                >
                  Clear
                </button>
              </div>
            )}
            {/* Initiative groups — includes empty initiatives that match
                the program/owner filter, so e.g. "Owner: Hitesh" still
                shows his initiatives even if no tasks have been created. */}
            {displayInitiativeIds.map((initId) => {
              const init = initiativeMap[initId] ?? null;
              const isCollapsed = expandedGroups
                ? !expandedGroups.has(initId)
                : true;
              return (
                <InitiativeGroup
                  key={initId}
                  initiative={init}
                  tasks={tasksByInitiative[initId] ?? []}
                  archivedTasks={archivedByInitiative[initId] ?? []}
                  members={members}
                  currentUserId={currentUserId}
                  myRole={myRole}
                  highlighted={highlightInitiativeId === initId}
                  collapsed={isCollapsed}
                  onSetCollapsed={(next) => setGroupCollapsed(initId, next)}
                  onStatusChange={handleStatusChange}
                  onTaskDeleted={handleTaskDelete}
                  onTaskArchived={handleTaskArchived}
                  onTaskRestored={handleTaskRestored}
                  onBreakdown={init ? () => setBreakdownFor(init) : undefined}
                  onGantt={init ? () => setGanttFor(init) : undefined}
                  onDelete={
                    init ? () => handleDeleteInitiative(init) : undefined
                  }
                  focusTaskId={focusTaskId}
                  focusSubtaskId={focusSubtaskId}
                  onOpenSheet={setSheetScope}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
              );
            })}

            {/* Unlinked tasks group */}
            {unlinkedTasks.length > 0 && (
              <InitiativeGroup
                key="unlinked"
                initiative={null}
                tasks={unlinkedTasks}
                archivedTasks={unlinkedArchived}
                members={members}
                currentUserId={currentUserId}
                myRole={myRole}
                highlighted={false}
                collapsed={expandedGroups ? !expandedGroups.has("__unlinked__") : true}
                onSetCollapsed={(next) => setGroupCollapsed("__unlinked__", next)}
                onStatusChange={handleStatusChange}
                onTaskDeleted={handleTaskDelete}
                onTaskArchived={handleTaskArchived}
                onTaskRestored={handleTaskRestored}
                focusTaskId={focusTaskId}
                focusSubtaskId={focusSubtaskId}
                onOpenSheet={setSheetScope}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
              />
            )}

            {/* B5: Load more — visible only when the server says there are more pages */}
            {nextCursor && (
              <div className="flex justify-center pt-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={loadMore}
                  loading={loadingMore}
                  iconLeft={!loadingMore ? <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} /> : undefined}
                >
                  {loadingMore ? "Loading" : "Load more"}
                </Button>
              </div>
            )}
          </div>
        )}

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

      {/* P3: TaskDetailSheet — opens on row title click. Single instance per
          page; replacing scope swaps the contents. */}
      <TaskDetailSheet
        scope={sheetScope}
        members={members}
        currentUserId={currentUserId}
        myRole={myRole}
        onClose={() => setSheetScope(null)}
        onChanged={() => {
          // Refetch the current page so row state matches sheet edits.
          fetchTaskPage(filter, null, false);
        }}
        onNavigate={setSheetScope}
      />
    </div>
  );
}

// ── TaskDetailSheet (P3) ──────────────────────────────────────────────────────
// Right-edge slide-over panel that renders the full detail of one Task,
// Subtask, or Sub-subtask. Opens when the row's title is clicked. The inline
// expand-children chevron still works independently — this sheet replaces
// only the *detail* surface, not the children tree. See feedback-no-big-
// rewrites: ships *alongside* the inline expanded section; that section is
// cut in a follow-up phase after browser verification.

type SheetScope =
  | {
      kind: "task";
      task: Task;
      programName?: string;
      programColor?: string;
      initiativeName?: string;
    }
  | {
      kind: "subtask";
      subtask: Subtask;
      task: Task;
      programName?: string;
      programColor?: string;
      initiativeName?: string;
    };

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

// ── Task dependencies / prerequisites ──────────────────────────────────────
function TaskDependencies({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [deps, setDeps] = useState<{ id: string; title: string; status?: string }[]>([]);
  const [blocks, setBlocks] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/v1/tasks/${taskId}/dependencies`);
      setDeps(d?.depends_on ?? []);
      setBlocks(d?.depended_on_by ?? []);
    } catch { /* leave as-is */ }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!open) { setResults([]); return; }
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    if (!bid || q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const d = await apiFetch(`/api/v1/mentions/search?business_id=${encodeURIComponent(bid)}&q=${encodeURIComponent(q)}`);
        const tasks = (d?.results ?? [])
          .filter((r: { type: string }) => r.type === "task")
          .map((r: { id: string; label: string }) => ({ id: r.id.split(":")[1], label: r.label }))
          .filter((r: { id: string }) => r.id !== taskId && !deps.some((dp) => dp.id === r.id));
        setResults(tasks);
      } catch { setResults([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open, taskId, deps]);

  async function save(next: string[]) {
    setBusy(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/dependencies`, {
        method: "PATCH", body: JSON.stringify({ depends_on: next }),
      });
      await load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-steel mb-1">Depends on (prerequisites)</label>
      <div className="flex flex-wrap items-center gap-1.5">
        {deps.length === 0 && <span className="text-[12px] text-steel/60">No prerequisites.</span>}
        {deps.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1 text-[12px] bg-mist border border-pebble rounded-full px-2 py-0.5 text-midnight">
            {d.title}
            {canEdit && (
              <button type="button" disabled={busy} onClick={() => save(deps.filter((x) => x.id !== d.id).map((x) => x.id))}
                className="text-steel hover:text-red-600 leading-none">×</button>
            )}
          </span>
        ))}
        {canEdit && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12px] text-taskora-red font-semibold">+ Add</button>
        )}
      </div>
      {open && canEdit && (
        <div className="mt-1.5">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks to depend on…"
            className="w-full border border-pebble rounded px-2 py-1.5 text-sm focus:outline-none focus:border-ocean" />
          {results.length > 0 && (
            <div className="mt-1 border border-pebble rounded-lg max-h-40 overflow-y-auto bg-white">
              {results.map((r) => (
                <button key={r.id} type="button" disabled={busy}
                  onClick={() => { save([...deps.map((d) => d.id), r.id]); setQ(""); setOpen(false); }}
                  className="w-full text-left px-2.5 py-1.5 text-[13px] text-midnight hover:bg-mist">{r.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {blocks.length > 0 && (
        <p className="mt-1.5 text-[11px] text-steel/70">
          Blocks: {blocks.map((b) => b.title).join(", ")}
        </p>
      )}
    </div>
  );
}

// ── Task file attachments ───────────────────────────────────────────────────
function TaskAttachments({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<{ id: string; file_name: string; file_size_bytes?: number | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/v1/tasks/${taskId}/attachments`);
      setFiles(Array.isArray(d) ? d : []);
    } catch { /* leave */ }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setBusy(true); setErr("");
    try {
      // 1) signed upload URL from the backend (tenant-prefixed path).
      const sign = await apiFetch(`/api/v1/tasks/${taskId}/attachments/sign`, {
        method: "POST",
        body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/octet-stream" }),
      });
      if (file.size > (sign.max_bytes ?? 26214400)) throw new Error("File is too large (max 25 MB).");
      // 2) upload the bytes straight to Supabase Storage.
      const { error: upErr } = await supabase.storage
        .from(sign.bucket)
        .uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      // 3) record the attachment row.
      await apiFetch(`/api/v1/tasks/${taskId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ path: sign.path, file_name: file.name, file_size_bytes: file.size }),
      });
      await load();
    } catch (e: any) {
      setErr(e?.message || "Couldn’t upload that file.");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    try { await apiFetch(`/api/v1/tasks/${taskId}/attachments/${id}`, { method: "DELETE" }); } catch { load(); }
  }

  async function openFile(id: string) {
    try {
      const d = await apiFetch(`/api/v1/tasks/${taskId}/attachments/${id}/url`);
      if (d?.url) window.open(d.url, "_blank", "noopener");
    } catch { /* ignore */ }
  }

  return (
    <div>
      <label className="block text-[11px] font-medium text-steel mb-1">Attachments</label>
      <div className="space-y-1">
        {files.length === 0 && <span className="text-[12px] text-steel/60">No files attached.</span>}
        {files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 text-[12.5px]">
            <button type="button" onClick={() => openFile(f.id)} className="text-ocean hover:underline truncate">{f.file_name}</button>
            {canEdit && (
              <button type="button" onClick={() => remove(f.id)} className="ml-auto text-steel hover:text-red-600">Remove</button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <label className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-taskora-red font-semibold cursor-pointer">
          {busy ? "Uploading…" : "+ Attach file"}
          <input type="file" disabled={busy} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.currentTarget.value = ""; }} />
        </label>
      )}
      {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
    </div>
  );
}

/**
 * Task Workspace doc — the full plan/notes canvas on a task (deck's marquee
 * "Task Workspace" screen). Reuses the initiative WorkDocPanel pointed at the
 * task-scoped doc endpoints; backlinks/promote disabled (task scope).
 */
function TaskWorkspaceDoc({ taskId, taskTitle }: { taskId: string; taskTitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className="block text-[11px] font-medium text-steel mb-1">Workspace doc</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-ocean hover:underline"
      >
        <FileText className="h-3.5 w-3.5" /> Open the plan, notes &amp; files
      </button>
      {open && (
        <WorkDocPanel
          initiativeId={taskId}
          initiativeName={taskTitle}
          onClose={() => setOpen(false)}
          docsBasePath={`/api/v1/tasks/${taskId}/docs`}
          headerName={taskTitle}
          headerSub="Task workspace"
          backlinksPath={null}
          promotePath={null}
        />
      )}
    </div>
  );
}

function TaskDetailSheet({
  scope,
  members,
  currentUserId,
  myRole,
  onClose,
  onChanged,
  onNavigate,
}: {
  scope: SheetScope | null;
  members: Member[];
  currentUserId: string;
  myRole: string;
  onClose: () => void;
  onChanged: () => void;
  // Click a subtask inside the sheet to drill in without closing.
  onNavigate?: (next: SheetScope) => void;
}) {
  // Local field state seeded from the open scope. When `scope` changes, reset.
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [statusVal, setStatusVal] = useState("");
  const [blockerReason, setBlockerReason] = useState("");
  const [blockedOnId, setBlockedOnId] = useState<string | null>(null);
  const [priority, setPriority] = useState("medium");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  // Task stakeholders mirror the row's canManageWatchers gate — without this,
  // a secondary stakeholder opening the sheet would see disabled inputs even
  // though they CAN edit from the row. Loaded once per sheet open.
  const [stakeholderIds, setStakeholderIds] = useState<Set<string>>(new Set());
  // Subtree (children of the current scope) — rendered inline in the sheet
  // so users don't bounce between the row's inline-expand and the sheet.
  const [children, setChildren] = useState<Subtask[]>([]);
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [showAddChild, setShowAddChild] = useState(false);
  const [showComments, setShowComments] = useState(false);
  // Local approval state so the Approve/Reject controls inside the sheet
  // can react instantly without waiting for the parent refetch.
  const [approvalState, setApprovalState] = useState<string | undefined>();

  // Esc to close. Click on backdrop also closes (handled below).
  useEffect(() => {
    if (!scope) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scope, onClose]);

  // Seed fields when the open scope changes.
  useEffect(() => {
    if (!scope) return;
    if (scope.kind === "task") {
      setTitle(scope.task.title);
      setStatusVal(scope.task.status);
      setBlockerReason((scope.task as { blocker_reason?: string | null }).blocker_reason ?? "");
      setBlockedOnId(scope.task.blocked_on_user_id ?? null);
      setPriority(scope.task.priority || "medium");
      setStartDate(scope.task.start_date ?? "");
      setDueDate(scope.task.due_date ?? "");
      setDescription("");
      setAssigneeId(scope.task.primary_stakeholder_id ?? null);
      setApprovalState(scope.task.approval_state);
    } else {
      setTitle(scope.subtask.title);
      setStatusVal(scope.subtask.status);
      setBlockerReason((scope.subtask as { blocker_reason?: string | null }).blocker_reason ?? "");
      setBlockedOnId(null);
      setPriority((scope.subtask.priority ?? "medium") as string);
      setStartDate(scope.subtask.start_date ?? "");
      setDueDate(scope.subtask.due_date ?? "");
      setDescription(scope.subtask.description ?? "");
      setAssigneeId(scope.subtask.assignee_id ?? null);
      setApprovalState(scope.subtask.approval_state);
    }
    setErr("");
  }, [scope]);

  // Pull stakeholders for the canEdit gate (same shape as the row).
  useEffect(() => {
    if (!scope) return;
    const tid = scope.task.id;
    apiFetch(`/api/v1/tasks/${tid}/stakeholders`)
      .then((rows: any) => {
        if (!Array.isArray(rows)) return setStakeholderIds(new Set());
        setStakeholderIds(new Set(rows.map((r: any) => r.user_id)));
      })
      .catch(() => setStakeholderIds(new Set()));
  }, [scope]);

  // Pull the latest watchers for this scope (the row may have a stale snapshot).
  useEffect(() => {
    if (!scope) return;
    const taskId = scope.kind === "task" ? scope.task.id : scope.task.id;
    apiFetch(`/api/v1/tasks/${taskId}/watchers`)
      .then((all: any) => {
        if (!Array.isArray(all)) return setWatchers([]);
        if (scope.kind === "task") {
          setWatchers(all.filter((w: Watcher) => w.scope_type === "task"));
        } else {
          setWatchers(
            all.filter(
              (w: Watcher) =>
                w.scope_type === "subtask" && w.subtask_id === scope.subtask.id
            )
          );
        }
      })
      .catch(() => setWatchers([]));
  }, [scope]);

  // Load children (subtasks for a task; sub-subtasks for a subtask). Uses the
  // existing grouped endpoint so the row's data stays in sync — saving here
  // also calls onChanged() which refetches the row.
  const loadChildren = useCallback(async () => {
    if (!scope) return;
    setChildrenLoading(true);
    try {
      const data = await apiFetch(
        `/api/v1/tasks/${scope.task.id}/subtasks-grouped`,
      );
      const all: Subtask[] = [
        ...(data?.task_flat ?? []),
        ...Object.values(data?.by_entity ?? {}).flat() as Subtask[],
      ];
      if (scope.kind === "task") {
        // Show only top-level subtasks; sub-subtasks belong to a subtask scope.
        setChildren(all.filter((s) => !s.parent_subtask_id));
      } else {
        setChildren(
          all.filter((s) => s.parent_subtask_id === scope.subtask.id),
        );
      }
    } catch {
      setChildren([]);
    } finally {
      setChildrenLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    if (!scope) return;
    setShowAddChild(false);
    setShowComments(false);
    loadChildren();
  }, [scope, loadChildren]);

  if (!scope) return null;

  const isTask = scope.kind === "task";
  const taskId = scope.task.id;
  const subtaskId = isTask ? null : scope.subtask.id;
  const apiPath = isTask
    ? `/api/v1/tasks/${taskId}`
    : `/api/v1/tasks/${taskId}/subtasks/${subtaskId}`;

  const isPrivileged = myRole === "owner" || myRole === "admin";
  // Mirror SubtaskRow/TaskCard canManageWatchers: primary | task-stakeholder
  // | workspace owner/admin. Without the stakeholder branch a secondary
  // stakeholder couldn't edit in the sheet though they can from the row.
  const canEdit =
    isPrivileged ||
    scope.task.primary_stakeholder_id === currentUserId ||
    stakeholderIds.has(currentUserId);

  const watcherScope: WatcherScope = isTask
    ? { scope_type: "task" }
    : { scope_type: "subtask", subtask_id: subtaskId! };

  async function save() {
    const sc = scope;
    if (!sc) return;
    if (!title.trim()) {
      setErr("Title required");
      return;
    }
    // Dates are optional (068) — undated items land in the Roadmap tray.
    if (startDate && dueDate && dueDate < startDate) {
      setErr("End date can't be before the start date.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      // Backend respects explicit null (model_fields_set). Single PATCH for
      // both tasks and subtasks — update_task handles closure + approval
      // transitions on status change, so no second /status call is needed.
      const payload: Record<string, any> = {
        title: title.trim(),
        priority,
        description: description || null,
        status: statusVal,
      };
      // Capture why it's blocked (feeds Nudges + the blocked notification).
      if (statusVal === "blocked") payload.blocker_reason = blockerReason.trim() || null;
      if (isTask && statusVal === "blocked") payload.blocked_on_user_id = blockedOnId || null;
      // Dates optional everywhere now (068) — empty clears to null.
      payload.start_date = startDate || null;
      payload.due_date = dueDate || null;
      if (!isTask) payload.assignee_id = assigneeId;
      await apiFetch(apiPath, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onChanged();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const breadcrumb: string[] = [];
  if (scope.programName) breadcrumb.push(scope.programName);
  if (scope.initiativeName) breadcrumb.push(scope.initiativeName);
  if (!isTask) breadcrumb.push(scope.task.title);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Task details"
        className="fixed right-0 top-0 z-50 h-full w-full max-w-[560px] bg-white shadow-2xl border-l border-pebble flex flex-col"
      >
        <header className="flex items-start justify-between gap-3 p-4 border-b border-pebble">
          <div className="min-w-0 flex-1">
            {breadcrumb.length > 0 && (
              <p className="text-[11px] text-steel truncate">
                {breadcrumb.map((b, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1 text-steel/40">›</span>}
                    {b}
                  </span>
                ))}
              </p>
            )}
            <p className="text-[10px] uppercase tracking-wide text-steel/60 mt-1">
              {isTask ? "Task" : scope.subtask.parent_subtask_id ? "Sub-subtask" : "Subtask"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-steel hover:text-midnight"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-steel mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEdit || saving}
              className="w-full border border-pebble rounded px-3 py-1.5 text-sm text-midnight focus:outline-none focus:border-ocean disabled:bg-mist/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-steel mb-1">Status</label>
              <Select
                value={statusVal}
                onChange={setStatusVal}
                disabled={!canEdit || saving}
                className="w-full"
                options={(isTask ? TASK_STATUS_ORDER : SUBTASK_STATUS_ORDER).map((s) => ({ value: s, label: STATUS_LABELS[s] ?? s }))}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-steel mb-1">Priority</label>
              <Select
                value={priority}
                onChange={setPriority}
                disabled={!canEdit || saving}
                className="w-full"
                options={PRIORITY_OPTIONS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
              />
            </div>

            {statusVal === "blocked" && (
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-steel mb-1">Why is this blocked?</label>
                <input
                  type="text"
                  value={blockerReason}
                  onChange={(e) => setBlockerReason(e.target.value)}
                  disabled={!canEdit || saving}
                  placeholder="e.g. waiting on vendor lead time (3 wks)"
                  className="w-full border border-pebble rounded px-3 py-1.5 text-sm text-midnight focus:outline-none focus:border-ocean disabled:bg-mist/40"
                />
                {isTask && (
                  <div className="mt-2">
                    <label className="block text-[11px] font-medium text-steel mb-1">Blocked on (who can unblock)</label>
                    <Select
                      value={blockedOnId ?? ""}
                      onChange={(v) => setBlockedOnId(v || null)}
                      disabled={!canEdit || saving}
                      className="w-full"
                      options={[{ value: "", label: "— Nobody specific —" }, ...members.map((m) => ({ value: m.user_id, label: m.name || m.email || "Member" }))]}
                    />
                  </div>
                )}
                <p className="text-[10.5px] text-steel/60 mt-1">
                  Shows in Nudges and notifies watchers, the initiative owner{isTask ? " and the person it's blocked on" : ""}.
                </p>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-steel mb-1">
                Start date
              </label>
              <DatePicker
                value={startDate || null}
                onChange={(v) => setStartDate(v ?? "")}
                disabled={!canEdit || saving}
                clearable
                className="w-full"
                placeholder="No date"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-steel mb-1">
                End date
              </label>
              <DatePicker
                value={dueDate || null}
                onChange={(v) => setDueDate(v ?? "")}
                min={startDate || null}
                disabled={!canEdit || saving}
                clearable
                className="w-full"
                placeholder="No date"
              />
            </div>

            {!isTask && (
              <div>
                <label className="block text-[11px] font-medium text-steel mb-1">Assignee</label>
                <Select
                  value={assigneeId ?? ""}
                  onChange={(v) => setAssigneeId(v || null)}
                  disabled={!canEdit || saving}
                  className="w-full"
                  options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.user_id, label: m.name || m.email || "Member" }))]}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-steel mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit || saving}
              rows={4}
              placeholder={isTask ? "Add a description for this task" : "Add a description for this subtask"}
              className="w-full border border-pebble rounded px-3 py-2 text-sm text-midnight focus:outline-none focus:border-ocean disabled:bg-mist/40"
            />
          </div>

          {isTask && <TaskDependencies taskId={scope.task.id} canEdit={canEdit} />}
          {isTask && <TaskAttachments taskId={scope.task.id} canEdit={canEdit} />}
          {isTask && <TaskWorkspaceDoc taskId={scope.task.id} taskTitle={scope.task.title} />}

          {/* ── Approval controls (only show when approval matters) ── */}
          {(() => {
            // Approver = explicit own-scope (non-inherited) approver row.
            const isApprover = watchers.some(
              (w) =>
                w.role === "approver" &&
                w.user_id === currentUserId &&
                !w.inherited_from,
            );
            const hasApprover = watchers.some(
              (w) => w.role === "approver" && !w.inherited_from,
            );
            // Show the strip whenever there's an approver or an approval has
            // already happened — otherwise the section is noise.
            const visible =
              hasApprover ||
              approvalState === "pending" ||
              approvalState === "approved" ||
              approvalState === "rejected";
            if (!visible) return null;
            return (
              <div>
                <label className="block text-[11px] font-medium text-steel mb-1">
                  Approval
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <ApprovalControls
                    taskId={taskId}
                    scope={watcherScope}
                    approvalState={approvalState}
                    isApprover={isApprover}
                    onActed={(action) => {
                      if (action === "approve") setApprovalState("approved");
                      else setApprovalState("rejected");
                      onChanged();
                    }}
                    onOpenThread={() => setShowComments(true)}
                  />
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-[11px] font-medium text-steel mb-1">Watchers</label>
            <WatcherStrip
              taskId={taskId}
              scope={watcherScope}
              watchers={watchers}
              members={members}
              canManage={canEdit}
              onChanged={() => {
                // Refresh local watcher list then bubble up so the row also updates.
                apiFetch(`/api/v1/tasks/${taskId}/watchers`).then((all: any) => {
                  if (!Array.isArray(all)) return;
                  setWatchers(
                    isTask
                      ? all.filter((w: Watcher) => w.scope_type === "task")
                      : all.filter(
                          (w: Watcher) =>
                            w.scope_type === "subtask" && w.subtask_id === subtaskId
                        )
                  );
                });
                onChanged();
              }}
            />
          </div>

          {/* ── Subtree (children of this scope) ── */}
          {/* For tasks: top-level subtasks. For subtasks: sub-subtasks (one
              level deep — the DB CHECK caps nesting). Click a row to drill
              the sheet into that child's scope without closing. */}
          {!(isTask && (scope.task.task_entities?.length ?? 0) > 0) && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-medium text-steel">
                  {isTask ? "Subtasks" : "Sub-subtasks"}
                  <span className="text-steel/50 ml-1.5">({children.length})</span>
                </label>
                {/* Adding attributes is admin/owner only. */}
                {isPrivileged && !showAddChild && (isTask || !scope.subtask.parent_subtask_id) && (
                  <button
                    type="button"
                    onClick={() => setShowAddChild(true)}
                    className="text-[11px] text-taskora-red hover:text-taskora-red/80 font-medium flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    Add {isTask ? "subtask" : "sub-subtask"}
                  </button>
                )}
              </div>
              {childrenLoading && children.length === 0 && (
                <p className="text-xs text-steel/50 italic py-2">Loading…</p>
              )}
              {!childrenLoading && children.length === 0 && !showAddChild && (
                <p className="text-xs text-steel/50 italic py-2">
                  No {isTask ? "subtasks" : "sub-subtasks"} yet.
                </p>
              )}
              {children.length > 0 && (
                <ul className="border border-pebble rounded divide-y divide-pebble/60">
                  {children.map((s) => {
                    const statusCls = STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600";
                    const assignee = members.find((m) => m.user_id === s.assignee_id);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate?.({
                              kind: "subtask",
                              subtask: s,
                              task: isTask ? scope.task : scope.task,
                              programName: scope.programName,
                              programColor: scope.programColor,
                              initiativeName: scope.initiativeName,
                            })
                          }
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-mist/50 focus:outline-none focus:bg-mist/70"
                        >
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusCls} flex-shrink-0`}
                          >
                            {STATUS_LABELS[s.status] ?? s.status}
                          </span>
                          <span
                            className={`flex-1 min-w-0 truncate text-sm ${
                              s.status === "done" ? "line-through text-steel/50" : "text-midnight"
                            }`}
                          >
                            {s.title}
                          </span>
                          {s.due_date && (
                            <span className="text-[11px] text-steel flex-shrink-0">
                              📅 {s.due_date}
                            </span>
                          )}
                          {assignee && (
                            <span
                              className="w-5 h-5 rounded-full bg-ocean/15 text-ocean text-[9px] font-bold flex items-center justify-center flex-shrink-0"
                              title={assignee.name || assignee.email}
                            >
                              {(assignee.name || assignee.email || "?")
                                .split(" ")
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </span>
                          )}
                          <ChevronRight className="w-3.5 h-3.5 text-steel/40 flex-shrink-0" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {showAddChild && (
                <div className="mt-2">
                  <AddSubtaskInline
                    taskId={taskId}
                    members={members}
                    currentUserId={currentUserId}
                    parentSubtaskId={isTask ? undefined : subtaskId!}
                    onCreated={() => {
                      setShowAddChild(false);
                      loadChildren();
                      onChanged();
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {/* For entity-scoped tasks the per-entity status / per-entity subtask
              editor is non-trivial and stays on the row's inline expand for
              now. Surface a hint so users don't think the sheet is broken. */}
          {isTask && (scope.task.task_entities?.length ?? 0) > 0 && (
            <div className="rounded-md bg-mist/40 border border-pebble/60 p-3 text-xs text-steel">
              This task tracks <span className="font-medium text-midnight">
                {scope.task.task_entities!.length}
              </span> {scope.task.task_entities!.length === 1 ? "entity" : "entities"}.
              Per-entity status &amp; subtasks are managed from the task row
              below — close this panel to expand it.
            </div>
          )}

          {/* ── Comments — open the existing thread in a modal ── */}
          <div>
            <label className="block text-[11px] font-medium text-steel mb-1">Comments</label>
            <button
              type="button"
              onClick={() => setShowComments(true)}
              className="w-full flex items-center justify-between gap-2 border border-pebble rounded px-3 py-2 text-sm text-steel hover:bg-mist/40 focus:outline-none focus:border-ocean"
            >
              <span className="inline-flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-ocean" />
                {isTask
                  ? "Open task thread (rolls up subtree comments)"
                  : "Open subtask thread"}
              </span>
              <ChevronRight className="w-4 h-4 text-steel/40" />
            </button>
          </div>
        </div>

        {showComments && (
          <CommentsPopup
            apiPath={
              isTask
                ? `/api/v1/tasks/${taskId}/comments`
                : `/api/v1/tasks/${taskId}/subtasks/${subtaskId}/comments`
            }
            includeDescendants={isTask}
            title={title || (isTask ? "Task" : "Subtask")}
            onClose={() => setShowComments(false)}
            onPosted={() => onChanged()}
          />
        )}

        <footer className="border-t border-pebble p-3 flex items-center justify-end gap-2">
          {err && <span className="text-xs text-red-600 mr-auto">{err}</span>}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded border border-pebble text-steel hover:bg-mist"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canEdit || saving}
            className="px-3 py-1.5 text-sm rounded bg-taskora-red text-white hover:bg-taskora-red/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </aside>
    </>
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
