"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import {
  GanttSVG, GanttRow,
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
  baseline_start?: string | null;
  baseline_end?: string | null;
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
  const router = useRouter();
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
  // Group-by: programme swimlanes (default) OR building/client swimlanes where a
  // site's tasks run in sequence on one lane.
  const [groupBy, setGroupBy] = useState<"programme" | "building" | "client">("programme");
  const [sites, setSites] = useState<{ id: string; name: string; tasks: { id: string; task_id: string; title: string; status?: string | null; start_date?: string | null; end_date?: string | null; depends_on?: string[] }[] }[]>([]);

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

  // Auto-fit the visible window to the data on first load. Without this the
  // window is pinned to the current year, so initiatives dated in other years
  // render off-window and the chart looks empty ("vanishes"). Runs once; the
  // year/horizon controls still let the user override afterwards.
  const [autoFitted, setAutoFitted] = useState(false);
  useEffect(() => {
    if (autoFitted || !data) return;
    const yrs: number[] = [];
    for (const l of data.programs) {
      for (const i of l.initiatives) {
        if (i.start_date) yrs.push(new Date(i.start_date).getFullYear());
        if (i.end_date) yrs.push(new Date(i.end_date).getFullYear());
      }
    }
    if (yrs.length) {
      const maxY = Math.max(...yrs);
      // Anchor on NOW and look forward — that's where pending + upcoming work
      // is. Only fall back to the latest year when everything is already past.
      const startY = maxY < thisYear ? maxY : thisYear;
      setAnchorYear(startY);
      setYears(Math.min(3, Math.max(1, maxY - startY + 1)));
    }
    setAutoFitted(true);
  }, [data, autoFitted]);

  // Lazy-load an initiative's FULL subtree on first expand — task → attribute
  // (subtask) → sub-subtask. Kept raw (original depth + parent_id) so the
  // render can reveal it level-by-level.
  const loadInitiative = useCallback(async (initId: string) => {
    setLoadingInits((s) => new Set(s).add(initId));
    try {
      const g = await ganttApiFetch(`/api/v1/initiatives/${initId}/gantt`);
      const rows: GanttRow[] = (g?.rows ?? [])
        .filter((r: GanttRow) =>
          r.kind === "task" || r.kind === "subtask" || r.kind === "entity" || r.kind === "entity-lane");
      setInitRows((m) => ({ ...m, [initId]: rows }));
    } catch {
      setInitRows((m) => ({ ...m, [initId]: [] }));
    } finally {
      setLoadingInits((s) => { const n = new Set(s); n.delete(initId); return n; });
    }
  }, []);

  // Load site (building/client) lanes when grouping by site.
  const loadSites = useCallback(async (kind: "building" | "client") => {
    let bizId = typeof window !== "undefined" ? localStorage.getItem("business_id") ?? "" : "";
    if (!bizId) return;
    try {
      const d = await ganttApiFetch(`/api/v1/programs/sites-gantt?business_id=${encodeURIComponent(bizId)}&kind=${kind}`);
      setSites(Array.isArray(d?.sites) ? d.sites : []);
    } catch { setSites([]); }
  }, []);
  useEffect(() => {
    if (groupBy === "building" || groupBy === "client") loadSites(groupBy);
  }, [groupBy, loadSites]);

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

  // rowMeta lets onBarChange route a drag to the right entity + endpoint.
  type RowMeta = { kind: "initiative" | "task" | "subtask" | "entity" | "lane"; initiativeId: string; taskId?: string; entityId?: string; programId?: string };
  const { rows, rowMeta } = useMemo<{ rows: GanttRow[]; rowMeta: Map<string, RowMeta> }>(() => {
    const out: GanttRow[] = [];
    const meta = new Map<string, RowMeta>();

    // Site swimlanes: each building/client is a lane; its tasks run in sequence
    // with dependency arrows between sibling bars.
    if (groupBy !== "programme") {
      for (const site of sites) {
        const collapsed = collapsedPrograms.has(site.id);
        out.push({
          id: `${LANE_PREFIX}${site.id}`, kind: "task", depth: 0,
          title: `${site.name}  (${site.tasks.length})`, is_milestone: false, entities: [],
          toggleable: true, open: !collapsed,
        });
        if (collapsed) continue;
        for (const b of site.tasks) {
          out.push({
            id: b.id, kind: "task", depth: 1, title: b.title,
            status: b.status ?? undefined, start_date: b.start_date, end_date: b.end_date,
            depends_on: b.depends_on ?? [], is_milestone: false, entities: [],
          });
          meta.set(b.id, { kind: "entity", initiativeId: "", taskId: b.task_id, entityId: site.id });
        }
      }
      return { rows: out, rowMeta: meta };
    }

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
        meta.set(it.id, { kind: "initiative", initiativeId: it.id, programId: laneId !== "none" ? laneId : undefined });
        out.push({
          id: it.id, kind: "task", depth: 1,
          title: it.primary_stakeholder_name ? `${it.title}  ·  ${it.primary_stakeholder_name}` : it.title,
          status: healthStatus(it),
          start_date: it.start_date, end_date: it.end_date,
          baseline_start: it.baseline_start, baseline_end: it.baseline_end,
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
                meta.set(child.id,
                  child.kind === "entity-lane"
                    ? { kind: "lane", initiativeId: it.id, entityId: child.entity_id ?? undefined }
                    : child.kind === "entity"
                    ? { kind: "entity", initiativeId: it.id, taskId: child.parent_id ?? undefined, entityId: child.entity_id ?? undefined }
                    : { kind: child.kind === "subtask" ? "subtask" : "task", initiativeId: it.id, taskId: child.id });
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
    return { rows: out, rowMeta: meta };
  }, [groupBy, sites, lanes, ownerFilter, initiativeFilter, collapsedPrograms, expandedInits, expandedNodes, initRows, loadingInits]);

  const { start, end } = useMemo(() => ganttRangeMonths(anchorYear, years), [anchorYear, years]);

  // Drag-reschedule any bar → persist its real dates and log the change as
  // "via timeline" (who is captured server-side). Routes by row kind.
  const REASON = "Rescheduled from the timeline";
  const onBarChange = useCallback(async (id: string, startISO: string, endISO: string) => {
    const m = rowMeta.get(id);
    if (!m) return;

    if (m.kind === "initiative") {
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
      } catch { setError("Couldn't save the new dates — reverting."); load(); }
      return;
    }

    // Task / building bar — optimistically move it within its initiative's
    // loaded subtree, then PATCH the real dates.
    setInitRows((prev) => {
      const list = prev[m.initiativeId];
      if (!list) return prev;
      return {
        ...prev,
        [m.initiativeId]: list.map((r) =>
          r.id === id ? { ...r, start_date: startISO, end_date: endISO } : r),
      };
    });
    try {
      if (m.kind === "task" && m.taskId) {
        await ganttApiFetch(`/api/v1/tasks/${m.taskId}`, {
          method: "PATCH",
          body: JSON.stringify({ start_date: startISO, due_date: endISO, change_reason: REASON }),
        });
      } else if (m.kind === "entity" && m.taskId && m.entityId) {
        await ganttApiFetch(`/api/v1/tasks/${m.taskId}/entities/${m.entityId}`, {
          method: "PATCH",
          body: JSON.stringify({ per_entity_start_date: startISO, per_entity_end_date: endISO, change_reason: REASON }),
        });
        // In site-swimlane mode the bar lives in `sites`, not initRows — refresh.
        if (!m.initiativeId && (groupBy === "building" || groupBy === "client")) loadSites(groupBy);
      }
    } catch {
      setError("Couldn't save the new dates — reverting.");
      if (m.initiativeId) loadInitiative(m.initiativeId);
      else if (groupBy === "building" || groupBy === "client") loadSites(groupBy);
    }
  }, [rowMeta, load, loadInitiative, groupBy, loadSites]);

  const canDragRow = useCallback(
    (row: GanttRow) => {
      if (!isAdmin || row.is_milestone || !row.start_date || !row.end_date) return false;
      const m = rowMeta.get(row.id);
      return !!m && (m.kind === "initiative" || m.kind === "task" || m.kind === "entity");
    },
    [isAdmin, rowMeta],
  );

  // Draw-to-link: only admins, only task-backed bars (site bars + subtree
  // tasks); the target depends on the source.
  const canLinkRow = useCallback((row: GanttRow) => {
    if (!isAdmin || row.is_milestone) return false;
    const m = rowMeta.get(row.id);
    return !!m && (m.kind === "task" || m.kind === "entity") && !!m.taskId;
  }, [isAdmin, rowMeta]);

  const onLinkCreate = useCallback(async (fromId: string, toId: string) => {
    const from = rowMeta.get(fromId);
    const to = rowMeta.get(toId);
    if (!from?.taskId || !to?.taskId || from.taskId === to.taskId) return;
    try {
      const cur = await ganttApiFetch(`/api/v1/tasks/${to.taskId}/dependencies`);
      const ids = new Set<string>((cur?.depends_on ?? []).map((d: { id: string }) => d.id));
      if (ids.has(from.taskId)) return; // already linked
      ids.add(from.taskId);
      await ganttApiFetch(`/api/v1/tasks/${to.taskId}/dependencies`, {
        method: "PATCH", body: JSON.stringify({ depends_on: Array.from(ids) }),
      });
      if (groupBy === "programme") { if (to.initiativeId) loadInitiative(to.initiativeId); }
      else loadSites(groupBy);
    } catch {
      setError("Couldn't create that dependency.");
    }
  }, [rowMeta, groupBy, loadInitiative, loadSites]);

  // Clicking a row label opens that item's full detail — where dependencies,
  // prerequisites (task deps), attachments, comments, watchers, approvers and
  // sub-tasks are managed. The timeline is the launchpad to every feature.
  const onRowClick = useCallback((row: GanttRow) => {
    const m = rowMeta.get(row.id);
    if (!m) return;
    if (m.kind === "lane") {
      toggleRow(row.id); // a building/client lane: click to expand/collapse
      return;
    }
    if (m.kind === "initiative") {
      if (m.programId) router.push(`/programs/${m.programId}`);
    } else if (m.kind === "subtask") {
      router.push(`/tasks?subtask=${m.taskId}`);
    } else if (m.taskId) {
      router.push(`/tasks?task=${m.taskId}`);
    }
  }, [rowMeta, router]);

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

        {!embedded && (
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "programme" | "building" | "client")}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red">
            <option value="programme">Group: Programme</option>
            <option value="building">Group: Building</option>
            <option value="client">Group: Client</option>
          </select>
        )}
        {groupBy === "programme" && !embedded && programOptions.length > 0 && (
          <select value={programFilter} onChange={(e) => { setProgramFilter(e.target.value); setInitiativeFilter(""); }}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red">
            <option value="">All programs</option>
            {programOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {groupBy === "programme" && (
          <select value={initiativeFilter} onChange={(e) => setInitiativeFilter(e.target.value)}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red max-w-[180px]">
            <option value="">All initiatives</option>
            {initiativeOptions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
        {groupBy === "programme" && (
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
            className="bg-white border border-pebble text-midnight text-sm rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-taskora-red max-w-[150px]">
            <option value="">Everyone</option>
            {(data?.members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || "Unnamed"}</option>)}
          </select>
        )}
      </div>

      {/* Chart */}
      <div className={`bg-white rounded-xl border border-pebble overflow-x-auto ${embedded ? "" : "shadow-sm"}`}>
        {(groupBy === "programme" ? totalInitiatives === 0 : sites.length === 0) ? (
          <div className="flex flex-col items-center justify-center py-16 text-steel">
            <Layers className="w-10 h-10 opacity-20 mb-3" />
            <p className="text-sm">
              {groupBy === "programme"
                ? "No initiatives to plan yet."
                : `No ${groupBy}s with scheduled work yet.`}
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-steel py-10 text-sm">Nothing matches these filters.</p>
        ) : (
          <GanttSVG
            rows={rows} ganttStart={start} ganttEnd={end} scale="month"
            onBarChange={onBarChange} canDragRow={canDragRow} onToggle={toggleRow}
            onRowClick={onRowClick} onLinkCreate={onLinkCreate} canLinkRow={canLinkRow}
          />
        )}
      </div>

      <p className="mt-2 text-[11px] text-steel/70">
        Click ▸ to expand a programme → initiatives → tasks → buildings &amp; sub-tasks. Click a name to open it
        (dependencies, attachments, comments &amp; more live there).
        {isAdmin ? " Drag a bar to reschedule — the real dates update and the change is logged." : " Only admins can drag to reschedule."}
      </p>
    </div>
  );
}
