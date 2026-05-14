"use client";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, X, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

type TaskEntity = {
  entity_id: string;
  entity_name?: string;
  entity_type?: string;
  per_entity_status?: string;
  per_entity_end_date?: string;
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
};

type Subtask = {
  id: string;
  title: string;
  status: string;
  assignee_id?: string;
  assignee_name?: string;
};

type Member = { user_id: string; name: string; email: string };
type BuildingEntity = { id: string; name: string; zone?: string };
type ClientEntity = { id: string; name: string };

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending_decision: "Pending Decision",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  todo: "To Do",
  backlog: "Backlog",
  open: "Open",
};

const STATUS_COLORS: Record<string, string> = {
  pending_decision: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  blocked: "bg-red-100 text-red-800",
  done: "bg-green-100 text-green-800",
  todo: "bg-gray-100 text-gray-600",
  backlog: "bg-gray-100 text-gray-500",
  open: "bg-sky-100 text-sky-700",
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

const STATUSES = [
  "All",
  "in_progress",
  "pending_decision",
  "blocked",
  "done",
  "todo",
];

// ── Subtask Row ───────────────────────────────────────────────────────────────

function SubtaskRow({
  subtask,
  taskId,
  onToggle,
}: {
  subtask: Subtask;
  taskId: string;
  onToggle: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    const next = subtask.status === "done" ? "todo" : "done";
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      onToggle();
    } catch {
      /* silent */
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-mist/30 group">
      <button
        onClick={toggle}
        disabled={toggling}
        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
          subtask.status === "done"
            ? "bg-green-500 border-green-500"
            : "border-pebble hover:border-ocean"
        }`}
      >
        {subtask.status === "done" && (
          <span className="text-white text-[10px] font-bold">✓</span>
        )}
      </button>
      <span
        className={`text-xs flex-1 ${
          subtask.status === "done"
            ? "line-through text-steel/50"
            : "text-midnight"
        }`}
      >
        {subtask.title}
      </span>
      {subtask.assignee_name && (
        <span className="text-[10px] text-steel/60 hidden group-hover:block">
          {subtask.assignee_name}
        </span>
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
  onCreated,
}: {
  taskId: string;
  members: Member[];
  currentUserId: string;
  scopedEntityId?: string;
  scopedEntityType?: string;
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
          ...(scopedEntityId && {
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

// ── Entity Subtask Row (entity = first-level subtask, supports nested sub-subtasks) ──

function EntitySubtaskRow({
  entity,
  taskId,
  members,
  currentUserId,
}: {
  entity: TaskEntity;
  taskId: string;
  members: Member[];
  currentUserId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [entityStatus, setEntityStatus] = useState(entity.per_entity_status ?? "backlog");
  const [entityEndDate, setEntityEndDate] = useState(entity.per_entity_end_date?.slice(0, 10) ?? "");
  const [updatingStatus, setUpdatingStatus] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch(
        `/api/v1/tasks/${taskId}/subtasks?for_entity=${entity.entity_id}`
      );
      setSubtasks(Array.isArray(data) ? data : []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && subtasks.length === 0) load();
  }

  async function handleEntityStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const newStatus = e.target.value;
    const prev = entityStatus;
    setEntityStatus(newStatus);
    setUpdatingStatus(true);
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, {
        method: "PATCH",
        body: JSON.stringify({ per_entity_status: newStatus }),
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
    setEntityEndDate(newDate);
    if (!newDate) return;
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/entities/${entity.entity_id}`, {
        method: "PATCH",
        body: JSON.stringify({ per_entity_end_date: newDate }),
      });
    } catch { /* silent */ }
  }

  const doneCount = subtasks.filter((s) => s.status === "done").length;
  const colorCls =
    entity.entity_type === "building"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-sky-50 text-sky-700 border-sky-200";
  const statusCls = STATUS_COLORS[entityStatus] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="mb-1.5">
      <div className="flex items-center gap-2 px-2 py-2 rounded hover:bg-mist/30 flex-wrap">
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
          {["backlog", "todo", "in_progress", "pending_decision", "blocked", "done"].map((s) => (
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

        {/* Expand / subtask count */}
        <button
          type="button"
          onClick={toggle}
          className="ml-auto flex items-center gap-1 text-xs text-steel hover:text-midnight flex-shrink-0"
        >
          {subtasks.length > 0 ? `${doneCount}/${subtasks.length}` : ""}
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="ml-4 pl-2 border-l border-pebble/40 mt-0.5">
          {loading && (
            <p className="text-xs text-steel/50 py-1">Loading…</p>
          )}
          {subtasks.map((s) => (
            <SubtaskRow
              key={s.id}
              subtask={s}
              taskId={taskId}
              onToggle={load}
            />
          ))}
          {subtasks.length === 0 && !loading && (
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
                load();
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
}: {
  task: Task;
  members: Member[];
  currentUserId: string;
  myRole: string;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editDueDate, setEditDueDate] = useState(task.due_date ?? "");
  const [savingDate, setSavingDate] = useState(false);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [stakeholdersLoaded, setStakeholdersLoaded] = useState(false);
  const [newStakeholderUserId, setNewStakeholderUserId] = useState("");
  const ents = task.task_entities ?? [];

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

  async function loadSubtasks() {
    if (loadingSubtasks) return;
    setLoadingSubtasks(true);
    try {
      const data = await apiFetch(`/api/v1/tasks/${task.id}/subtasks`);
      setSubtasks(Array.isArray(data) ? data : []);
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
    setEditDueDate(newDate);
    if (!newDate) return;
    setSavingDate(true);
    try {
      await apiFetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ due_date: newDate }),
      });
    } catch { /* silent */ } finally {
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
      if (ents.length === 0 && subtasks.length === 0) loadSubtasks();
      if (!stakeholdersLoaded) loadStakeholders();
    }
  }

  const doneCount = subtasks.filter((s) => s.status === "done").length;

  return (
    <div
      className={`bg-white rounded-xl border border-l-4 ${
        PRIORITY_BORDER[task.priority] ?? "border-l-gray-300"
      } border-pebble shadow-sm`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-midnight truncate">{task.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {/* Inline status select */}
              <StatusSelect task={task} onStatusChange={onStatusChange} />

              {task.due_date && (
                <span className="text-xs text-steel">📅 {task.due_date}</span>
              )}

              {task.is_stale && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Needs Update
                </span>
              )}
            </div>



          </div>

          <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
            {canDelete && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-xs px-2 py-1 rounded border border-red-200 text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 font-medium"
                title="Delete task"
              >
                {deleting ? "…" : "Delete"}
              </button>
            )}
            <button
              onClick={toggleExpand}
              className="flex items-center gap-1 text-xs text-steel hover:text-midnight"
            >
              <span className="font-medium">
                {ents.length > 0
                  ? `${ents.length} ${ents[0]?.entity_type === "client" ? "client" : "building"}${ents.length !== 1 ? "s" : ""}`
                  : subtasks.length > 0
                  ? `${doneCount}/${subtasks.length}`
                  : "Subtasks"}
              </span>
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-pebble/50 px-4 pb-3 pt-2 bg-mist/10">

          {/* ── Task meta: due date + secondary stakeholders ── */}
          <div className="flex items-center gap-3 pb-2 mb-2 border-b border-pebble/30 flex-wrap text-xs">
            <label className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-steel font-medium">Due date:</span>
              <input
                type="date"
                value={editDueDate}
                onChange={handleDueDateChange}
                disabled={savingDate}
                className="border border-pebble rounded px-1.5 py-0.5 text-midnight focus:outline-none focus:border-ocean disabled:opacity-50"
              />
            </label>

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

          {ents.length > 0 ? (
            /* Entity tasks: each building/client is a collapsible subtask with its own sub-subtasks */
            <>
              {ents.map((e) => (
                <EntitySubtaskRow
                  key={e.entity_id}
                  entity={e}
                  taskId={task.id}
                  members={members}
                  currentUserId={currentUserId}
                />
              ))}
            </>
          ) : (
            /* General tasks: flat subtask list */
            <>
              {loadingSubtasks && (
                <p className="text-xs text-steel/50 py-1">Loading…</p>
              )}
              {subtasks.map((s) => (
                <SubtaskRow
                  key={s.id}
                  subtask={s}
                  taskId={task.id}
                  onToggle={loadSubtasks}
                />
              ))}
              {subtasks.length === 0 && !loadingSubtasks && (
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
                    loadSubtasks();
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
    } catch {
      setError("Failed to create task.");
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

// ── Initiative Banner ─────────────────────────────────────────────────────────

function InitiativeBanner({
  initiative,
  businessId,
  currentUserId,
  myRole,
  onTaskCreated,
  onDeleted,
}: {
  initiative: MyInitiative;
  businessId: string;
  currentUserId: string;
  myRole: string;
  onTaskCreated: () => void;
  onDeleted: (id: string) => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cat = initiative.impact_category ?? "others";

  const canDelete =
    initiative.primary_stakeholder_id === currentUserId ||
    myRole === "owner" ||
    myRole === "admin";

  async function handleDelete() {
    if (!confirm(`Delete initiative "${initiative.name}" and all its tasks? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/v1/initiatives/${initiative.id}`, { method: "DELETE" });
      onDeleted(initiative.id);
    } catch (err: any) {
      alert("Failed to delete: " + (err?.message ?? "Unknown error"));
      setDeleting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-pebble shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {initiative.programs && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                style={{
                  backgroundColor: initiative.programs.color ?? "#6366F1",
                }}
              >
                {initiative.programs.name}
              </span>
            )}
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border ${IMPACT_CATEGORY_COLOR[cat]}`}
            >
              {IMPACT_CATEGORY_LABEL[cat] ?? cat}
            </span>
          </div>
          <p className="font-semibold text-midnight mt-1.5">
            {initiative.name}
          </p>
          {initiative.impact && (
            <p className="text-xs text-steel mt-0.5 line-clamp-1">
              {initiative.impact}
            </p>
          )}
          {initiative.primary_stakeholder_name && (
            <div className="flex items-center gap-1 mt-1">
              <User className="w-3 h-3 text-steel/60" />
              <span className="text-xs text-steel/70">
                {initiative.primary_stakeholder_name}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {canDelete && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <button
            onClick={() => setShowBreakdown(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-taskora-red text-white text-xs font-semibold rounded-lg hover:opacity-90"
          >
            <Plus className="w-3.5 h-3.5" /> Break Down
          </button>
        </div>
      </div>

      {showBreakdown && (
        <BreakdownModal
          initiative={initiative}
          businessId={businessId}
          currentUserId={currentUserId}
          onClose={() => setShowBreakdown(false)}
          onCreated={() => {
            onTaskCreated();
            setShowBreakdown(false);
          }}
        />
      )}
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
}: {
  initiative: MyInitiative | null; // null = "Unlinked"
  tasks: Task[];
  members: Member[];
  currentUserId: string;
  myRole: string;
  highlighted: boolean;
  onStatusChange: (taskId: string, newStatus: string) => void;
  onTaskDeleted: (taskId: string) => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(!highlighted);

  // Auto-scroll to highlighted group
  useEffect(() => {
    if (highlighted && groupRef.current) {
      groupRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlighted]);

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
      {/* Group Header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-black/[0.02] transition-colors"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        {/* Colored dot */}
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

        {/* X/Y done */}
        <span className="text-xs text-steel/60 flex-shrink-0 tabular-nums">
          {doneCount}/{total} done
        </span>

        {/* Chevron */}
        <span className="text-steel/40 flex-shrink-0">
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>

      {/* Tasks list */}
      {!collapsed && (
        <div className="border-t border-pebble/50 px-4 py-3 space-y-2.5">
          {tasks.length === 0 ? (
            <p className="text-xs text-steel/50 italic py-1">
              No tasks in this group.
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
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── My Initiatives Collapsible Section ────────────────────────────────────────

function MyInitiativesSection({
  initiatives,
  businessId,
  currentUserId,
  myRole,
  onTaskCreated,
  onInitiativeDeleted,
}: {
  initiatives: MyInitiative[];
  businessId: string;
  currentUserId: string;
  myRole: string;
  onTaskCreated: () => void;
  onInitiativeDeleted: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (initiatives.length === 0) return null;

  return (
    <div className="mb-8">
      <button
        className="flex items-center gap-2 mb-3 group"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <h2 className="text-lg font-bold text-midnight">My Initiatives</h2>
        <span className="text-steel/50 group-hover:text-steel transition-colors">
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-3">
          {initiatives.map((init) => (
            <InitiativeBanner
              key={init.id}
              initiative={init}
              businessId={businessId}
              currentUserId={currentUserId}
              myRole={myRole}
              onTaskCreated={onTaskCreated}
              onDeleted={onInitiativeDeleted}
            />
          ))}
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

      // Fetch biz, tasks, and initiatives in parallel
      const [biz, taskData, initData] = await Promise.all([
        apiFetch("/api/v1/businesses/my"),
        apiFetch("/api/v1/tasks/my"),
        apiFetch("/api/v1/initiatives/my"),
      ]);

      setTasks(Array.isArray(taskData) ? taskData : []);
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
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Optimistic status update
  function handleStatusChange(taskId: string, newStatus: string) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
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

  // Filter tasks
  const filtered =
    filter === "All" ? tasks : tasks.filter((t) => t.status === filter);

  // Group tasks by initiative
  const initiativeMap = Object.fromEntries(
    initiatives.map((i) => [i.id, i])
  );

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

  // Collect initiative ids that have tasks, ordered by initiative name
  const initiativeIdsWithTasks = Object.keys(tasksByInitiative).sort((a, b) => {
    const nameA = initiativeMap[a]?.name ?? "";
    const nameB = initiativeMap[b]?.name ?? "";
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* My Initiatives Section (collapsible) */}
      <MyInitiativesSection
        initiatives={initiatives}
        businessId={businessId}
        currentUserId={currentUserId}
        myRole={myRole}
        onTaskCreated={load}
        onInitiativeDeleted={handleInitiativeDelete}
      />

      {/* Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-midnight">My Tasks</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
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
              {s === "All" ? "All" : STATUS_LABELS[s] ?? s}
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

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border border-pebble">
            <p className="text-steel text-sm italic">No tasks here yet.</p>
          </div>
        )}

        {/* Grouped tasks */}
        {!loading && !error && filtered.length > 0 && (
          <div className="space-y-3">
            {/* Initiative groups */}
            {initiativeIdsWithTasks.map((initId) => (
              <InitiativeGroup
                key={initId}
                initiative={initiativeMap[initId] ?? null}
                tasks={tasksByInitiative[initId]}
                members={members}
                currentUserId={currentUserId}
                myRole={myRole}
                highlighted={highlightInitiativeId === initId}
                onStatusChange={handleStatusChange}
                onTaskDeleted={handleTaskDelete}
              />
            ))}

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
              />
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
