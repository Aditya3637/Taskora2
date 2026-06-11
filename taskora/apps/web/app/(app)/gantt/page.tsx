"use client";
import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Layers, Info } from "lucide-react";
import {
  GanttSVG, GanttRow, GanttModal, MILESTONE_COLOR,
  ganttApiFetch, ganttRangeMonths,
} from "./GanttChart";

type InitiativeBar = {
  id: string;
  title: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  primary_stakeholder_id?: string | null;
  primary_stakeholder_name?: string;
  impact_category?: string | null;
  health?: string;
  depends_on?: string[];
};
type ProgramMilestone = {
  id: string;
  name: string;
  date?: string | null;
  completed?: boolean;
};
type Lane = {
  id: string | null;
  name: string;
  color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  initiatives: InitiativeBar[];
  milestones?: ProgramMilestone[];
};
type WorkspaceGantt = { programs: Lane[]; members: { id: string; name: string }[] };

// Map an initiative's status + health to one of the chart's bar colours:
//   done/completed → green · overdue → red · at-risk → amber ·
//   on-track active → blue · not started → grey.
function healthStatus(it: InitiativeBar): string | undefined {
  if (it.status === "done" || it.status === "completed") return "done";
  if (it.health === "red") return "blocked";
  if (it.health === "amber") return "pending_decision";
  if (it.health === "green") return "in_progress";
  return undefined;
}

const HORIZON_LEGEND = [
  { label: "On track", color: "#3182CE" },
  { label: "At risk", color: "#D69E2E" },
  { label: "Overdue", color: "#E53E3E" },
  { label: "Done", color: "#38A169" },
  { label: "Not started", color: "#A0AEC0" },
  { label: "Milestone", color: MILESTONE_COLOR },
];

