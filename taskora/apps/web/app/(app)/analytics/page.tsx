"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";
async function apiFetch(path: string) {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data } = await supabase.auth.refreshSession();
    session = data.session;
  }
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

type MyPerf = {
  avg_tat_hours?: number; tasks_completed?: number; decisions_made?: number;
  overdue_count?: number; stale_count?: number; blocked_count?: number; delegation_count?: number;
};
type EntityProgress = { entity_id: string; entity_name: string; completion_pct: number; total: number; done: number; blocked: number };
type BizAnalytics = {
  total_tasks?: number; completed_count?: number; stale_count?: number;
  blocked_count?: number; pending_decision_count?: number; entity_progress?: EntityProgress[];
};

function MetricCard({ label, value, variant = "normal" }: {
  label: string; value: string | number; variant?: "normal" | "warn" | "danger";
}) {
  const bg = variant === "danger" ? "bg-red-50 border-red-200"
    : variant === "warn" ? "bg-amber-50 border-amber-200"
    : "bg-white border-pebble";
  const vc = variant === "danger" ? "text-red-700"
    : variant === "warn" ? "text-amber-700"
    : "text-midnight";
  return (
    <div className={`rounded-xl border p-5 ${bg}`}>
      <p className="text-xs font-semibold text-steel uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-4xl font-extrabold ${vc}`}>{value}</p>
    </div>
  );
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<"my" | "business">("my");
  const [days, setDays] = useState(30);
  const [myPerf, setMyPerf] = useState<MyPerf | null>(null);
  const [bizData, setBizData] = useState<BizAnalytics | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/businesses/")
      .then((data: { id: string }[]) => { if (data?.length) setBusinessId(data[0].id); })
      .catch(() => {});
  }, []);

  const loadMyPerf = useCallback(async () => {
    setLoading(true); setError("");
    try { setMyPerf(await apiFetch(`/api/v1/analytics/my-performance?days=${days}`)); }
    catch { setError("Failed to load analytics."); }
    finally { setLoading(false); }
  }, [days]);

  const loadBiz = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError("");
    try { setBizData(await apiFetch(`/api/v1/analytics/business/${businessId}?days=${days}`)); }
    catch { setError("Failed to load business analytics."); }
    finally { setLoading(false); }
  }, [businessId, days]);

  useEffect(() => {
    if (tab === "my") loadMyPerf(); else loadBiz();
  }, [tab, days, loadMyPerf, loadBiz]);

  const fmt = (v: number | undefined) => v == null ? "—" : String(v);

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-2xl font-bold text-midnight mb-6">Analytics</h1>

      <div className="flex gap-4 sm:gap-6 border-b border-pebble mb-8">
        {(["my", "business"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors ${
              tab === t ? "border-taskora-red text-taskora-red" : "border-transparent text-steel hover:text-midnight"
            }`}>
            {t === "my" ? "My Performance" : "Business Overview"}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-8">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              days === d ? "bg-taskora-red text-white" : "bg-white border border-pebble text-steel hover:text-midnight"
            }`}>
            {d}d
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin"/>
        </div>
      )}
      {error && <div className="text-red-600 text-sm p-4 bg-red-50 rounded-xl border border-red-200">{error}</div>}

      {!loading && tab === "my" && myPerf && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <MetricCard label="Avg TAT (hours)" value={fmt(myPerf.avg_tat_hours)}/>
            <MetricCard label="Tasks Completed" value={fmt(myPerf.tasks_completed)}/>
            <MetricCard label="Decisions Made" value={fmt(myPerf.decisions_made)}/>
            <MetricCard label="Overdue" value={fmt(myPerf.overdue_count)} variant="danger"/>
            <MetricCard label="Stale Tasks" value={fmt(myPerf.stale_count)} variant="warn"/>
            <MetricCard label="Blocked" value={fmt(myPerf.blocked_count)} variant="danger"/>
          </div>
          {(myPerf.delegation_count ?? 0) > 0 && (
            <div className="bg-white border border-pebble rounded-xl p-5 inline-block">
              <p className="text-xs font-semibold text-steel uppercase tracking-wider mb-1">Delegations Sent</p>
              <p className="text-4xl font-extrabold text-midnight">{myPerf.delegation_count}</p>
            </div>
          )}
        </div>
      )}

      {!loading && tab === "business" && (
        <>
          {!businessId && <p className="text-steel text-sm">No business found. Complete onboarding first.</p>}
          {bizData && (
            <div className="space-y-10">
              <div>
                <h2 className="text-base font-semibold text-midnight mb-4">Business-wide Metrics</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <MetricCard label="Total Tasks" value={fmt(bizData.total_tasks)}/>
                  <MetricCard label="Completed" value={fmt(bizData.completed_count)}/>
                  <MetricCard label="Pending Decisions" value={fmt(bizData.pending_decision_count)} variant="warn"/>
                  <MetricCard label="Stale Tasks" value={fmt(bizData.stale_count)} variant="warn"/>
                  <MetricCard label="Blocked" value={fmt(bizData.blocked_count)} variant="danger"/>
                </div>
              </div>
              {bizData.entity_progress && bizData.entity_progress.length > 0 && (
                <div>
                  <h2 className="text-base font-semibold text-midnight mb-4">Entity Progress</h2>
                  <div className="bg-white border border-pebble rounded-xl overflow-x-auto">
                    <table className="w-full text-sm min-w-[400px]">
                      <thead className="bg-mist border-b border-pebble">
                        <tr>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-steel uppercase tracking-wider">Entity</th>
                          <th className="text-left px-5 py-3 text-xs font-semibold text-steel uppercase tracking-wider">Completion</th>
                          <th className="px-5 py-3 w-48"/>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-pebble">
                        {bizData.entity_progress.map(ep => {
                          const pct = Math.round(ep.completion_pct ?? 0);
                          const color = pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-taskora-red";
                          return (
                            <tr key={ep.entity_id} className="hover:bg-mist/50">
                              <td className="px-5 py-3 font-medium text-midnight">{ep.entity_name}</td>
                              <td className="px-5 py-3 text-steel font-mono">{pct}%</td>
                              <td className="px-5 py-3">
                                <div className="h-2 bg-pebble rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }}/>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
