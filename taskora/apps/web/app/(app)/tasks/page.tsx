"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, X, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  if (res.status === 204) return {};
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────
type MyInitiative = {
  id: string; name: string; status: string;
  impact?: string; impact_category?: string;
  primary_stakeholder_id?: string; primary_stakeholder_name?: string;
  programs?: { id: string; name: string; color: string } | null;
  target_end_date?: string;
};
type TaskEntity = { entity_id: string; entity_name?: string; entity_type?: string };
type Task = {
  id: string; title: string; status: string; priority: string;
  due_date?: string; initiative_id?: string; task_entities?: TaskEntity[];
  is_stale?: boolean; primary_stakeholder_id?: string;
};
type Subtask = { id: string; title: string; status: string; assignee_id?: string; assignee_name?: string };
type Member = { user_id: string; name: string; email: string };
type Entity = { id: string; name: string };

// ── Constants ────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  pending_decision: "Pending Decision", in_progress: "In Progress",
  blocked: "Blocked", done: "Done", todo: "To Do", backlog: "Backlog", open: "Open",
};
const STATUS_COLORS: Record<string, string> = {
  pending_decision: "bg-amber-100 text-amber-800", in_progress: "bg-blue-100 text-blue-800",
  blocked: "bg-red-100 text-red-800", done: "bg-green-100 text-green-800",
  todo: "bg-gray-100 text-gray-600", backlog: "bg-gray-100 text-gray-500", open: "bg-sky-100 text-sky-700",
};
const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500", critical: "border-l-red-600",
  high: "border-l-amber-400", medium: "border-l-blue-400", low: "border-l-gray-300",
};
const IMPACT_CATEGORY_COLOR: Record<string, string> = {
  cost: "bg-green-100 text-green-700 border-green-200",
  customer_experience: "bg-blue-100 text-blue-700 border-blue-200",
  process_efficiency: "bg-purple-100 text-purple-700 border-purple-200",
  others: "bg-gray-100 text-gray-600 border-gray-200",
};
const IMPACT_CATEGORY_LABEL: Record<string, string> = {
  cost: "Cost", customer_experience: "Customer Exp.",
  process_efficiency: "Process", others: "Others",
};
const STATUSES = ["All", "pending_decision", "in_progress", "blocked", "done", "todo"];

// ── Subtask Row ───────────────────────────────────────────────────────────────
function SubtaskRow({
  subtask, taskId, onToggle,
}: { subtask: Subtask; taskId: string; onToggle: () => void }) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    const next = subtask.status === "done" ? "todo" : "done";
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/subtasks/${subtask.id}`, {
        method: "PATCH", body: JSON.stringify({ status: next }),
      });
      onToggle();
    } catch { /* silent */ }
    finally { setToggling(false); }
  }

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-mist/30 group">
      <button onClick={toggle} disabled={toggling}
        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
          subtask.status === "done" ? "bg-green-500 border-green-500" : "border-pebble hover:border-ocean"
        }`}>
        {subtask.status === "done" && <span className="text-white text-[10px] font-bold">✓</span>}
      </button>
      <span className={`text-xs flex-1 ${subtask.status === "done" ? "line-through text-steel/50" : "text-midnight"}`}>
        {subtask.title}
      </span>
      {subtask.assignee_name && (
        <span className="text-[10px] text-steel/60 hidden group-hover:block">{subtask.assignee_name}</span>
      )}
    </div>
  );
}

// ── Add Subtask Inline ────────────────────────────────────────────────────────
function AddSubtaskInline({ taskId, members, currentUserId, onCreated }: {
  taskId: string; members: Member[]; currentUserId: string; onCreated: () => void;
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
        body: JSON.stringify({ title: title.trim(), assignee_id: assigneeId || currentUserId }),
      });
      setTitle(""); setAssigneeId("");
      onCreated();
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 mt-1 px-2">
      <input
        value={title} onChange={e => setTitle(e.target.value)}
        placeholder="Add subtask…" autoFocus
        className="flex-1 text-xs border border-pebble rounded px-2 py-1.5 focus:outline-none focus:border-ocean"
      />
      {members.length > 0 && (
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
          className="text-xs border border-pebble rounded px-1.5 py-1.5 focus:outline-none max-w-[110px]">
          <option value="">Me</option>
          {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>)}
        </select>
      )}
      <button type="submit" disabled={saving || !title.trim()}
        className="text-xs px-2.5 py-1.5 bg-taskora-red text-white rounded font-medium hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
        Add
      </button>
    </form>
  );
}