function GanttPageInner() {
  const [businessId, setBusinessId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [data, setData] = useState<WorkspaceGantt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const thisYear = new Date().getFullYear();
  const [anchorYear, setAnchorYear] = useState(thisYear);
  const [years, setYears] = useState(1);
  const [userFilter, setUserFilter] = useState("");
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
      try {
        const url = bizId
          ? `/api/v1/businesses/my?prefer=${encodeURIComponent(bizId)}`
          : "/api/v1/businesses/my";
        const biz = await ganttApiFetch(url);
        if (biz?.id) { bizId = biz.id; localStorage.setItem("business_id", bizId); }
      } catch { /* fall back to cached id */ }
      if (!bizId) throw new Error("No business");
      setBusinessId(bizId);

      const [gantt, role] = await Promise.all([
        ganttApiFetch(`/api/v1/programs/workspace-gantt?business_id=${encodeURIComponent(bizId)}`),
        ganttApiFetch(`/api/v1/businesses/${bizId}/my-role`).catch(() => ({ role: "member" })),
      ]);
      setData({ programs: gantt?.programs ?? [], members: gantt?.members ?? [] });
      setIsAdmin(role?.role === "owner" || role?.role === "admin");
    } catch {
      setError("Failed to load the program timeline.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Preserve the legacy deep-link: /gantt?initiative=<id> opens that
  // initiative's detailed timeline (used by the per-initiative Gantt icon).
  const searchParams = useSearchParams();
  useEffect(() => {
    const qp = searchParams.get("initiative");
    if (qp) setDrill({ id: qp, name: "" });
  }, [searchParams]);

  // ?program=<id> scopes the view to a single program (opened from the
  // Programs section); absent → the whole workspace.
  const programScope = searchParams.get("program");
  const scopedLane = useMemo(
    () => (programScope && data
      ? data.programs.find((l) => String(l.id) === programScope) ?? null
      : null),
    [programScope, data],
  );

  // Flatten the lanes into program-header + initiative rows, honouring the
  // program scope and the primary-user filter (hide lanes that end up empty).
  const rows = useMemo<GanttRow[]>(() => {
    if (!data) return [];
    const out: GanttRow[] = [];
    for (const lane of data.programs) {
      if (programScope && String(lane.id) !== programScope) continue;
      const inits = userFilter
        ? lane.initiatives.filter((i) => i.primary_stakeholder_id === userFilter)
        : lane.initiatives;
      if (userFilter && inits.length === 0) continue;
      out.push({
        id: `lane:${lane.id ?? "none"}`, kind: "task", depth: 0,
        title: lane.name, is_milestone: false, entities: [],
      });
      // Program milestones as diamonds on the lane (skip under a user filter,
      // where the lane only shows one owner's slice).
      if (!userFilter) {
        for (const m of lane.milestones ?? []) {
          if (!m.date) continue;
          out.push({
            id: `ms:${m.id}`, kind: "milestone", depth: 1,
            title: m.name, end_date: m.date, is_milestone: true, entities: [],
          });
        }
      }
      for (const it of inits) {
        out.push({
          id: it.id, kind: "task", depth: 1,
          title: it.primary_stakeholder_name
            ? `${it.title}  ·  ${it.primary_stakeholder_name}`
            : it.title,
          status: healthStatus(it),
          start_date: it.start_date, end_date: it.end_date,
          is_milestone: false,
          // Dependency arrows resolve to other initiative rows by id.
          depends_on: it.depends_on ?? [],
          entities: [],
        });
      }
    }
    return out;
  }, [data, userFilter, programScope]);

  const { start, end } = useMemo(() => ganttRangeMonths(anchorYear, years), [anchorYear, years]);

  // Inline reschedule: drag/resize an initiative bar → PATCH its dates.
  const onBarChange = useCallback(async (id: string, startISO: string, endISO: string) => {
    setData((prev) => prev && ({
      ...prev,
      programs: prev.programs.map((l) => ({
        ...l,
        initiatives: l.initiatives.map((it) =>
          it.id === id ? { ...it, start_date: startISO, end_date: endISO } : it),
      })),
    }));
    try {
      await ganttApiFetch(`/api/v1/initiatives/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ start_date: startISO, target_end_date: endISO }),
      });
    } catch {
      setError("Couldn't save the new dates — reverting.");
      load();
    }
  }, [load]);

  const canDragRow = useCallback(
    (row: GanttRow) => isAdmin && row.depth === 1,
    [isAdmin],
  );

  const totalInitiatives = useMemo(
    () => (data?.programs ?? [])
      .filter((l) => !programScope || String(l.id) === programScope)
      .reduce((n, l) => n + l.initiatives.length, 0),
    [data, programScope],
  );

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div>
          {programScope && (
            <a href="/gantt"
              className="inline-flex items-center gap-1 text-xs text-steel hover:text-midnight mb-1 transition-colors">
              ← All programs
            </a>
          )}
          <h1 className="text-2xl font-bold text-midnight">
            {scopedLane ? `${scopedLane.name} — Timeline` : "Program Timeline"}
          </h1>
          <p className="text-steel text-sm mt-1">
            {scopedLane
              ? "This program's initiatives across the year — one bar each."
              : "Plan the year across every program — one bar per initiative."}
            {isAdmin && " Drag a bar to reschedule."}
          </p>
        </div>
      </div>

      {error && <p className="mb-4 text-red-600 text-sm">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Controls */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            {/* Horizon: anchor year + span */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-steel uppercase tracking-wider">From</label>
              <select value={anchorYear} onChange={(e) => setAnchorYear(Number(e.target.value))}
                className="bg-white border border-pebble text-midnight text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-taskora-red">
                {Array.from({ length: 6 }, (_, i) => thisYear - 1 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="inline-flex rounded-lg border border-pebble overflow-hidden">
              {[1, 2, 3].map((y) => (
                <button key={y} onClick={() => setYears(y)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    years === y ? "bg-midnight text-white" : "bg-white text-steel hover:bg-mist"
                  }`}>
                  {y} {y === 1 ? "year" : "years"}
                </button>
              ))}
            </div>

            {/* Primary-user filter */}
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-steel uppercase tracking-wider">Owner</label>
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)}
                className="bg-white border border-pebble text-midnight text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-taskora-red min-w-[150px]">
                <option value="">Everyone</option>
                {(data?.members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name || "Unnamed"}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-steel ml-auto">
              {HORIZON_LEGEND.map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="bg-white rounded-xl border border-pebble shadow-sm overflow-x-auto">
            {totalInitiatives === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-steel">
                <Layers className="w-12 h-12 opacity-20 mb-4" />
                <p className="text-sm">
                  {scopedLane
                    ? "This program has no initiatives yet."
                    : "No initiatives to plan yet — create one under a program."}
                </p>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-center text-steel py-12 text-sm">
                No initiatives for this owner.
              </p>
            ) : (
              <GanttSVG
                rows={rows}
                ganttStart={start}
                ganttEnd={end}
                scale="month"
                onBarChange={onBarChange}
                canDragRow={canDragRow}
                onRowClick={(row) => setDrill({ id: row.id, name: row.title.split("  ·  ")[0] })}
              />
            )}
          </div>

          <p className="mt-3 text-xs text-steel/70 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Click an initiative name to open its detailed task timeline.
            {!isAdmin && " Only workspace admins can drag to reschedule."}
          </p>
        </>
      )}

      {drill && (
        <GanttModal
          initiativeId={drill.id}
          initiativeName={drill.name}
          onClose={() => setDrill(null)}
        />
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
