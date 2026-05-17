"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  return { Authorization: `Bearer ${session.access_token}` };
}

async function apiFetch(path: string) {
  const res = await fetch(`${API}${path}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`${API}${path}`, { headers: await authHeader() });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
type PeopleRow = {
  user_id: string; user_name: string; tasks_owned: number; tasks_completed: number;
  tasks_overdue: number; tasks_blocked: number; avg_tat_days: number | null;
};
type InitRow = {
  initiative_id: string; initiative_name: string; status: string | null;
  total_tasks: number; done_tasks: number; completion_pct: number;
  overdue_count: number; blocked_count: number;
};
type ProgramBlock = {
  program_id: string | null; program_name: string; status: string | null;
  total_tasks: number; done_tasks: number; completion_pct: number;
  overdue_count: number; blocked_count: number; initiatives: InitRow[];
};

type Tab = "my" | "business" | "people" | "programs";

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

function pctColor(pct: number) {
  return pct >= 80 ? "bg-green-500" : pct >= 50 ? "bg-amber-400" : "bg-taskora-red";
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>("my");
  const [days, setDays] = useState(30);
  const [myPerf, setMyPerf] = useState<MyPerf | null>(null);
  const [bizData, setBizData] = useState<BizAnalytics | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Report-tab state
  const [startDate, setStartDate] = useState(() => fmtDate(new Date(Date.now() - 30 * 86400_000)));
  const [endDate, setEndDate] = useState(() => fmtDate(new Date()));
  const [peopleRows, setPeopleRows] = useState<PeopleRow[] | null>(null);
  const [programBlocks, setProgramBlocks] = useState<ProgramBlock[] | null>(null);
  const [exporting, setExporting] = useState(false);

  const isReport = tab === "people" || tab === "programs";

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

  const reportQs = useCallback(
    (fmt: "json" | "csv") =>
      `business_id=${businessId}&start_date=${startDate}&end_date=${endDate}&format=${fmt}`,
    [businessId, startDate, endDate],
  );

  const loadReport = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError("");
    try {
      if (tab === "people") {
        const r = await apiFetch(`/api/v1/analytics/reports/people?${reportQs("json")}`);
        setPeopleRows(r.rows ?? []);
      } else {
        const r = await apiFetch(`/api/v1/analytics/reports/programs?${reportQs("json")}`);
        setProgramBlocks(r.programs ?? []);
      }
    } catch { setError("Failed to load report."); }
    finally { setLoading(false); }
  }, [tab, businessId, reportQs]);

  useEffect(() => {
    if (tab === "my") loadMyPerf();
    else if (tab === "business") loadBiz();
    else loadReport();
  }, [tab, days, loadMyPerf, loadBiz, loadReport]);

  async function onExport() {
    if (!businessId) return;
    setExporting(true); setError("");
    try {
      const name = tab === "people" ? "people_report.csv" : "programs_report.csv";
      await downloadCsv(`/api/v1/analytics/reports/${tab}?${reportQs("csv")}`, name);
    } catch { setError("CSV export failed."); }
    finally { setExporting(false); }
  }

  const fmt = (v: number | undefined) => v == null ? "—" : String(v);

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <h1 className="text-2xl font-bold text-midnight mb-6">Analytics</h1>

      <div className="flex gap-4 sm:gap-6 border-b border-pebble mb-8 overflow-x-auto">
        {([
          ["my", "My Performance"],
          ["business", "Business Overview"],
          ["people", "People Report"],
          ["programs", "Programs Report"],
        ] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`pb-3 px-1 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t ? "border-taskora-red text-taskora-red" : "border-transparent text-steel hover:text-midnight"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {!isReport && (
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
      )}

      {isReport && (
        <div className="flex flex-wrap items-end gap-3 mb-8">
          <label className="flex flex-col text-xs font-semibold text-steel uppercase tracking-wider gap-1">
            From
            <input type="date" value={startDate} max={endDate}
              onChange={e => setStartDate(e.target.value)}
              className="rounded-lg border border-pebble px-3 py-1.5 text-sm text-midnight font-normal normal-case"/>
          </label>
          <label className="flex flex-col text-xs font-semibold text-steel uppercase tracking-wider gap-1">
            To
            <input type="date" value={endDate} min={startDate} max={fmtDate(new Date())}
              onChange={e => setEndDate(e.target.value)}
              className="rounded-lg border border-pebble px-3 py-1.5 text-sm text-midnight font-normal normal-case"/>
          </label>
          <button onClick={loadReport}
            className="px-4 py-2 rounded-lg bg-taskora-red text-white text-sm font-semibold hover:opacity-90">
            Apply
          </button>
          <button onClick={onExport} disabled={exporting || !businessId}
            className="px-4 py-2 rounded-lg border border-pebble bg-white text-sm font-semibold text-midnight hover:bg-mist disabled:opacity-50">
            {exporting ? "Exporting…" : "Download CSV"}
          </button>
          <p className="w-full text-xs text-steel">
            Completion is measured by when work was finished within this range. Owned / overdue / blocked counts are current totals.
          </p>
        </div>
      )}

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
                          return (
                            <tr key={ep.entity_id} className="hover:bg-mist/50">
                              <td className="px-5 py-3 font-medium text-midnight">{ep.entity_name}</td>
                              <td className="px-5 py-3 text-steel font-mono">{pct}%</td>
                              <td className="px-5 py-3">
                                <div className="h-2 bg-pebble rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${pctColor(pct)} transition-all`} style={{ width: `${pct}%` }}/>
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

      {!loading && tab === "people" && (
        <>
          {!businessId && <p className="text-steel text-sm">No business found. Complete onboarding first.</p>}
          {peopleRows && peopleRows.length === 0 && (
            <p className="text-steel text-sm">No stakeholder activity in this range.</p>
          )}
          {peopleRows && peopleRows.length > 0 && (
            <div className="bg-white border border-pebble rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-mist border-b border-pebble">
                  <tr>
                    {["Person", "Owned", "Completed", "Overdue", "Blocked", "Avg TAT (days)"].map((h, i) => (
                      <th key={h} className={`px-5 py-3 text-xs font-semibold text-steel uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-pebble">
                  {peopleRows.map(r => (
                    <tr key={r.user_id} className="hover:bg-mist/50">
                      <td className="px-5 py-3 font-medium text-midnight">{r.user_name}</td>
                      <td className="px-5 py-3 text-right text-steel font-mono">{r.tasks_owned}</td>
                      <td className="px-5 py-3 text-right text-green-700 font-mono">{r.tasks_completed}</td>
                      <td className={`px-5 py-3 text-right font-mono ${r.tasks_overdue ? "text-red-700" : "text-steel"}`}>{r.tasks_overdue}</td>
                      <td className={`px-5 py-3 text-right font-mono ${r.tasks_blocked ? "text-red-700" : "text-steel"}`}>{r.tasks_blocked}</td>
                      <td className="px-5 py-3 text-right text-steel font-mono">{r.avg_tat_days ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && tab === "programs" && (
        <>
          {!businessId && <p className="text-steel text-sm">No business found. Complete onboarding first.</p>}
          {programBlocks && programBlocks.length === 0 && (
            <p className="text-steel text-sm">No programs or initiatives yet.</p>
          )}
          {programBlocks && programBlocks.length > 0 && (
            <div className="space-y-6">
              {programBlocks.map(pb => (
                <div key={pb.program_id ?? "unassigned"} className="bg-white border border-pebble rounded-xl overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-mist border-b border-pebble">
                    <div>
                      <h2 className="text-base font-semibold text-midnight">{pb.program_name}</h2>
                      <p className="text-xs text-steel mt-0.5">
                        {pb.initiatives.length} initiative{pb.initiatives.length === 1 ? "" : "s"} ·
                        {" "}{pb.done_tasks}/{pb.total_tasks} tasks done ·
                        {" "}{pb.overdue_count} overdue · {pb.blocked_count} blocked
                      </p>
                    </div>
                    <div className="flex items-center gap-3 min-w-[160px]">
                      <span className="text-sm font-mono text-steel">{pb.completion_pct}%</span>
                      <div className="h-2 w-32 bg-pebble rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${pctColor(pb.completion_pct)}`} style={{ width: `${pb.completion_pct}%` }}/>
                      </div>
                    </div>
                  </div>
                  {pb.initiatives.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="border-b border-pebble">
                        <tr>
                          {["Initiative", "Status", "Done/Total", "Completion", "Overdue", "Blocked"].map((h, i) => (
                            <th key={h} className={`px-5 py-2.5 text-xs font-semibold text-steel uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-pebble">
                        {pb.initiatives.map(it => (
                          <tr key={it.initiative_id} className="hover:bg-mist/50">
                            <td className="px-5 py-3 font-medium text-midnight">{it.initiative_name}</td>
                            <td className="px-5 py-3 text-right text-steel capitalize">{(it.status ?? "").replace("_", " ") || "—"}</td>
                            <td className="px-5 py-3 text-right text-steel font-mono">{it.done_tasks}/{it.total_tasks}</td>
                            <td className="px-5 py-3 text-right font-mono text-steel">{it.completion_pct}%</td>
                            <td className={`px-5 py-3 text-right font-mono ${it.overdue_count ? "text-red-700" : "text-steel"}`}>{it.overdue_count}</td>
                            <td className={`px-5 py-3 text-right font-mono ${it.blocked_count ? "text-red-700" : "text-steel"}`}>{it.blocked_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="px-5 py-4 text-sm text-steel">No initiatives in this program.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
