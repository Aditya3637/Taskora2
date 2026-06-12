"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Layers } from "lucide-react";
import {
  GanttSVG, GanttRow, MILESTONE_COLOR,
  ganttApiFetch, ganttRangeMonths,
} from "./GanttChart";

export type InitiativeBar = {
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
export type ProgramMilestone = { id: string; name: string; date?: string | null; completed?: boolean };
export type Lane = {
  id: string | null;
  name: string;
  color?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  initiatives: InitiativeBar[];
  milestones?: ProgramMilestone[];
};
type WorkspaceGantt = { programs: Lane[]; members: { id: string; name: string }[] };

const LANE_PREFIX = "lane:";

// Initiative status + health → bar colour.
function healthStatus(it: InitiativeBar): string | undefined {
  if (it.status === "done" || it.status === "completed") return "done";
  if (it.health === "red") return "blocked";
  if (it.health === "amber") return "pending_decision";
  if (it.health === "green") return "in_progress";
  return undefined;
}

const LEGEND = [
  { label: "On track", color: "#3182CE" },
  { label: "At risk", color: "#D69E2E" },
  { label: "Overdue", color: "#E53E3E" },
  { label: "Done", color: "#38A169" },
  { label: "Not started", color: "#A0AEC0" },
  { label: "Milestone", color: MILESTONE_COLOR },
];

/**
 * Hierarchical program timeline: program swimlanes → initiative bars →
 * (expand) tasks → subtasks. Collapsible programs, expandable initiatives
 * (lazy-loaded), filters (program / initiative / owner), 1–3yr horizon, and
 * admin drag-reschedule. Used full-page (/gantt) and embedded (program page).
 */
export default function ProgramTimeline({
  programScope = null,
  embedded = false,
}: {
  programScope?: string | null;
  embedded?: boolean;
}) {
  const [data, setData] = useState<WorkspaceGantt | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const thisYear = new Date().getFullYear();
  const [anchorYear, setAnchorYear] = useState(thisYear);
  const [years, setYears] = useState(1);
  const [ownerFilter, setOwnerFilter] = useState("");
  // Seed the program filter from the URL scope so /gantt?program=<id> opens
  // pre-filtered but the dropdown still lets you switch programs.
  const [programFilter, setProgramFilter] = useState(programScope ?? "");
  const [initiativeFilter, setInitiativeFilter] = useState("");

  // Collapsed program lanes (hide initiatives) + expanded initiatives (show
  // tasks). Initiatives start collapsed; programs start expanded.
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const [expandedInits, setExpandedInits] = useState<Set<string>>(new Set());
  // Expanded task/subtask nodes WITHIN an initiative subtree (reveal children).
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [initRows, setInitRows] = useState<Record<string, GanttRow[]>>({});
  const [loadingInits, setLoadingInits] = useState<Set<string>>(new Set());

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

  // Lazy-load an initiative's FULL subtree on first expand — task → attribute
  // (subtask) → sub-subtask. Kept raw (original depth + parent_id) so the
  // render can reveal it level-by-level.
  const loadInitiative = useCallback(async (initId: string) => {
    setLoadingInits((s) => new Set(s).add(initId));
    try {
      const g = await ganttApiFetch(`/api/v1/initiatives/${initId}/gantt`);
      const rows: GanttRow[] = (g?.rows ?? [])
        .filter((r: GanttRow) =>
          r.kind === "task" || r.kind === "subtask" || r.kind === "entity");
      setInitRows((m) => ({ ...m, [initId]: rows }));
    } catch {
      setInitRows((m) => ({ ...m, [initId]: [] }));
    } finally {
      setLoadingInits((s) => { const n = new Set(s); n.delete(initId); return n; });
    }
  }, []);

  const initIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const l of data?.programs ?? []) for (const i of l.initiatives) s.add(i.id);
    return s;
  }, [data]);

  function toggleRow(rowId: string) {
    if (rowId.startsWith(LANE_PREFIX)) {
      const pid = rowId.slice(LANE_PREFIX.length);
      setCollapsedPrograms((s) => {
        const n = new Set(s);
        if (n.has(pid)) n.delete(pid); else n.add(pid);
        return n;
      });
      return;
    }
    if (initIdSet.has(rowId)) {
      // Initiative row → load + reveal its subtree.
      setExpandedInits((s) => {
        const n = new Set(s);
        if (n.has(rowId)) { n.delete(rowId); }
        else { n.add(rowId); if (!initRows[rowId]) loadInitiative(rowId); }
        return n;
      });
      return;
    }
    // Inner task/subtask node → reveal its children.
    setExpandedNodes((s) => {
      const n = new Set(s);
      if (n.has(rowId)) n.delete(rowId); else n.add(rowId);
      return n;
    });
  }

  // Embedded views are hard-scoped to their program; full-page views are
  // scoped by the program dropdown (seeded from the URL).
  const effectiveProgram = embedded ? programScope : (programFilter || null);
  const lanes = useMemo(() => {
    const all = data?.programs ?? [];
    return all.filter((l) => !effectiveProgram || String(l.id) === effectiveProgram);
  }, [data, effectiveProgram]);

  const rows = useMemo<GanttRow[]>(() => {
    const out: GanttRow[] = [];
    for (const lane of lanes) {
      const laneId = String(lane.id ?? "none");
      let inits = lane.initiatives;
      if (ownerFilter) inits = inits.filter((i) => i.primary_stakeholder_id === ownerFilter);
      if (initiativeFilter) inits = inits.filter((i) => i.id === initiativeFilter);
      if ((ownerFilter || initiativeFilter) && inits.length === 0) continue;

      const collapsed = collapsedPrograms.has(laneId);
      out.push({
        id: `${LANE_PREFIX}${laneId}`, kind: "task", depth: 0,
        title: `${lane.name}  (${inits.length})`, is_milestone: false, entities: [],
        toggleable: true, open: !collapsed,
      });
      if (collapsed) continue;

      if (!initiativeFilter) {
        for (const m of lane.milestones ?? []) {
          if (!m.date) continue;
          out.push({
            id: `ms:${m.id}`, kind: "milestone", depth: 1,
            title: m.name, end_date: m.date, is_milestone: true, entities: [],
          });
        }
      }
      for (const it of inits) {
        const expanded = expandedInits.has(it.id);
        out.push({
          id: it.id, kind: "task", depth: 1,
          title: it.primary_stakeholder_name ? `${it.title}  ·  ${it.primary_stakeholder_name}` : it.title,
          status: healthStatus(it),
          start_date: it.start_date, end_date: it.end_date,
          is_milestone: false, depends_on: it.depends_on ?? [], entities: [],
          toggleable: true, open: expanded, loading: loadingInits.has(it.id),
        });
        if (expanded) {
          const subtree = initRows[it.id];
          if (subtree && subtree.length) {
            // Group the initiative's rows by parent so we can reveal the tree
            // one level at a time. Top-level tasks have no parent_id.
            const byParent: Record<string, GanttRow[]> = {};
            for (const r of subtree) {
              const key = r.parent_id ?? "__root__";
              (byParent[key] ??= []).push(r);
            }
            const emit = (parentKey: string, depth: number) => {
              for (const child of byParent[parentKey] ?? []) {
                const hasKids = (byParent[child.id]?.length ?? 0) > 0;
                const open = expandedNodes.has(child.id);
                out.push({ ...child, depth, toggleable: hasKids, open });
                if (hasKids && open) emit(child.id, depth + 1);
              }
            };
            emit("__root__", 2);
          } else if (!loadingInits.has(it.id) && subtree) {
            out.push({ id: `${it.id}:empty`, kind: "task", depth: 2, title: "No tasks yet", entities: [] });
          }
        }
      }
    }
    return out;
  }, [lanes, ownerFilter, initiativeFilter, collapsedPrograms, expandedInits, expandedNodes, initRows, loadingInits]);

  const { start, end } = useMemo(() => ganttRangeMonths(anchorYear, years), [anchorYear, years]);

  const onBarChange = useCallback(async (id: string, startISO: string, endISO: string) => {
    // Only initiative bars are draggable; optimistic update then PATCH.
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
    (row: GanttRow) => isAdmin && row.depth === 1 && !row.is_milestone && !row.id.startsWith(LANE_PREFIX),
    [isAdmin],
  );

  // Filter dropdown options.
  const programOptions = useMemo(
    () => (data?.programs ?? []).filter((l) => l.id).map((l) => ({ id: String(l.id), name: l.name })),
    [data],
  );
  const initiativeOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = [];
    for (const l of lanes) for (const i of l.initiatives) opts.push({ id: i.id, name: i.title });
    return opts;
  }, [lanes]);

  const totalInitiatives = useMemo(
    () => lanes.reduce((n, l) => n + l.initiatives.length, 0),
    [lanes],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-3 text-red-600 text-sm">{error}</p>}

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-semibold text-steel uppercase tracking-wider">From</label>
          <select value={anchorYear} onChange={(e) => setAnchorYear(Number(e.target.value))}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red">
            {Array.from({ length: 6 }, (_, i) => thisYear - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="inline-flex rounded-lg border border-pebble overflow-hidden">
          {[1, 2, 3].map((y) => (
            <button key={y} onClick={() => setYears(y)}
              className={`px-2.5 py-1.5 text-sm font-medium transition-colors ${years === y ? "bg-midnight text-white" : "bg-white text-steel hover:bg-mist"}`}>
              {y}y
            </button>
          ))}
        </div>

        {!embedded && programOptions.length > 0 && (
          <select value={programFilter} onChange={(e) => { setProgramFilter(e.target.value); setInitiativeFilter(""); }}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red">
            <option value="">All programs</option>
            {programOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <select value={initiativeFilter} onChange={(e) => setInitiativeFilter(e.target.value)}
          className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red max-w-[180px]">
          <option value="">All initiatives</option>
          {initiativeOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
          className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red max-w-[150px]">
          <option value="">Everyone</option>
          {(data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || "Unnamed"}</option>)}
        </select>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-steel ml-auto">
          {LEGEND.map((s) => (
            <div key={s.label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className={`bg-white rounded-xl border border-pebble overflow-x-auto ${embedded ? "" : "shadow-sm"}`}>
        {totalInitiatives === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-steel">
            <Layers className="w-10 h-10 opacity-20 mb-3" />
            <p className="text-sm">No initiatives to plan yet.</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-steel py-10 text-sm">Nothing matches these filters.</p>
        ) : (
          <GanttSVG
            rows={rows} ganttStart={start} ganttEnd={end} scale="month"
            onBarChange={onBarChange} canDragRow={canDragRow} onToggle={toggleRow}
          />
        )}
      </div>

      <p className="mt-2 text-[11px] text-steel/70">
        Click ▸ to expand a program into initiatives, and an initiative into its tasks &amp; subtasks.
        {isAdmin ? " Drag an initiative bar to reschedule." : " Only admins can drag to reschedule."}
      </p>
    </div>
  );
}
