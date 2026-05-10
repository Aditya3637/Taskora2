"use client";
import { useState, useEffect } from "react";
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
  return res;
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type TaskRow = { user_id: string; user_name: string; tasks_owned: number; tasks_completed: number; tasks_overdue: number; tasks_blocked: number; avg_completion_days: number };
type InitRow = { initiative_id: string; initiative_title: string; total_tasks: number; done_tasks: number; completion_pct: number; overdue_count: number; blocked_count: number };

export default function ReportsPage() {
  const [tab, setTab] = useState<"tasks" | "initiatives">("tasks");
  const [businessId, setBusinessId] = useState("");
  const [startDate, setStartDate] = useState(() => fmtDate(new Date(Date.now() - 30 * 86400_000)));
  const [endDate, setEndDate] = useState(() => fmtDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [taskRows, setTaskRows] = useState<TaskRow[]>([]);
  const [initRows, setInitRows] = useState<InitRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/businesses/my").then(r => r.json()).then((data: any[]) => {
      if (data?.[0]?.id) setBusinessId(data[0].id);
    }).catch(() => {});
  }, []);

  async function generate() {
    if (!businessId) return;
    setLoading(true); setError("");
    try {
      const qs = `business_id=${businessId}&start_date=${startDate}&end_date=${endDate}&format=json`;
      if (tab === "tasks") {
        const r = await apiFetch(`/api/v1/reports/tasks?${qs}`);
        setTaskRows(await r.json());
      } else {
        const r = await apiFetch(`/api/v1/reports/initiatives?${qs}`);
        setInitRows(await r.json());
      }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  async function exportCsv() {
    if (!businessId) return;
    const qs = `business_id=${businessId}&start_date=${startDate}&end_date=${endDate}&format=csv`;
    const endpoint = tab === "tasks" ? "tasks" : "initiatives";
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${API}/api/v1/reports/${endpoint}?${qs}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    });
    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `taskora-${endpoint}-report.csv`;
    link.click();
  }

  const totalTasks = taskRows.reduce((s, r) => s + r.tasks_owned, 0);
  const totalDone = taskRows.reduce((s, r) => s + r.tasks_completed, 0);
  const completionRate = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
  const mostOverdue = taskRows.reduce((best, r) => (!best || r.tasks_overdue > best.tasks_overdue ? r : best), null as TaskRow | null);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-midnight mb-6">Reports</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["tasks", "initiatives"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? "bg-midnight text-white" : "bg-white border border-pebble text-steel hover:text-midnight"}`}>
            {t === "tasks" ? "Task Report" : "Initiative Report"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-pebble p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-xs text-steel font-medium block mb-1">Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            className="h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean" />
        </div>
        <div>
          <label className="text-xs text-steel font-medium block mb-1">End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            className="h-10 px-3 border border-pebble rounded-lg text-sm focus:outline-none focus:border-ocean" />
        </div>
        <button onClick={generate} disabled={loading || !businessId}
          className="h-10 px-5 bg-midnight text-white text-sm font-semibold rounded-lg hover:opacity-90 disabled:opacity-50">
          {loading ? "Generating…" : "Generate Report"}
        </button>
        {(taskRows.length > 0 || initRows.length > 0) && (
          <button onClick={exportCsv}
            className="h-10 px-5 border border-pebble text-steel text-sm font-medium rounded-lg hover:text-midnight hover:border-midnight transition-colors">
            ⬇ Export CSV
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

      {/* Summary cards */}
      {tab === "tasks" && taskRows.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-pebble p-4 text-center">
            <p className="text-3xl font-bold text-midnight">{totalTasks}</p>
            <p className="text-xs text-steel mt-1">Total Tasks</p>
          </div>
          <div className="bg-white rounded-xl border border-pebble p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{completionRate}%</p>
            <p className="text-xs text-steel mt-1">Completion Rate</p>
          </div>
          <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center">
            <p className="text-3xl font-bold text-red-600">{mostOverdue?.user_name ?? "—"}</p>
            <p className="text-xs text-steel mt-1">Most Overdue Stakeholder</p>
          </div>
        </div>
      )}

      {/* Task Report Table */}
      {tab === "tasks" && taskRows.length > 0 && (
        <div className="bg-white rounded-xl border border-pebble overflow-x-auto">
          <table className="w-full text-sm min-w-[540px]">
            <thead className="bg-mist">
              <tr>
                {["Stakeholder", "Tasks Owned", "Completed", "Overdue", "Blocked", "Avg Days"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-steel uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-pebble">
              {taskRows.map(r => (
                <tr key={r.user_id} className="hover:bg-mist/50">
                  <td className="px-4 py-3 font-medium text-midnight">{r.user_name}</td>
                  <td className="px-4 py-3 text-steel">{r.tasks_owned}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{r.tasks_completed}</td>
                  <td className="px-4 py-3">
                    {r.tasks_overdue > 0
                      ? <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">{r.tasks_overdue}</span>
                      : <span className="text-steel">0</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.tasks_blocked > 0
                      ? <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium">{r.tasks_blocked}</span>
                      : <span className="text-steel">0</span>}
                  </td>
                  <td className="px-4 py-3 text-steel">{r.avg_completion_days != null ? `${r.avg_completion_days.toFixed(1)}d` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Initiative Report Table */}
      {tab === "initiatives" && initRows.length > 0 && (
        <div className="bg-white rounded-xl border border-pebble overflow-x-auto">
          <table className="w-full text-sm min-w-[540px]">
            <thead className="bg-mist">
              <tr>
                {["Initiative", "Total Tasks", "Done", "Completion %", "Overdue", "Blocked"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-steel uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-pebble">
              {initRows.map(r => (
                <tr key={r.initiative_id} className="hover:bg-mist/50">
                  <td className="px-4 py-3 font-medium text-midnight">{r.initiative_title}</td>
                  <td className="px-4 py-3 text-steel">{r.total_tasks}</td>
                  <td className="px-4 py-3 text-green-600 font-medium">{r.done_tasks}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-pebble rounded-full h-1.5 max-w-20">
                        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${r.completion_pct}%` }} />
                      </div>
                      <span className="text-xs text-steel">{r.completion_pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {r.overdue_count > 0
                      ? <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">{r.overdue_count}</span>
                      : <span className="text-steel">0</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.blocked_count > 0
                      ? <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-medium">{r.blocked_count}</span>
                      : <span className="text-steel">0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(taskRows.length === 0 && initRows.length === 0 && !loading) && (
        <div className="bg-white rounded-xl border border-pebble p-16 text-center text-steel">
          Select a date range and click Generate Report
        </div>
      )}
    </div>
  );
}
