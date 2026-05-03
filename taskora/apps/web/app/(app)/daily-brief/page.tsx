"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Task = { id: string; title: string; status: string; priority: string; due_date?: string; task_entities?: {entity_id:string;entity_name?:string}[] };
type InitProgress = { id: string; title?: string; name?: string; completion_pct: number; total_tasks?: number; done_tasks?: number };
type QuickStats = { open_tasks: number; completion_rate_this_week: number; stale_count: number };
type Brief = {
  greeting?: { summary_line: string };
  pending_decisions: Task[]; overdue_tasks: Task[]; stale_tasks: Task[];
  due_this_week: Task[]; blocked_tasks: Task[];
  initiative_progress: InitProgress[]; quick_stats?: QuickStats;
};

function priorityBorder(p: string) {
  if (p === "urgent" || p === "critical") return "border-l-4 border-l-red-500";
  if (p === "high") return "border-l-4 border-l-amber-400";
  return "border-l-4 border-l-ocean";
}

function TaskRow({ task, showApprove, onAction }: { task: Task; showApprove?: boolean; onAction?: (id: string, action: string) => void }) {
  const entities = task.task_entities ?? [];
  return (
    <div className={`bg-white rounded-lg p-4 shadow-sm ${priorityBorder(task.priority)} mb-2`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-midnight text-sm">{task.title}</p>
          {task.due_date && <p className="text-xs text-steel mt-1">Due {task.due_date}</p>}
          {entities.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {entities.map((e) => (
                <span key={e.entity_id} className="text-xs bg-mist text-steel px-2 py-0.5 rounded">{e.entity_name ?? e.entity_id}</span>
              ))}
            </div>
          )}
        </div>
        {showApprove && onAction && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => onAction(task.id, "approve")}
              className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700">Approve</button>
            <button onClick={() => onAction(task.id, "snooze")}
              className="px-3 py-1 bg-pebble text-steel text-xs font-semibold rounded-lg hover:bg-gray-200">Snooze</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="font-semibold text-midnight">{title}</h2>
        {count > 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white ${color}`}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

export default function DailyBriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setBrief(await apiFetch("/api/v1/daily-brief/")); }
    catch { setError("Failed to load daily brief."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDecision(taskId: string, action: string) {
    try {
      await apiFetch(`/api/v1/tasks/${taskId}/decisions`, { method: "POST", body: JSON.stringify({ action }) });
      load();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/></div>;
  if (error) return <div className="p-8 text-red-600">{error} <button onClick={load} className="ml-2 underline">Retry</button></div>;
  if (!brief) return null;

  const empty = <p className="text-sm text-steel italic bg-white rounded-lg p-3 border border-pebble">All clear ✓</p>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-midnight">
          {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"} 👋
        </h1>
        {brief.greeting?.summary_line && <p className="text-steel mt-1">{brief.greeting.summary_line}</p>}
      </div>

      {brief.quick_stats && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "Open Tasks", value: brief.quick_stats.open_tasks, warn: false },
            { label: "Done This Week", value: `${brief.quick_stats.completion_rate_this_week}%`, warn: false },
            { label: "Stale", value: brief.quick_stats.stale_count, warn: brief.quick_stats.stale_count > 0 },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 ${s.warn ? "bg-amber-50 border-amber-200" : "bg-white border-pebble"}`}>
              <p className="text-xs text-steel uppercase tracking-wider font-semibold mb-1">{s.label}</p>
              <p className={`text-3xl font-extrabold ${s.warn ? "text-amber-700" : "text-midnight"}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <Section title="🔴 Decisions Pending" count={brief.pending_decisions.length} color="bg-red-500">
        {brief.pending_decisions.length === 0 ? empty : brief.pending_decisions.map((t) => <TaskRow key={t.id} task={t} showApprove onAction={handleDecision}/>)}
      </Section>
      <Section title="⏰ Overdue" count={brief.overdue_tasks.length} color="bg-red-500">
        {brief.overdue_tasks.length === 0 ? empty : brief.overdue_tasks.map((t) => <TaskRow key={t.id} task={t}/>)}
      </Section>
      <Section title="🕰 Stale — Needs Update" count={brief.stale_tasks.length} color="bg-amber-500">
        {brief.stale_tasks.length === 0 ? empty : brief.stale_tasks.map((t) => <TaskRow key={t.id} task={t}/>)}
      </Section>
      <Section title="📅 Due This Week" count={brief.due_this_week.length} color="bg-blue-500">
        {brief.due_this_week.length === 0 ? empty : brief.due_this_week.map((t) => <TaskRow key={t.id} task={t}/>)}
      </Section>
      <Section title="🚫 Blocked" count={brief.blocked_tasks.length} color="bg-red-500">
        {brief.blocked_tasks.length === 0 ? empty : brief.blocked_tasks.map((t) => <TaskRow key={t.id} task={t}/>)}
      </Section>

      {brief.initiative_progress.length > 0 && (
        <Section title="🚀 Initiative Progress" count={brief.initiative_progress.length} color="bg-midnight">
          <div className="space-y-3">
            {brief.initiative_progress.map((p) => {
              const pct = Math.round(p.completion_pct ?? 0);
              return (
                <div key={p.id} className="bg-white border border-pebble rounded-xl p-4">
                  <div className="flex justify-between mb-2">
                    <span className="font-medium text-midnight text-sm">{p.title ?? p.name}</span>
                    <span className="text-sm font-mono text-steel">{pct}%</span>
                  </div>
                  <div className="h-2 bg-pebble rounded-full overflow-hidden">
                    <div className="h-full bg-taskora-red rounded-full transition-all" style={{ width: `${pct}%` }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
