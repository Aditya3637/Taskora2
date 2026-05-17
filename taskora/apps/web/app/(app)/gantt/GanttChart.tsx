"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function ganttApiFetch(path: string, opts?: RequestInit) {
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

export type GanttEntity = { type: "building" | "client"; name: string; end_date?: string | null };
export type GanttRow = {
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
export type GanttData = {
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
export const MILESTONE_COLOR = "#6B46C1";

function rowColor(row: GanttRow) {
  if (row.is_milestone) return MILESTONE_COLOR;
  return STATUS_COLOR[row.status ?? ""] ?? "#A0AEC0";
}

export function parseDate(d?: string | null): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

const KIND_ICON: Record<string, string> = {
  task: "▸",
  subtask: "•",
  entity: "—",
  milestone: "◆",
};

// Compact geometry. Day width is computed adaptively (see GanttSVG) so a
// ~30–45 day plan fits the viewport without horizontal scrolling.
const LABEL_W = 196;
const ROW_H = 24;
const ROW_GAP = 3;
const MONTH_H = 17;
const DAY_H = 17;
const HEADER_H = MONTH_H + DAY_H;
const MIN_DAY_W = 11;
const MAX_DAY_W = 38;

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

/** Sensible, tight [start,end] window for a set of rows. */
export function ganttRange(rows: GanttRow[], baseStart?: string | null, baseEnd?: string | null) {
  const today = new Date();
  let start = addDays(today, -3);
  let end = addDays(today, 24);
  const s = parseDate(baseStart);
  const e = parseDate(baseEnd);
  if (s) start = addDays(s, -1);
  if (e) end = addDays(e, 2);
  rows.forEach((r) => {
    const rs = parseDate(r.start_date);
    const re = parseDate(r.end_date);
    if (rs && rs < start) start = addDays(rs, -1);
    if (re && re > end) end = addDays(re, 2);
  });
  return { start: startOfDay(start), end: startOfDay(end) };
}

export function GanttSVG({ rows, ganttStart, ganttEnd }: { rows: GanttRow[]; ganttStart: Date; ganttEnd: Date }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => { ro.disconnect(); window.removeEventListener("resize", update); };
  }, []);

  const s0 = startOfDay(ganttStart);
  const e0 = startOfDay(ganttEnd);
  const totalDays = Math.max(1, Math.round((e0.getTime() - s0.getTime()) / 86400000) + 1);

  // Fit the whole window into the available width when feasible; only fall
  // back to scrolling for very long ranges (clamped at MIN_DAY_W).
  const avail = Math.max(360, (containerW || 960) - LABEL_W - 6);
  const dayW = Math.min(MAX_DAY_W, Math.max(MIN_DAY_W, Math.floor(avail / totalDays)));

  const svgW = LABEL_W + totalDays * dayW;
  const svgH = HEADER_H + rows.length * (ROW_H + ROW_GAP) + 10;

  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) days.push(addDays(s0, i));

  function colX(date: Date) {
    return LABEL_W + Math.round((startOfDay(date).getTime() - s0.getTime()) / 86400000) * dayW;
  }
  function rowY(i: number) {
    return HEADER_H + i * (ROW_H + ROW_GAP);
  }

  const today = new Date();
  const todayX = colX(today) + dayW / 2;
  const todayIn = today >= s0 && today <= addDays(e0, 1);

  // Month segments for the top band.
  const months: { x0: number; x1: number; label: string; key: string }[] = [];
  days.forEach((d, i) => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const x0 = LABEL_W + i * dayW;
    const last = months[months.length - 1];
    if (!last || last.key !== key) {
      const showYear = d.getMonth() === 0 || months.length === 0;
      months.push({
        x0,
        x1: x0 + dayW,
        key,
        label:
          d.toLocaleDateString("en-IN", { month: "short" }) +
          (showYear ? ` ’${String(d.getFullYear()).slice(2)}` : ""),
      });
    } else {
      last.x1 = x0 + dayW;
    }
  });

  // Day-label cadence: denser when columns are wide enough to be legible.
  function showDayLabel(d: Date) {
    if (dayW >= 20) return true;
    if (dayW >= 14) return d.getDate() % 2 === 1;
    return d.getDay() === 1 || d.getDate() === 1; // weekly (Mon) + month start
  }

  const idToIdx: Record<string, number> = {};
  rows.forEach((r, i) => { idToIdx[r.id] = i; });

  return (
    <div ref={wrapRef} className="overflow-x-auto w-full">
      <svg width={svgW} height={svgH} className="font-sans select-none" onMouseLeave={() => setTooltip(null)}>
        {/* Weekend shading + faint day gridlines */}
        {days.map((d, i) => {
          const x = LABEL_W + i * dayW;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <g key={`c${i}`}>
              {weekend && (
                <rect x={x} y={HEADER_H} width={dayW} height={svgH - HEADER_H} fill="#F4F1F7" opacity={0.5} />
              )}
              <line x1={x} y1={HEADER_H} x2={x} y2={svgH}
                stroke={d.getDate() === 1 ? "#CBD5E0" : "#EDEFF3"}
                strokeWidth={d.getDate() === 1 ? 1 : 0.5} />
            </g>
          );
        })}

        {/* Zebra rows */}
        {rows.map((_, i) => (
          <rect key={`r${i}`} x={LABEL_W} y={rowY(i)} width={svgW - LABEL_W} height={ROW_H}
            fill={i % 2 === 0 ? "#FAFBFC" : "#FFFFFF"} />
        ))}

        {/* Today */}
        {todayIn && (
          <>
            <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH} stroke="#E53E3E" strokeWidth={1.5} strokeDasharray="3 3" />
            <circle cx={todayX} cy={HEADER_H} r={3} fill="#E53E3E" />
          </>
        )}

        {/* ── Two-tier header ── */}
        <rect x={LABEL_W} y={0} width={svgW - LABEL_W} height={MONTH_H} fill="#1a1a2e" />
        <rect x={LABEL_W} y={MONTH_H} width={svgW - LABEL_W} height={DAY_H} fill="#2d2d44" />
        {months.map((m, i) => (
          <g key={`m${i}`}>
            {i > 0 && <line x1={m.x0} y1={0} x2={m.x0} y2={svgH} stroke="#CBD5E0" strokeWidth={1} />}
            <text x={(Math.max(m.x0, LABEL_W) + m.x1) / 2} y={MONTH_H / 2 + 4}
              fill="#FFFFFF" fontSize={10} fontWeight={700} textAnchor="middle">
              {m.label}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          showDayLabel(d) ? (
            <text key={`d${i}`} x={LABEL_W + i * dayW + dayW / 2} y={MONTH_H + DAY_H / 2 + 3.5}
              fill="#C7CBD9" fontSize={dayW < 16 ? 7.5 : 9} textAnchor="middle">
              {d.getDate()}
            </text>
          ) : null,
        )}

        {/* Left label column header */}
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#1a1a2e" />
        <text x={10} y={HEADER_H / 2 + 4} fill="#FFFFFF" fontSize={10} fontWeight={700}>TASK / SUBTASK</text>
        <rect x={0} y={HEADER_H} width={LABEL_W} height={svgH - HEADER_H} fill="#FFFFFF" />
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#CBD5E0" strokeWidth={1} />

        {/* Rows */}
        {rows.map((row, i) => {
          const y = rowY(i);
          const cy = y + ROW_H / 2;
          const indent = 8 + row.depth * 13;
          const startD = parseDate(row.start_date);
          const endD = parseDate(row.end_date);

          let barEl: React.ReactNode = null;
          if (row.is_milestone && endD) {
            const mx = colX(endD) + dayW / 2;
            const sz = 6;
            barEl = (
              <polygon points={`${mx},${cy - sz} ${mx + sz},${cy} ${mx},${cy + sz} ${mx - sz},${cy}`}
                fill={rowColor(row)} onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          } else if (startD && endD) {
            const bx = colX(startD);
            const days2 = Math.max(1, Math.round((startOfDay(endD).getTime() - startOfDay(startD).getTime()) / 86400000) + 1);
            barEl = (
              <rect x={bx} y={y + 4} width={Math.max(dayW, days2 * dayW)} height={ROW_H - 8} rx={3}
                fill={rowColor(row)} opacity={row.kind === "subtask" || row.kind === "entity" ? 0.6 : 0.9}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          } else if (endD) {
            const mx = colX(endD) + dayW / 2;
            const sz = 5;
            barEl = (
              <polygon points={`${mx},${cy - sz} ${mx + sz},${cy} ${mx},${cy + sz} ${mx - sz},${cy}`}
                fill={rowColor(row)} opacity={0.8}
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                className="cursor-pointer" />
            );
          }

          const ents = entityLabel(row);
          const budget = Math.max(6, Math.floor((LABEL_W - indent - 6) / 6) - (ents ? 2 : 0));
          let label = `${KIND_ICON[row.kind]} ${row.title}`;
          if (ents) label += `  ${ents}`;
          if (label.length > budget) label = label.slice(0, budget - 1) + "…";

          return (
            <g key={row.id}>
              <text x={indent} y={cy + 3.5}
                fill={row.kind === "milestone" ? MILESTONE_COLOR : "#1a1a2e"}
                fontSize={row.depth === 0 ? 10.5 : 9.5}
                fontWeight={row.depth === 0 ? 600 : 400}>
                {label}
              </text>
              {barEl}
            </g>
          );
        })}

        {/* Dependency arrows */}
        {rows.flatMap((row) =>
          (row.depends_on ?? []).map((depId) => {
            const fromIdx = idToIdx[depId];
            const toIdx = idToIdx[row.id];
            if (fromIdx === undefined || toIdx === undefined) return null;
            const fromEnd = parseDate(rows[fromIdx].end_date);
            const toStart = parseDate(row.start_date) ?? parseDate(row.end_date);
            if (!fromEnd || !toStart) return null;
            const x1 = colX(fromEnd) + dayW;
            const y1 = rowY(fromIdx) + ROW_H / 2;
            const x2 = colX(toStart);
            const y2 = rowY(toIdx) + ROW_H / 2;
            return (
              <path key={`${depId}->${row.id}`}
                d={`M ${x1} ${y1} C ${x1 + 16} ${y1}, ${x2 - 16} ${y2}, ${x2} ${y2}`}
                fill="none" stroke="#A0AEC0" strokeWidth={1.25} markerEnd="url(#arrow)" />
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
        <div className="fixed z-[60] bg-midnight text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none max-w-[240px]"
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

/** Popup that loads and renders one initiative's Gantt over a backdrop. */
export function GanttModal({
  initiativeId,
  initiativeName,
  onClose,
}: {
  initiativeId: string;
  initiativeName?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<GanttData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    ganttApiFetch(`/api/v1/initiatives/${initiativeId}/gantt`)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setError("Failed to load Gantt data."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [initiativeId]);

  const rows = data?.rows ?? [];
  const { start, end } = ganttRange(rows, data?.start_date, data?.end_date);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-pebble">
          <div>
            <h2 className="font-bold text-midnight">Gantt Chart</h2>
            <p className="text-xs text-steel mt-0.5">
              {initiativeName ?? data?.initiative?.title ?? "Planned timeline"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-steel hover:bg-mist hover:text-midnight transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-auto flex-1 p-3">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-8 h-8 border-4 border-pebble border-t-taskora-red rounded-full animate-spin" />
            </div>
          ) : error ? (
            <p className="text-center text-red-600 py-16 text-sm">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-center text-steel py-16 text-sm">
              No tasks in this initiative yet — break it down to plan a timeline.
            </p>
          ) : (
            <GanttSVG rows={rows} ganttStart={start} ganttEnd={end} />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 py-2.5 border-t border-pebble text-[11px] text-steel">
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
    </div>
  );
}
