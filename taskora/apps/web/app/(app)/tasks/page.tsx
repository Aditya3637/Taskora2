"use client";
import { useState, useEffect, useCallback } from "react";
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

const STATUS_LABELS: Record<string, string> = {
  pending_decision: "Pending Decision", in_progress: "In Progress",
  blocked: "Blocked", done: "Done", todo: "To Do", backlog: "Backlog",
};
const STATUS_COLORS: Record<string, string> = {
  pending_decision: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  blocked: "bg-red-100 text-red-800",
  done: "bg-green-100 text-green-800",
  todo: "bg-gray-100 text-gray-600",
  backlog: "bg-gray-100 text-gray-500",
};
const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500", critical: "border-l-red-600",
  high: "border-l-amber-400", medium: "border-l-blue-400", low: "border-l-gray-300",
};

type Task = {
  id: string; title: string; status: string; priority: string;
  due_date?: string; task_entities?: { entity_id: string; entity_name?: string }[];
  is_stale?: boolean;
};
type Initiative = { id: string; name: string };
type Entity = { id: string; name: string };

const STATUSES = ["All", "pending_decision", "in_progress", "blocked", "done", "todo"];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityType, setEntityType] = useState("building");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setTasks(await apiFetch("/api/v1/tasks/my")); }
    catch { setError("Failed to load tasks."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadCreateMeta() {
    try {
      const bizList = await apiFetch("/api/v1/businesses/");
      if (bizList?.length) {
        const biz = bizList[0];
        const et = biz.type === "building" ? "building" : "client";
        setEntityType(et);
        const [inits, ents] = await Promise.all([
          apiFetch(`/api/v1/initiatives/business/${biz.id}`),
          apiFetch(`/api/v1/businesses/${biz.id}/${et === "building" ? "buildings" : "clients"}`),
        ]);
        setInitiatives(inits ?? []);
        setEntities(ents ?? []);
      }
    } catch { /* ignore */ }
  }

  function openCreate() { loadCreateMeta(); setShowCreate(true); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await apiFetch("/api/v1/tasks/", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(), priority, status: "todo",
          primary_stakeholder_id: session?.user?.id,
          ...(initiativeId && { initiative_id: initiativeId }),
          ...(dueDate && { due_date: dueDate }),
          entities: selectedEntities.map(id => ({ entity_type: entityType, entity_id: id })),
        }),
      });
      setShowCreate(false);
      setTitle(""); setPriority("medium"); setDueDate(""); setInitiativeId(""); setSelectedEntities([]);
      load();
    } catch (err: unknown) {
      alert("Failed to create: " + (err instanceof Error ? err.message : String(err)));
    } finally { setCreating(false); }
  }

  const filtered = tasks.filter(t => filter === "All" || t.status === filter);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-midnight">My Tasks</h1>
        <button onClick={openCreate} className="px-4 py-2 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90">
          + New Task
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-6">
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
          <div className="w-6 h-6 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/>
        </div>
      )}
      {error && <p className="text-red-600 text-sm">{error} <button onClick={load} className="underline">Retry</button></p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-steel text-sm italic">No tasks here yet.</p>
      )}

      <div className="space-y-3">
        {filtered.map(task => {
          const ents = task.task_entities ?? [];
          return (
            <div key={task.id}
              className={`bg-white rounded-xl border border-l-4 ${PRIORITY_BORDER[task.priority] ?? "border-l-gray-300"} border-pebble p-4 shadow-sm hover:shadow-md transition-shadow`}>
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
                  </div>
                  {ents.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ents.map(e => (
                        <span key={e.entity_id} className="text-xs bg-mist text-steel px-2 py-0.5 rounded">
                          {e.entity_name ?? e.entity_id}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-midnight mb-4">New Task</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Task title" required
                className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean"/>
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
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none"/>
                </div>
              </div>
              {initiatives.length > 0 && (
                <div>
                  <label className="text-xs text-steel font-medium mb-1 block">Initiative</label>
                  <select value={initiativeId} onChange={e => setInitiativeId(e.target.value)}
                    className="w-full h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none">
                    <option value="">None</option>
                    {initiatives.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </div>
              )}
              {entities.length > 0 && (
                <div>
                  <label className="text-xs text-steel font-medium mb-1 block">Entities</label>
                  <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                    {entities.map(e => (
                      <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={selectedEntities.includes(e.id)}
                          onChange={ev => setSelectedEntities(ev.target.checked
                            ? [...selectedEntities, e.id]
                            : selectedEntities.filter(x => x !== e.id))}/>
                        {e.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)}
                  className="flex-1 h-10 border border-pebble rounded-lg text-sm text-steel hover:bg-mist">
                  Cancel
                </button>
                <button type="submit" disabled={creating}
                  className="flex-1 h-10 bg-taskora-red text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
                  {creating ? "Creating..." : "Create Task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