// ── Task Card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, initiativeMap, members, currentUserId }: {
  task: Task;
  initiativeMap: Record<string, string>;
  members: Member[];
  currentUserId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const ents = task.task_entities ?? [];

  async function loadSubtasks() {
    if (loadingSubtasks) return;
    setLoadingSubtasks(true);
    try {
      const data = await apiFetch(`/api/v1/tasks/${task.id}/subtasks`);
      setSubtasks(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
    finally { setLoadingSubtasks(false); }
  }

  function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && subtasks.length === 0) loadSubtasks();
  }

  const doneCount = subtasks.filter(s => s.status === "done").length;

  return (
    <div className={`bg-white rounded-xl border border-l-4 ${PRIORITY_BORDER[task.priority] ?? "border-l-gray-300"} border-pebble shadow-sm`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-midnight truncate">{task.title}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-600"}`}>
                {STATUS_LABELS[task.status] ?? task.status}
              </span>
              {task.due_date && <span className="text-xs text-steel">📅 {task.due_date}</span>}
              {task.is_stale && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Needs Update</span>
              )}
              {task.initiative_id && initiativeMap[task.initiative_id] && (
                <span className="text-xs text-steel/60">→ {initiativeMap[task.initiative_id]}</span>
              )}
            </div>
            {ents.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {ents.map(e => (
                  <span key={e.entity_id} className={`text-xs px-2 py-0.5 rounded font-medium ${
                    e.entity_type === "building" ? "bg-amber-50 text-amber-700" : "bg-sky-50 text-sky-700"
                  }`}>
                    {e.entity_name ?? e.entity_id}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={toggleExpand}
            className="flex items-center gap-1 text-xs text-steel hover:text-midnight flex-shrink-0 mt-0.5">
            <span className="font-medium">{subtasks.length > 0 ? `${doneCount}/${subtasks.length}` : "Subtasks"}</span>
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-pebble/50 px-4 pb-3 pt-2 bg-mist/10">
          {loadingSubtasks && <p className="text-xs text-steel/50 py-1">Loading…</p>}
          {subtasks.map(s => (
            <SubtaskRow key={s.id} subtask={s} taskId={task.id} onToggle={loadSubtasks} />
          ))}
          {subtasks.length === 0 && !loadingSubtasks && (
            <p className="text-xs text-steel/50 py-1 italic">No subtasks yet.</p>
          )}
          {showAddSubtask ? (
            <AddSubtaskInline
              taskId={task.id} members={members} currentUserId={currentUserId}
              onCreated={() => { setShowAddSubtask(false); loadSubtasks(); }}
            />
          ) : (
            <button onClick={() => setShowAddSubtask(true)}
              className="mt-1 text-xs text-taskora-red hover:underline font-medium flex items-center gap-1">
              <Plus className="w-3 h-3" /> Add subtask
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Task Breakdown Modal ──────────────────────────────────────────────────────
function BreakdownModal({
  initiative, businessId, currentUserId, onClose, onCreated,
}: {
  initiative: MyInitiative; businessId: string; currentUserId: string;
  onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [taskType, setTaskType] = useState<"general" | "building" | "client">("general");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [secondaryStakeholderId, setSecondaryStakeholderId] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMeta() {
      try {
        const [mems, biz] = await Promise.all([
          apiFetch(`/api/v1/businesses/${businessId}/members`),
          apiFetch("/api/v1/businesses/my"),
        ]);
        setMembers(Array.isArray(mems) ? mems.filter((m: Member) => m.user_id !== currentUserId) : []);
        if (biz?.id && taskType !== "general") {
          const endpoint = taskType === "building"
            ? `/api/v1/businesses/${biz.id}/buildings`
            : `/api/v1/businesses/${biz.id}/clients`;
          const ents = await apiFetch(endpoint).catch(() => []);
          setEntities(Array.isArray(ents) ? ents : []);
        }
      } catch { /* ignore */ }
    }
    loadMeta();
  }, [businessId, currentUserId, taskType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true); setError("");
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
            ? selectedEntities.map(id => ({ entity_type: taskType, entity_id: id }))
            : [],
        }),
      });

      // Add secondary stakeholder if selected (else current user is already primary)
      if (secondaryStakeholderId) {
        await apiFetch(`/api/v1/tasks/${task.id}/stakeholders`, {
          method: "POST",
          body: JSON.stringify({ user_id: secondaryStakeholderId, role: "secondary" }),
        }).catch(() => {});
      }

      onCreated(); onClose();
    } catch { setError("Failed to create task."); }
    finally { setSaving(false); }
  }

  const cat = initiative.impact_category ?? "others";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-midnight">Break Down Initiative</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-steel" /></button>
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
          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Task Title *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Audit electricity consumption" required autoFocus
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-2">Task Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(["general", "building", "client"] as const).map(type => (
                <button key={type} type="button" onClick={() => { setTaskType(type); setSelectedEntities([]); }}
                  className={`py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${
                    taskType === type
                      ? "bg-taskora-red text-white border-taskora-red"
                      : "border-pebble text-steel hover:border-ocean/40"
                  }`}>
                  {type === "general" ? "General" : type === "building" ? "Building" : "Client"}
                </button>
              ))}
            </div>
          </div>

          {taskType !== "general" && entities.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
                Select {taskType === "building" ? "Buildings" : "Clients"}
              </label>
              <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                {entities.map(e => (
                  <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-mist/30 rounded px-1 py-1">
                    <input type="checkbox" checked={selectedEntities.includes(e.id)}
                      onChange={ev => setSelectedEntities(ev.target.checked
                        ? [...selectedEntities, e.id]
                        : selectedEntities.filter(x => x !== e.id))}
                      className="rounded"
                    />
                    <span className="truncate">{e.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">
              Secondary Stakeholder <span className="text-steel/50 font-normal">(defaults to you)</span>
            </label>
            <select value={secondaryStakeholderId} onChange={e => setSecondaryStakeholderId(e.target.value)}
              className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-taskora-red">
              <option value="">You (default)</option>
              {members.map(m => (
                <option key={m.user_id} value={m.user_id}>{m.name || m.email}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none">
                {["low", "medium", "high", "urgent"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-steel uppercase tracking-wider mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full border border-pebble rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-pebble text-sm text-steel hover:bg-mist">
              Cancel
            </button>
            <button type="submit" disabled={saving || !title.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? "Creating…" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Initiative Banner ─────────────────────────────────────────────────────────
function InitiativeBanner({ initiative, businessId, currentUserId, onTaskCreated }: {
  initiative: MyInitiative; businessId: string; currentUserId: string; onTaskCreated: () => void;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const cat = initiative.impact_category ?? "others";

  return (
    <div className="bg-white rounded-xl border border-pebble shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {initiative.programs && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: initiative.programs.color ?? "#6366F1" }}>
                {initiative.programs.name}
              </span>
            )}
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium border ${IMPACT_CATEGORY_COLOR[cat]}`}>
              {IMPACT_CATEGORY_LABEL[cat] ?? cat}
            </span>
          </div>
          <p className="font-semibold text-midnight mt-1.5">{initiative.name}</p>
          {initiative.impact && (
            <p className="text-xs text-steel mt-0.5 line-clamp-1">{initiative.impact}</p>
          )}
          {initiative.primary_stakeholder_name && (
            <div className="flex items-center gap-1 mt-1">
              <User className="w-3 h-3 text-steel/60" />
              <span className="text-xs text-steel/70">{initiative.primary_stakeholder_name}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowBreakdown(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-taskora-red text-white text-xs font-semibold rounded-lg hover:opacity-90 flex-shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Break Down
        </button>
      </div>

      {showBreakdown && (
        <BreakdownModal
          initiative={initiative}
          businessId={businessId}
          currentUserId={currentUserId}
          onClose={() => setShowBreakdown(false)}
          onCreated={() => { onTaskCreated(); setShowBreakdown(false); }}
        />
      )}
    </div>
  );
}

// ── Standalone Task Create Modal ──────────────────────────────────────────────
function NewTaskModal({ businessId, currentUserId, initiatives, onClose, onCreated }: {
  businessId: string; currentUserId: string; initiatives: MyInitiative[];
  onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      await apiFetch("/api/v1/tasks/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), priority, status: "todo",
          primary_stakeholder_id: currentUserId,
          ...(initiativeId && { initiative_id: initiativeId }),
          ...(dueDate && { due_date: dueDate }),
          entities: [],
        }),
      });
      onCreated(); onClose();
    } catch (err: unknown) {
      alert("Failed to create: " + (err instanceof Error ? err.message : String(err)));
    } finally { setCreating(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-midnight">New Task</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-steel" /></button>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Task title" required autoFocus
            className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                {["low","medium","high","urgent"].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none" />
            </div>
          </div>
          {initiatives.length > 0 && (
            <div>
              <label className="text-xs text-steel font-medium mb-1 block">Link to Initiative</label>
              <select value={initiativeId} onChange={e => setInitiativeId(e.target.value)}
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                <option value="">None</option>
                {initiatives.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel hover:bg-mist">Cancel</button>
            <button type="submit" disabled={creating}
              className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
              {creating ? "Creating..." : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [initiatives, setInitiatives] = useState<MyInitiative[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      setCurrentUserId(user.id);

      const biz = await apiFetch("/api/v1/businesses/my");
      if (biz?.id) {
        setBusinessId(biz.id);
        const [taskData, initData, memberData] = await Promise.all([
          apiFetch("/api/v1/tasks/my"),
          apiFetch("/api/v1/initiatives/my"),
          apiFetch(`/api/v1/businesses/${biz.id}/members`),
        ]);
        setTasks(Array.isArray(taskData) ? taskData : []);
        setInitiatives(Array.isArray(initData) ? initData : []);
        setMembers(Array.isArray(memberData) ? memberData.filter((m: Member) => m.user_id !== user.id) : []);
      } else {
        setTasks(await apiFetch("/api/v1/tasks/my"));
      }
    } catch (err: any) {
      const msg = err?.message ?? "";
      if (msg.toLowerCase().includes("not authenticated")) {
        router.replace("/login?next=/tasks");
        return;
      }
      setError("Failed to load tasks.");
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = tasks.filter(t => filter === "All" || t.status === filter);
  const initiativeMap = Object.fromEntries(initiatives.map(i => [i.id, i.name]));

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* My Initiatives Section */}
      {initiatives.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-bold text-midnight mb-3">My Initiatives</h2>
          <div className="space-y-3">
            {initiatives.map(init => (
              <InitiativeBanner
                key={init.id}
                initiative={init}
                businessId={businessId}
                currentUserId={currentUserId}
                onTaskCreated={load}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-midnight">My Tasks</h2>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
            + New Task
          </button>
        </div>

        <div className="flex gap-2 flex-wrap mb-5">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                filter === s ? "bg-taskora-red text-white" : "bg-white border border-pebble text-steel hover:text-midnight"
              }`}>
              {s === "All" ? "All" : STATUS_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center h-32 items-center">
            <div className="w-6 h-6 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
          </div>
        )}
        {error && <p className="text-red-600 text-sm">{error} <button onClick={load} className="underline">Retry</button></p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-steel text-sm italic">No tasks here yet.</p>
        )}

        <div className="space-y-3">
          {filtered.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              initiativeMap={initiativeMap}
              members={members}
              currentUserId={currentUserId}
            />
          ))}
        </div>
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
