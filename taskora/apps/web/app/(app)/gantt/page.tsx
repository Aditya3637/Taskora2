"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Layers } from "lucide-react";
import {
  GanttSVG, GanttData, GanttRow, MILESTONE_COLOR,
  ganttApiFetch, ganttRange,
} from "./GanttChart";

type Initiative = { id: string; name?: string; title?: string };

function GanttPageInner() {
  const searchParams = useSearchParams();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingGantt, setLoadingGantt] = useState(false);
  const [error, setError] = useState("");
  const [fullPortfolio, setFullPortfolio] = useState(false);
  const [portfolioRows, setPortfolioRows] = useState<GanttRow[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);

  const loadInitiatives = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
      if (!bizId) {
        const biz = await ganttApiFetch("/api/v1/businesses/my");
        if (!biz?.id) throw new Error("No business");
        bizId = biz.id;
        localStorage.setItem("business_id", bizId);
      }
      const data = await ganttApiFetch(`/api/v1/initiatives/business/${bizId}`);
      setInitiatives(Array.isArray(data) ? data : data.results ?? []);
    } catch {
      setError("Failed to load initiatives.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitiatives(); }, [loadInitiatives]);

  // Preselect from ?initiative=<id> (e.g. arriving from an initiative card).
  useEffect(() => {
    const qp = searchParams.get("initiative");
    if (qp) setSelectedId(qp);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingGantt(true);
    setGanttData(null);
    setFullPortfolio(false);
    ganttApiFetch(`/api/v1/initiatives/${selectedId}/gantt`)
      .then(setGanttData)
      .catch(() => setError("Failed to load Gantt data."))
      .finally(() => setLoadingGantt(false));
  }, [selectedId]);

  async function handleFullPortfolio() {
    setFullPortfolio(true);
    setLoadingPortfolio(true);
    try {
      const all: GanttRow[] = [];
      for (const init of initiatives) {
        try {
          const data: GanttData = await ganttApiFetch(`/api/v1/initiatives/${init.id}/gantt`);
          const label = init.name ?? init.title ?? init.id;
          all.push({
            id: `__init__${init.id}`, kind: "milestone", depth: 0,
            title: `📁 ${label}`, is_milestone: false, entities: [],
          } as GanttRow);
          (data.rows ?? []).forEach((r) => all.push(r));
        } catch { /* skip */ }
      }
      setPortfolioRows(all);
    } finally {
      setLoadingPortfolio(false);
    }
  }

  const activeRows = fullPortfolio ? portfolioRows : (ganttData?.rows ?? []);
  const { start: ganttStart, end: ganttEnd } = ganttRange(
    activeRows,
    fullPortfolio ? null : ganttData?.start_date,
    fullPortfolio ? null : ganttData?.end_date,
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Gantt Chart</h1>
          <p className="text-steel text-sm mt-1">Planned timeline for an initiative — tasks, subtasks &amp; entities</p>
        </div>
        <button onClick={handleFullPortfolio} disabled={initiatives.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-midnight text-white rounded-lg text-sm font-semibold hover:bg-midnight/80 transition-colors disabled:opacity-40">
          <Layers className="w-4 h-4" />
          Full Portfolio
        </button>
      </div>

      {error && <p className="mb-4 text-red-600 text-sm">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start gap-3">
            <div className="relative w-full sm:w-auto">
              <select value={fullPortfolio ? "" : selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setFullPortfolio(false); }}
                className="appearance-none bg-white border border-pebble text-midnight text-sm rounded-lg pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-taskora-red/30 focus:border-taskora-red w-full sm:min-w-[260px]">
                <option value="">Select an initiative…</option>
                {initiatives.map((i) => (
                  <option key={i.id} value={i.id}>{i.name ?? i.title}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-steel pointer-events-none" />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-steel">
              {[
                { label: "Done", color: "#38A169" },
                { label: "In Progress", color: "#3182CE" },
                { label: "Blocked", color: "#E53E3E" },
                { label: "Pending Decision", color: "#D69E2E" },
                { label: "Milestone", color: MILESTONE_COLOR },
                { label: "Other", color: "#A0AEC0" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {fullPortfolio && (
            <div className="bg-white rounded-xl border border-pebble shadow-sm overflow-x-auto">
              <div className="px-5 py-3 border-b border-pebble bg-mist/30">
                <h2 className="font-semibold text-midnight text-sm">Full Portfolio Timeline</h2>
              </div>
              {loadingPortfolio ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
                </div>
              ) : portfolioRows.length === 0 ? (
                <p className="text-center text-steel py-12 text-sm">No tasks found across initiatives.</p>
              ) : (
                <GanttSVG rows={portfolioRows} ganttStart={ganttStart} ganttEnd={ganttEnd} />
              )}
            </div>
          )}

          {!fullPortfolio && (
            <div className="bg-white rounded-xl border border-pebble shadow-sm overflow-x-auto">
              {!selectedId ? (
                <div className="flex flex-col items-center justify-center py-24 text-steel">
                  <Layers className="w-12 h-12 opacity-20 mb-4" />
                  <p className="text-sm">Select an initiative to view the Gantt chart</p>
                </div>
              ) : loadingGantt ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
                </div>
              ) : ganttData && (ganttData.rows ?? []).length === 0 ? (
                <p className="text-center text-steel py-12 text-sm">No tasks in this initiative yet.</p>
              ) : ganttData ? (
                <GanttSVG rows={ganttData.rows ?? []} ganttStart={ganttStart} ganttEnd={ganttEnd} />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function GanttPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    }>
      <GanttPageInner />
    </Suspense>
  );
}
