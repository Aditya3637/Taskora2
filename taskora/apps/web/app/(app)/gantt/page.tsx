"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronDown, Layers } from "lucide-react";

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
  return res.json();
}

type Initiative = { id: string; name?: string; title?: string; start_date?: string; end_date?: string };
type GanttTask = {
  id: string;
  title: string;
  status: string;
  start_date?: string;
  due_date?: string;
  is_milestone?: boolean;
  depends_on?: string[];
};
type GanttData = { tasks: GanttTask[]; start_date?: string; end_date?: string };

const STATUS_COLOR: Record<string, string> = {
  done: "#38A169",
  completed: "#38A169",
  in_progress: "#3182CE",
  blocked: "#E53E3E",
  pending_decision: "#D69E2E",
};

function taskColor(status: string) {
  return STATUS_COLOR[status] ?? "#A0AEC0";
}

function parseDate(d?: string): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

const LABEL_W = 200;
const ROW_H = 36;
const ROW_GAP = 4;
const HEADER_H = 40;
const DAY_W = 24;

interface TooltipState { x: number; y: number; task: GanttTask }

function GanttSVG({ tasks, ganttStart, ganttEnd }: { tasks: GanttTask[]; ganttStart: Date; ganttEnd: Date }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const totalDays = Math.max(1, Math.ceil((ganttEnd.getTime() - ganttStart.getTime()) / 86400000));
  const svgW = LABEL_W + totalDays * DAY_W;
  const svgH = HEADER_H + tasks.length * (ROW_H + ROW_GAP) + 20;

  const today = new Date();
  const todayOffset = Math.ceil((today.getTime() - ganttStart.getTime()) / 86400000);

  // Build task id → row index map for dependency arrows
  const idToIdx: Record<string, number> = {};
  tasks.forEach((t, i) => { idToIdx[t.id] = i; });

  function dayX(date: Date) {
    const d = Math.ceil((date.getTime() - ganttStart.getTime()) / 86400000);
    return LABEL_W + d * DAY_W;
  }

  function rowY(i: number) {
    return HEADER_H + i * (ROW_H + ROW_GAP);
  }

  // Generate month/week header ticks
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
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        className="font-sans"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Background rows */}
        {tasks.map((_, i) => (
          <rect
            key={i}
            x={0}
            y={rowY(i)}
            width={svgW}
            height={ROW_H}
            fill={i % 2 === 0 ? "#F7F8FA" : "#FFFFFF"}
          />
        ))}

        {/* Header background */}
        <rect x={0} y={0} width={svgW} height={HEADER_H} fill="#1a1a2e" />

        {/* Tick marks */}
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} y1={HEADER_H} x2={t.x} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />
            <text x={t.x + 4} y={HEADER_H / 2 + 5} fill="#FFFFFF" fontSize={10} fontWeight={600}>{t.label}</text>
          </g>
        ))}

        {/* Today line */}
        {todayOffset >= 0 && todayOffset <= totalDays && (
          <>
            <line
              x1={LABEL_W + todayOffset * DAY_W}
              y1={HEADER_H}
              x2={LABEL_W + todayOffset * DAY_W}
              y2={svgH}
              stroke="#E53E3E"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            <text x={LABEL_W + todayOffset * DAY_W + 3} y={HEADER_H - 8} fill="#E53E3E" fontSize={9} fontWeight={700}>TODAY</text>
          </>
        )}

        {/* Task labels (fixed left column) */}
        <rect x={0} y={HEADER_H} width={LABEL_W} height={svgH - HEADER_H} fill="white" />
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#1a1a2e" />
        <text x={12} y={HEADER_H / 2 + 5} fill="#FFFFFF" fontSize={11} fontWeight={700}>TASK</text>
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />

        {tasks.map((task, i) => {
          const y = rowY(i);
          const cy = y + ROW_H / 2;

          // Label
          const labelText = task.title.length > 24 ? task.title.slice(0, 22) + "…" : task.title;

          // Bar / milestone
          let barEl = null;
          if (task.is_milestone && task.due_date) {
            const mx = dayX(new Date(task.due_date));
            const size = 8;
            barEl = (
              <polygon
                points={`${mx},${cy - size} ${mx + size},${cy} ${mx},${cy + size} ${mx - size},${cy}`}
                fill={taskColor(task.status)}
                opacity={0.9}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, task })}
              />
            );
          } else {
            const startD = parseDate(task.start_date) ?? ganttStart;
            const endD = parseDate(task.due_date) ?? addDays(startD, 3);
            const bx = dayX(startD);
            const bw = Math.max(DAY_W, (endD.getTime() - startD.getTime()) / 86400000 * DAY_W);
            barEl = (
              <g>
                <rect
                  x={bx}
                  y={y + 6}
                  width={bw}
                  height={ROW_H - 12}
                  rx={4}
                  fill={taskColor(task.status)}
                  opacity={0.85}
                  onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, task })}
                  className="cursor-pointer"
                />
              </g>
            );
          }

          return (
            <g key={task.id}>
              <text x={12} y={cy + 4} fill="#1a1a2e" fontSize={11} fontWeight={500}>{labelText}</text>
              {barEl}
            </g>
          );
        })}

        {/* Dependency arrows */}
        {tasks.flatMap((task) =>
          (task.depends_on ?? []).map((depId) => {
            const fromIdx = idToIdx[depId];
            const toIdx = idToIdx[task.id];
            if (fromIdx === undefined || toIdx === undefined) return null;

            const fromTask = tasks[fromIdx];
            const fromEnd = parseDate(fromTask.due_date) ?? addDays(parseDate(fromTask.start_date) ?? ganttStart, 3);
            const toStart = parseDate(task.start_date) ?? ganttStart;

            const x1 = dayX(fromEnd);
            const y1 = rowY(fromIdx) + ROW_H / 2;
            const x2 = dayX(toStart);
            const y2 = rowY(toIdx) + ROW_H / 2;

            return (
              <g key={`${depId}->${task.id}`}>
                <path
                  d={`M ${x1} ${y1} C ${x1 + 20} ${y1}, ${x2 - 20} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="#A0AEC0"
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                />
              </g>
            );
          })
        )}

        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#A0AEC0" />
          </marker>
        </defs>
      </svg>

      {/* Tooltip (fixed positioning via portal-style overlay) */}
      {tooltip && (
        <div
          className="fixed z-50 bg-midnight text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none max-w-[220px]"
          style={{ left: tooltip.x + 12, top: tooltip.y - 40 }}
        >
          <p className="font-semibold">{tooltip.task.title}</p>
          <p className="text-white/70 mt-0.5">Status: {tooltip.task.status}</p>
          {tooltip.task.due_date && <p className="text-white/70">Due: {tooltip.task.due_date}</p>}
        </div>
      )}
    </div>
  );
}

export default function GanttPage() {
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingGantt, setLoadingGantt] = useState(false);
  const [error, setError] = useState("");
  const [fullPortfolio, setFullPortfolio] = useState(false);
  const [portfolioTasks, setPortfolioTasks] = useState<(GanttTask & { _initiative: string })[]>([]);
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
      setBusinessId(bizId);
      const data = await apiFetch(`/api/v1/initiatives/?business_id=${bizId}`);
      setInitiatives(Array.isArray(data) ? data : data.results ?? []);
    } catch {
      setError("Failed to load initiatives.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadInitiatives(); }, [loadInitiatives]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingGantt(true);
    setGanttData(null);
    apiFetch(`/api/v1/initiatives/${selectedId}/gantt`)
      .then(setGanttData)
      .catch(() => setError("Failed to load Gantt data."))
      .finally(() => setLoadingGantt(false));
  }, [selectedId]);

  async function handleFullPortfolio() {
    setFullPortfolio(true);
    setLoadingPortfolio(true);
    try {
      const all: (GanttTask & { _initiative: string })[] = [];
      for (const init of initiatives) {
        try {
          const data: GanttData = await apiFetch(`/api/v1/initiatives/${init.id}/gantt`);
          const label = init.name ?? init.title ?? init.id;
          (data.tasks ?? []).forEach((t) => all.push({ ...t, _initiative: label }));
        } catch { /* skip */ }
      }
      setPortfolioTasks(all);
    } finally {
      setLoadingPortfolio(false);
    }
  }

  // Determine gantt date range
  const today = new Date();
  let ganttStart = addDays(today, -5);
  let ganttEnd = addDays(today, 30);

  if (ganttData) {
    const s = parseDate(ganttData.start_date);
    const e = parseDate(ganttData.end_date);
    if (s) ganttStart = addDays(s, -2);
    if (e) ganttEnd = addDays(e, 5);
    // also scan tasks
    (ganttData.tasks ?? []).forEach((t) => {
      const ts = parseDate(t.start_date);
      const te = parseDate(t.due_date);
      if (ts && ts < ganttStart) ganttStart = addDays(ts, -2);
      if (te && te > ganttEnd) ganttEnd = addDays(te, 5);
    });
  }

  // Portfolio date range
  let portStart = addDays(today, -5);
  let portEnd = addDays(today, 60);
  portfolioTasks.forEach((t) => {
    const ts = parseDate(t.start_date);
    const te = parseDate(t.due_date);
    if (ts && ts < portStart) portStart = addDays(ts, -2);
    if (te && te > portEnd) portEnd = addDays(te, 5);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-midnight">Gantt Chart</h1>
          <p className="text-steel text-sm mt-1">Visual timeline for initiatives and tasks</p>
        </div>
        <button
          onClick={handleFullPortfolio}
          disabled={initiatives.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-midnight text-white rounded-lg text-sm font-semibold hover:bg-midnight/80 transition-colors disabled:opacity-40"
        >
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
          {/* Initiative selector */}
          <div className="mb-6 flex flex-wrap items-start gap-3">
            <div className="relative w-full sm:w-auto">
              <select
                value={selectedId}
                onChange={(e) => { setSelectedId(e.target.value); setFullPortfolio(false); }}
                className="appearance-none bg-white border border-pebble text-midnight text-sm rounded-lg pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-taskora-red/30 focus:border-taskora-red w-full sm:min-w-[260px]"
              >
                <option value="">Select an initiative…</option>
                {initiatives.map((i) => (
                  <option key={i.id} value={i.id}>{i.name ?? i.title}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-steel pointer-events-none" />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-steel">
              {[
                { label: "Done", color: "#38A169" },
                { label: "In Progress", color: "#3182CE" },
                { label: "Blocked", color: "#E53E3E" },
                { label: "Pending Decision", color: "#D69E2E" },
                { label: "Other", color: "#A0AEC0" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          {/* Full portfolio view */}
          {fullPortfolio && (
            <div className="bg-white rounded-xl border border-pebble shadow-sm overflow-x-auto">
              <div className="px-5 py-3 border-b border-pebble bg-mist/30">
                <h2 className="font-semibold text-midnight text-sm">Full Portfolio Timeline</h2>
              </div>
              {loadingPortfolio ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
                </div>
              ) : portfolioTasks.length === 0 ? (
                <p className="text-center text-steel py-12 text-sm">No tasks found across initiatives.</p>
              ) : (
                <GanttSVG tasks={portfolioTasks} ganttStart={portStart} ganttEnd={portEnd} />
              )}
            </div>
          )}

          {/* Single initiative view */}
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
              ) : ganttData && (ganttData.tasks ?? []).length === 0 ? (
                <p className="text-center text-steel py-12 text-sm">No tasks in this initiative.</p>
              ) : ganttData ? (
                <GanttSVG tasks={ganttData.tasks ?? []} ganttStart={ganttStart} ganttEnd={ganttEnd} />
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
