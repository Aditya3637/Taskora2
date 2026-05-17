"use client";
import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ChevronDown, Layers } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Session expired. Redirecting to login…");
  }
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Initiative = { id: string; name?: string; title?: string };
type GanttEntity = { type: "building" | "client"; name: string; end_date?: string | null };
type GanttRow = {
  id: string;
  kind: "task" | "subtask" | "entity" | "milestone";
  parent_id?: string | null;
  depth: number;
  title: string;
  status?: string | null;
  priority?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_milestone?: boolean;
  depends_on?: string[];
  entities?: GanttEntity[];
};
type GanttData = {
  initiative?: { id: string; title?: string; start_date?: string | null; end_date?: string | null };
  start_date?: string | null;
  end_date?: string | null;
  rows: GanttRow[];
};

const STATUS_COLOR: Record<string, string> = {
  done: "#38A169",
  completed: "#38A169",
  in_progress: "#3182CE",
  blocked: "#E53E3E",
  pending_decision: "#D69E2E",
};
const MILESTONE_COLOR = "#6B46C1";

function rowColor(row: GanttRow) {
  if (row.is_milestone) return MILESTONE_COLOR;
  return STATUS_COLOR[row.status ?? ""] ?? "#A0AEC0";
}

function parseDate(d?: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const KIND_ICON: Record<string, string> = {
  task: "▸",
  subtask: "•",
  entity: "—",
  milestone: "◆",
};

const LABEL_W = 280;
const ROW_H = 34;
const ROW_GAP = 4;
const HEADER_H = 40;
const DAY_W = 24;

interface TooltipState { x: number; y: number; row: GanttRow }

function entityLabel(row: GanttRow) {
  const ents = row.entities ?? [];
  if (ents.length === 0) return "";
  const shown = ents
    .slice(0, 2)
    .map((e) => `${e.type === "building" ? "🏢" : "👤"}${e.name}`)
    .join(" ");
  return ents.length > 2 ? `${shown} +${ents.length - 2}` : shown;
}

function GanttSVG({ rows, ganttStart, ganttEnd }: { rows: GanttRow[]; ganttStart: Date; ganttEnd: Date }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const totalDays = Math.max(1, Math.ceil((ganttEnd.getTime() - ganttStart.getTime()) / 86400000));
  const svgW = LABEL_W + totalDays * DAY_W;
  const svgH = HEADER_H + rows.length * (ROW_H + ROW_GAP) + 20;

  const today = new Date();
  const todayOffset = Math.ceil((today.getTime() - ganttStart.getTime()) / 86400000);

  const idToIdx: Record<string, number> = {};
  rows.forEach((r, i) => { idToIdx[r.id] = i; });

  function dayX(date: Date) {
    const d = Math.ceil((date.getTime() - ganttStart.getTime()) / 86400000);
    return LABEL_W + d * DAY_W;
  }
  function rowY(i: number) {
    return HEADER_H + i * (ROW_H + ROW_GAP);
  }

  const ticks: { x: number; label: string }[] = [];
  const cur = new Date(ganttStart);
  while (cur <= ganttEnd) {
    if (cur.getDate() === 1 || cur.getTime() === ganttStart.getTime()) {
      ticks.push({
        x: dayX(cur),
        label: cur.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      });
    }
    cur.setDate(cur.getDate() + 7);
  }

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} className="font-sans" onMouseLeave={() => setTooltip(null)}>
        {/* Background rows */}
        {rows.map((_, i) => (
          <rect key={i} x={0} y={rowY(i)} width={svgW} height={ROW_H}
            fill={i % 2 === 0 ? "#F7F8FA" : "#FFFFFF"} />
        ))}

        {/* Header */}
        <rect x={0} y={0} width={svgW} height={HEADER_H} fill="#1a1a2e" />
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} y1={HEADER_H} x2={t.x} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />
            <text x={t.x + 4} y={HEADER_H / 2 + 5} fill="#FFFFFF" fontSize={10} fontWeight={600}>{t.label}</text>
          </g>
        ))}

        {/* Today line */}
        {todayOffset >= 0 && todayOffset <= totalDays && (
          <>
            <line x1={LABEL_W + todayOffset * DAY_W} y1={HEADER_H}
              x2={LABEL_W + todayOffset * DAY_W} y2={svgH}
              stroke="#E53E3E" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={LABEL_W + todayOffset * DAY_W + 3} y={HEADER_H - 8}
              fill="#E53E3E" fontSize={9} fontWeight={700}>TODAY</text>
          </>
        )}

        {/* Fixed left label column */}
        <rect x={0} y={HEADER_H} width={LABEL_W} height={svgH - HEADER_H} fill="white" />
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#1a1a2e" />
        <text x={12} y={HEADER_H / 2 + 5} fill="#FFFFFF" fontSize={11} fontWeight={700}>TASK / SUBTASK</text>
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />

        {rows.map((row, i) => {
          const y = rowY(i);
          const cy = y + ROW_H / 2;
          const indent = 12 + row.depth * 16;
          const startD = parseDate(row.start_date);
          const endD = parseDate(row.end_date);

          // Bar / marker. No dates => label row only, NO line (by design).
          let barEl: React.ReactNode = null;
          if (row.is_milestone && endD) {
            const mx = dayX(endD);
            const s = 7;
            barEl = (
              <polygon points={`${mx},${cy - s} ${mx + s},${cy} ${mx},${cy + s} ${mx - s},${cy}`}
                fill={rowColor(row)} opacity={0.95}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          } else if (startD && endD) {
            const bx = dayX(startD);
            const bw = Math.max(DAY_W, (endD.getTime() - startD.getTime()) / 86400000 * DAY_W);
            barEl = (
              <rect x={bx} y={y + 7} width={bw} height={ROW_H - 14} rx={4}
                fill={rowColor(row)} opacity={row.kind === "subtask" || row.kind === "entity" ? 0.6 : 0.85}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          } else if (endD) {
            // Deadline known but no start: a diamond marker, not a fake bar.
            const mx = dayX(endD);
            const s = 6;
            barEl = (
              <polygon points={`${mx},${cy - s} ${mx + s},${cy} ${mx},${cy + s} ${mx - s},${cy}`}
                fill={rowColor(row)} opacity={0.8}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          }

          const maxChars = Math.max(8, 30 - row.depth * 3);
          const titleText = row.title.length > maxChars ? row.title.slice(0, maxChars - 1) + "…" : row.title;
          const ents = entityLabel(row);

          return (
            <g key={row.id}>
              <text x={indent} y={cy - (ents ? 2 : -4)}
                fill={row.kind === "milestone" ? MILESTONE_COLOR : "#1a1a2e"}
                fontSize={row.depth === 0 ? 11 : 10}
                fontWeight={row.depth === 0 ? 600 : 500}>
                <tspan fill="#A0AEC0">{KIND_ICON[row.kind]} </tspan>{titleText}
              </text>
              {ents && (
                <text x={indent + 10} y={cy + 11} fill="#718096" fontSize={9}>{ents}</text>
              )}
              {barEl}
            </g>
          );
        })}

        {/* Dependency arrows (task → task) */}
        {rows.flatMap((row) =>
          (row.depends_on ?? []).map((depId) => {
            const fromIdx = idToIdx[depId];
            const toIdx = idToIdx[row.id];
            if (fromIdx === undefined || toIdx === undefined) return null;
            const fromEnd = parseDate(rows[fromIdx].end_date);
            const toStart = parseDate(row.start_date) ?? parseDate(row.end_date);
            if (!fromEnd || !toStart) return null;
            const x1 = dayX(fromEnd);
            const y1 = rowY(fromIdx) + ROW_H / 2;
            const x2 = dayX(toStart);
            const y2 = rowY(toIdx) + ROW_H / 2;
            return (
              <path key={`${depId}->${row.id}`}
                d={`M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`}
                fill="none" stroke="#A0AEC0" strokeWidth={1.5} markerEnd="url(#arrow)" />
            );
          })
        )}

        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#A0AEC0" />
          </marker>
        </defs>
      </svg>

      {tooltip && (
        <div className="fixed z-50 bg-midnight text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none max-w-[240px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}>
          <p className="font-semibold">{tooltip.row.title}</p>
          {tooltip.row.status && <p className="text-white/70 mt-0.5">Status: {tooltip.row.status}</p>}
          {tooltip.row.start_date && <p className="text-white/70">Start: {tooltip.row.start_date}</p>}
          {tooltip.row.end_date && <p className="text-white/70">End: {tooltip.row.end_date}</p>}
          {(tooltip.row.entities ?? []).length > 0 && (
            <p className="text-white/70 mt-0.5">
              {(tooltip.row.entities ?? []).map((e) => `${e.type === "building" ? "🏢" : "👤"}${e.name}`).join(", ")}
            </p>
          )}
          {!tooltip.row.start_date && !tooltip.row.end_date && (
            <p className="text-white/50 italic mt-0.5">No date scheduled</p>
          )}
        </div>
      )}
    </div>
  );
}

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
        const biz = await apiFetch("/api/v1/businesses/my");
        if (!biz?.id) throw new Error("No business");
        bizId = biz.id;
        localStorage.setItem("business_id", bizId);
      }
      const data = await apiFetch(`/api/v1/initiatives?business_id=${bizId}`);
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
    apiFetch(`/api/v1/initiatives/${selectedId}/gantt`)
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
          const data: GanttData = await apiFetch(`/api/v1/initiatives/${init.id}/gantt`);
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

  // Date range.
  const today = new Date();
  let ganttStart = addDays(today, -5);
  let ganttEnd = addDays(today, 30);

  function widen(rows: GanttRow[], baseStart?: string | null, baseEnd?: string | null) {
    const s = parseDate(baseStart);
    const e = parseDate(baseEnd);
    if (s) ganttStart = addDays(s, -2);
    if (e) ganttEnd = addDays(e, 5);
    rows.forEach((r) => {
      const rs = parseDate(r.start_date);
      const re = parseDate(r.end_date);
      if (rs && rs < ganttStart) ganttStart = addDays(rs, -2);
      if (re && re > ganttEnd) ganttEnd = addDays(re, 5);
    });
  }
  if (fullPortfolio) widen(portfolioRows);
  else if (ganttData) widen(ganttData.rows ?? [], ganttData.start_date, ganttData.end_date);

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
