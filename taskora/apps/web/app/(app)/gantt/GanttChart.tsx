"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { X } from "lucide-react";
import { cn } from "@/components/ui";

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
  kind: "task" | "subtask" | "entity" | "entity-lane" | "milestone";
  parent_id?: string | null;
  depth: number;
  title: string;
  status?: string | null;
  priority?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_milestone?: boolean;
  // True when this row's end date overruns its initiative's target end —
  // rendered with a red warning outline so out-of-bounds plans are visible.
  over_end?: boolean;
  // Collapsible/expandable rows (program lanes, initiatives) show a chevron;
  // `open` picks its direction. Toggling fires onToggle(id) — the parent
  // rebuilds the row list.
  toggleable?: boolean;
  open?: boolean;
  loading?: boolean;
  // For entity (building/client) rows — the real entity id, so the timeline
  // can target it for reschedule.
  entity_id?: string | null;
  depends_on?: string[];
  entities?: GanttEntity[];
  // Baseline (G5) — the plan snapshotted at creation; a faint ghost bar shows
  // drift when the actual start/end has moved off it.
  baseline_start?: string | null;
  baseline_end?: string | null;
};
export type GanttData = {
  initiative?: { id: string; title?: string; start_date?: string | null; end_date?: string | null };
  start_date?: string | null;
  end_date?: string | null;
  rows: GanttRow[];
};

// Refined, lower-saturation palette (tailwind 500/600) — reads modern, not
// neon. Backlog/unknown is a calm slate so colour stays meaningful.
const STATUS_COLOR: Record<string, string> = {
  done: "#10B981",
  completed: "#10B981",
  in_progress: "#6366F1",
  blocked: "#EF4444",
  pending_decision: "#F59E0B",
};
export const MILESTONE_COLOR = "#8B5CF6";

function rowColor(row: GanttRow) {
  if (row.is_milestone) return MILESTONE_COLOR;
  // Building/client lanes (Playbooks) read as neutral grouping containers at
  // any depth — their bar is a roll-up of the tasks beneath.
  if (row.kind === "entity-lane") return "#64748B";
  // Program/parent lanes read as neutral containers; leaf rows carry status.
  if (row.depth === 0 && !STATUS_COLOR[row.status ?? ""]) return "#475569";
  return STATUS_COLOR[row.status ?? ""] ?? "#94A3B8";
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

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Inclusive list of {year, month} columns spanning [start, end]. */
function monthsBetween(start: Date, end: Date) {
  const out: { year: number; month: number }[] = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const ey = end.getFullYear();
  const em = end.getMonth();
  // Guard against pathological ranges (cap at 5 years of columns).
  for (let i = 0; i < 64; i++) {
    out.push({ year: y, month: m });
    if (y === ey && m === em) break;
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

const QUARTER_LABEL = ["Q1", "Q2", "Q3", "Q4"];

// Roomier geometry — taller rows + bigger header bands so type can breathe.
const LABEL_W = 230;
const ROW_H = 30;
const ROW_GAP = 4;
const MONTH_H = 22;
const DAY_H = 20;
const HEADER_H = MONTH_H + DAY_H;
const MIN_DAY_W = 11;
const MAX_DAY_W = 38;

interface TooltipState { x: number; y: number; row: GanttRow }

function entityLabel(row: GanttRow) {
  const ents = row.entities ?? [];
  if (ents.length === 0) return "";
  const shown = ents.slice(0, 2).map((e) => e.name).join(", ");
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

// Shared legend/toolbar shown above each chart (outside the scroll area).
const LEGEND_STATUS: { c: string; l: string }[] = [
  { c: "#6366F1", l: "In progress" },
  { c: "#10B981", l: "Done" },
  { c: "#EF4444", l: "Blocked" },
  { c: "#F59E0B", l: "Decision" },
  { c: "#94A3B8", l: "To do" },
];

function GanttLegend() {
  return (
    <div className="flex items-center gap-x-3.5 gap-y-1.5 flex-wrap px-1 pb-2.5 text-[11px] text-steel">
      {LEGEND_STATUS.map((it) => (
        <span key={it.l} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3.5 rounded-[3px]" style={{ background: it.c }} />
          {it.l}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rotate-45 rounded-[1px]" style={{ background: MILESTONE_COLOR }} />
        Milestone
      </span>
      <span className="mx-0.5 h-3 w-px bg-pebble" />
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-3.5 rounded-[3px] border-2" style={{ borderColor: "#F59E0B" }} />
        Critical path
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: "#94A3B8" }} />
        Baseline
      </span>
    </div>
  );
}

export function GanttSVG({
  rows, ganttStart, ganttEnd, scale = "day", onBarChange, canDragRow, onRowClick, onToggle,
  onLinkCreate, canLinkRow,
}: {
  rows: GanttRow[];
  ganttStart: Date;
  ganttEnd: Date;
  scale?: "day" | "month";
  // When provided with canDragRow, draggable bars call this on drop with the
  // new ISO start/end. Wired by the program planner for inline rescheduling.
  onBarChange?: (rowId: string, startISO: string, endISO: string) => void;
  canDragRow?: (row: GanttRow) => boolean;
  // Clicking a row label fires this (drill-down). Only used in month scale.
  onRowClick?: (row: GanttRow) => void;
  // Toggling a collapsible row (program/initiative chevron). Month scale only.
  onToggle?: (rowId: string) => void;
  onLinkCreate?: (fromId: string, toId: string) => void;
  canLinkRow?: (row: GanttRow) => boolean;
}) {
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

  // Month/quarter scale (years-long horizons) renders in a dedicated path so
  // the day-based chart above stays untouched.
  if (scale === "month") {
    return (
      <MonthScaleChart
        rows={rows} ganttStart={ganttStart} ganttEnd={ganttEnd}
        onBarChange={onBarChange} canDragRow={canDragRow} onRowClick={onRowClick}
        onToggle={onToggle} onLinkCreate={onLinkCreate} canLinkRow={canLinkRow}
      />
    );
  }

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
          // Use the browser locale so US/EU workspaces see "Jan/Feb…" in
          // their idiom instead of the en-IN month names that ship by
          // default. (English short months render identically across en-*
          // locales but this also covers German/French if added later.)
          d.toLocaleDateString(undefined, { month: "short" }) +
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
    <div className="w-full">
      <GanttLegend />
      <div ref={wrapRef} className="overflow-x-auto w-full">
      <svg width={svgW} height={svgH} className="font-sans select-none" onMouseLeave={() => setTooltip(null)}>
        {/* Weekend shading + faint day gridlines */}
        {days.map((d, i) => {
          const x = LABEL_W + i * dayW;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <g key={`c${i}`}>
              {weekend && (
                <rect x={x} y={HEADER_H} width={dayW} height={svgH - HEADER_H} fill="#F8FAFC" opacity={0.7} />
              )}
              <line x1={x} y1={HEADER_H} x2={x} y2={svgH}
                stroke={d.getDate() === 1 ? "#E8EDF3" : "#F2F5F9"}
                strokeWidth={1} />
            </g>
          );
        })}

        {/* Zebra rows */}
        {rows.map((_, i) => (
          <rect key={`r${i}`} x={LABEL_W} y={rowY(i)} width={svgW - LABEL_W} height={ROW_H + ROW_GAP}
            fill={i % 2 === 0 ? "#FBFCFD" : "#FFFFFF"} />
        ))}

        {/* Today */}
        {todayIn && (
          <>
            <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH} stroke="#E11D48" strokeWidth={1.5} strokeDasharray="4 3" />
            <circle cx={todayX} cy={HEADER_H + 1} r={3} fill="#E11D48" />
          </>
        )}

        {/* ── Two-tier header (clean light bands) ── */}
        <rect x={LABEL_W} y={0} width={svgW - LABEL_W} height={MONTH_H} fill="#F8FAFC" />
        <rect x={LABEL_W} y={MONTH_H} width={svgW - LABEL_W} height={DAY_H} fill="#FFFFFF" />
        <line x1={LABEL_W} y1={HEADER_H} x2={svgW} y2={HEADER_H} stroke="#E2E8F0" strokeWidth={1} />
        {months.map((m, i) => (
          <g key={`m${i}`}>
            {i > 0 && <line x1={m.x0} y1={0} x2={m.x0} y2={svgH} stroke="#D5DCE6" strokeWidth={1} />}
            <text x={(Math.max(m.x0, LABEL_W) + m.x1) / 2} y={MONTH_H / 2 + 4}
              fill="#0F172A" fontSize={11} fontWeight={700} letterSpacing="0.04em" textAnchor="middle">
              {m.label}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          showDayLabel(d) ? (
            <text key={`d${i}`} x={LABEL_W + i * dayW + dayW / 2} y={MONTH_H + DAY_H / 2 + 4}
              fill="#64748B" fontSize={dayW < 16 ? 8.5 : 10} textAnchor="middle">
              {d.getDate()}
            </text>
          ) : null,
        )}

        {/* Left label column header */}
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#F8FAFC" />
        <text x={14} y={HEADER_H / 2 + 4} fill="#94A3B8" fontSize={10} fontWeight={700} letterSpacing="0.08em">TASK / SUBTASK</text>
        <rect x={0} y={HEADER_H} width={LABEL_W} height={svgH - HEADER_H} fill="#FFFFFF" />
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />

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
              <rect x={bx} y={y + 6} width={Math.max(dayW, days2 * dayW)} height={ROW_H - 12} rx={5}
                fill={rowColor(row)} opacity={row.kind === "subtask" || row.kind === "entity" ? 0.7 : 1}
                stroke={row.over_end ? "#EF4444" : "none"} strokeWidth={row.over_end ? 1.5 : 0}
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
          } else if (row.depth > 0 && !row.title?.startsWith("No tasks")) {
            // No dates → visible dashed placeholder (consistent with month scale).
            barEl = (
              <g>
                <rect x={LABEL_W + 8} y={y + 7} width={76} height={ROW_H - 14} rx={4}
                  fill="none" stroke="#CBD5E1" strokeWidth={1} strokeDasharray="3 3" />
                <text x={LABEL_W + 46} y={cy + 4} fontSize={9.5} fill="#94A3B8"
                  textAnchor="middle" className="pointer-events-none">No dates</text>
              </g>
            );
          }

          const ents = entityLabel(row);
          const budget = Math.max(6, Math.floor((LABEL_W - indent - 8) / 6.6) - (ents ? 2 : 0));
          let label = row.title;
          if (ents) label += `  ${ents}`;
          if (label.length > budget) label = label.slice(0, budget - 1) + "…";

          return (
            <g key={row.id}>
              <text x={indent} y={cy + 4}
                fill={row.kind === "milestone" ? MILESTONE_COLOR : row.depth === 0 ? "#0F172A" : "#475569"}
                fontSize={row.depth === 0 ? 12 : 11.5}
                fontWeight={row.depth === 0 ? 600 : 500}>
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
                d={`M ${x1} ${y1} C ${x1 + 18} ${y1}, ${x2 - 18} ${y2}, ${x2} ${y2}`}
                fill="none" stroke="#CBD5E1" strokeWidth={1.5} markerEnd="url(#arrow)" />
            );
          })
        )}

        <defs>
          <marker id="arrow" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L6,3.5 z" fill="#CBD5E1" />
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
          {tooltip.row.over_end && (
            <p className="text-red-300 mt-0.5">⚠ Ends after the initiative target end</p>
          )}
          {(tooltip.row.entities ?? []).length > 0 && (
            <p className="text-white/70 mt-0.5">
              {(tooltip.row.entities ?? []).map((e) => e.name).join(", ")}
            </p>
          )}
          {!tooltip.row.start_date && !tooltip.row.end_date && (
            <p className="text-white/50 italic mt-0.5">No date scheduled</p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Fixed planning window: Jan 1 of `anchorYear` → Dec 31 of the last year. */
export function ganttRangeMonths(anchorYear: number, years: number) {
  return {
    start: new Date(anchorYear, 0, 1),
    end: new Date(anchorYear + Math.max(1, years) - 1, 11, 31),
  };
}

const MS_PER_DAY = 86400000;
const AVG_DAYS_PER_MONTH = 30.437;

interface DragState {
  rowId: string;
  mode: "move" | "resize-l" | "resize-r";
  startX: number;          // pointer x at mousedown
  origStart: Date;
  origEnd: Date;
  pxPerDay: number;
  curStart: Date;
  curEnd: Date;
}

/** Month/quarter-scale Gantt for multi-year horizons. Bars are positioned by a
 *  continuous date→x mapping (fractional within each month column) so a 1–3
 *  year plan reads cleanly. Optionally supports drag-move / edge-resize that
 *  reports new ISO dates via onBarChange. */
function MonthScaleChart({
  rows, ganttStart, ganttEnd, onBarChange, canDragRow, onRowClick, onToggle,
  onLinkCreate, canLinkRow,
}: {
  rows: GanttRow[];
  ganttStart: Date;
  ganttEnd: Date;
  onBarChange?: (rowId: string, startISO: string, endISO: string) => void;
  canDragRow?: (row: GanttRow) => boolean;
  onRowClick?: (row: GanttRow) => void;
  onToggle?: (rowId: string) => void;
  // Draw-to-link: drag from a bar's link handle to another bar to make the
  // target depend on the source (from = prerequisite, to = dependent).
  onLinkCreate?: (fromId: string, toId: string) => void;
  canLinkRow?: (row: GanttRow) => boolean;
}) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Active dependency-linking gesture (from a bar's handle to the cursor).
  const [linking, setLinking] = useState<{ fromId: string; x1: number; y1: number; x: number; y: number } | null>(null);
  // A reschedule awaiting confirmation — the bar shows the proposed position
  // but dates are NOT persisted until the user confirms.
  const [pending, setPending] = useState<
    { rowId: string; oldStart: Date; oldEnd: Date; newStart: Date; newEnd: Date } | null
  >(null);

  // Critical path (G5): the dependency chain ending at the latest finish.
  // Walk back from the latest-finishing bar through its latest-finishing
  // predecessor each step. Only a real path (>1 node) is highlighted.
  const criticalSet = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const endMs = (r?: GanttRow | null) => {
      const d = r ? parseDate(r.end_date) : null;
      return d ? d.getTime() : -Infinity;
    };
    let tail: GanttRow | null = null;
    for (const r of rows) {
      if (r.is_milestone || !parseDate(r.end_date)) continue;
      if (!tail || endMs(r) > endMs(tail)) tail = r;
    }
    const set = new Set<string>();
    const seen = new Set<string>();
    let cur: GanttRow | null = tail;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      set.add(cur.id);
      let next: GanttRow | null = null;
      for (const depId of cur.depends_on ?? []) {
        const p = byId.get(depId) ?? null;
        if (p && (!next || endMs(p) > endMs(next))) next = p;
      }
      cur = next;
    }
    return set.size > 1 ? set : new Set<string>();
  }, [rows]);

  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r] as const)), [rows]);

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
  const months = monthsBetween(s0, e0);
  const firstYear = months[0].year;
  const firstMonth = months[0].month;

  const avail = Math.max(360, (containerW || 1100) - LABEL_W - 6);
  const monthW = Math.min(140, Math.max(34, Math.floor(avail / months.length)));
  const svgW = LABEL_W + months.length * monthW;
  const svgH = HEADER_H + rows.length * (ROW_H + ROW_GAP) + 10;
  const pxPerDay = monthW / AVG_DAYS_PER_MONTH;

  function monthIdx(d: Date) {
    return (d.getFullYear() - firstYear) * 12 + (d.getMonth() - firstMonth);
  }
  // Continuous x for the *start* of a date (00:00).
  function colX(date: Date) {
    if (date <= s0) return LABEL_W;
    const idx = monthIdx(date);
    const frac = (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());
    return Math.min(svgW, LABEL_W + (idx + frac) * monthW);
  }
  // x for the *end* of a date (inclusive — covers that whole day).
  function xEnd(date: Date) {
    if (date >= e0) return svgW;
    const idx = monthIdx(date);
    const frac = date.getDate() / daysInMonth(date.getFullYear(), date.getMonth());
    return Math.min(svgW, LABEL_W + (idx + frac) * monthW);
  }
  function rowY(i: number) { return HEADER_H + i * (ROW_H + ROW_GAP); }

  const today = startOfDay(new Date());
  const todayIn = today >= s0 && today <= e0;
  const todayX = colX(today);

  // ── Drag handling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return;
    function onMove(e: MouseEvent) {
      setDrag((d) => {
        if (!d) return d;
        const dayDelta = Math.round((e.clientX - d.startX) / d.pxPerDay);
        let ns = d.origStart, ne = d.origEnd;
        if (d.mode === "move") { ns = addDays(d.origStart, dayDelta); ne = addDays(d.origEnd, dayDelta); }
        else if (d.mode === "resize-l") { ns = addDays(d.origStart, dayDelta); if (ns > d.origEnd) ns = d.origEnd; }
        else { ne = addDays(d.origEnd, dayDelta); if (ne < d.origStart) ne = d.origStart; }
        return { ...d, curStart: ns, curEnd: ne };
      });
    }
    function onUp() {
      setDrag((d) => {
        // Don't persist yet — stage the change for confirmation. The bar holds
        // the proposed position until the user confirms or cancels.
        if (d && onBarChange &&
            (toISO(d.curStart) !== toISO(d.origStart) || toISO(d.curEnd) !== toISO(d.origEnd))) {
          setPending({ rowId: d.rowId, oldStart: d.origStart, oldEnd: d.origEnd, newStart: d.curStart, newEnd: d.curEnd });
        }
        return null;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, onBarChange]);

  // Bring "today" into view on load/resize so the current + upcoming work is
  // front-and-centre — no manual scrolling to find now.
  const didScrollRef = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || didScrollRef.current || !todayIn || !containerW) return;
    el.scrollLeft = Math.max(0, todayX - LABEL_W - 120);
    didScrollRef.current = true;
  }, [containerW, todayX, todayIn]);

  // Draw-to-link: track the cursor while linking; on drop over another bar,
  // create the dependency (target depends on source).
  useEffect(() => {
    if (!linking) return;
    const rectXY = (e: MouseEvent) => {
      const r = svgRef.current?.getBoundingClientRect();
      return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    };
    function onMove(e: MouseEvent) {
      const p = rectXY(e);
      if (p) setLinking((l) => (l ? { ...l, x: p.x, y: p.y } : l));
    }
    function onUp(e: MouseEvent) {
      const p = rectXY(e);
      setLinking((l) => {
        if (l && p && onLinkCreate) {
          const idx = Math.floor((p.y - HEADER_H) / (ROW_H + ROW_GAP));
          const target = rows[idx];
          if (target && target.id !== l.fromId && !target.is_milestone && (!canLinkRow || canLinkRow(target))) {
            onLinkCreate(l.fromId, target.id);
          }
        }
        return null;
      });
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [linking, onLinkCreate, rows, canLinkRow]);

  function beginDrag(e: React.MouseEvent, row: GanttRow, mode: DragState["mode"]) {
    const sd = parseDate(row.start_date), ed = parseDate(row.end_date);
    if (!sd || !ed) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({
      rowId: row.id, mode, startX: e.clientX,
      origStart: startOfDay(sd), origEnd: startOfDay(ed), pxPerDay,
      curStart: startOfDay(sd), curEnd: startOfDay(ed),
    });
  }

  return (
    <div className="w-full">
      <GanttLegend />
      <div ref={wrapRef} className="overflow-x-auto w-full">
      <svg ref={svgRef} width={svgW} height={svgH} className="font-sans select-none"
        onMouseLeave={() => setTooltip(null)}>
        {/* Zebra rows — barely-there tint for scannability */}
        {rows.map((_, i) => (
          <rect key={`r${i}`} x={LABEL_W} y={rowY(i)} width={svgW - LABEL_W} height={ROW_H + ROW_GAP}
            fill={i % 2 === 0 ? "#FBFCFD" : "#FFFFFF"} />
        ))}

        {/* Month / quarter / year gridlines — light, recede behind the bars */}
        {months.map((m, i) => {
          const x = LABEL_W + i * monthW;
          const isYear = m.month === 0;
          const isQuarter = m.month % 3 === 0;
          return (
            <line key={`g${i}`} x1={x} y1={HEADER_H} x2={x} y2={svgH}
              stroke={isYear ? "#D5DCE6" : isQuarter ? "#E8EDF3" : "#F2F5F9"}
              strokeWidth={1} />
          );
        })}

        {/* Today */}
        {todayIn && (
          <>
            <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH} stroke="#E11D48" strokeWidth={1.5} strokeDasharray="4 3" />
            <circle cx={todayX} cy={HEADER_H + 1} r={3} fill="#E11D48" />
          </>
        )}

        {/* Header — clean light bands; year row tinted, month row white */}
        <rect x={LABEL_W} y={0} width={svgW - LABEL_W} height={MONTH_H} fill="#F8FAFC" />
        <rect x={LABEL_W} y={MONTH_H} width={svgW - LABEL_W} height={DAY_H} fill="#FFFFFF" />
        <line x1={LABEL_W} y1={HEADER_H} x2={svgW} y2={HEADER_H} stroke="#E2E8F0" strokeWidth={1} />
        {/* Year segments */}
        {(() => {
          const segs: { x0: number; x1: number; label: string }[] = [];
          months.forEach((m, i) => {
            const x0 = LABEL_W + i * monthW;
            const last = segs[segs.length - 1];
            if (!last || last.label !== String(m.year)) {
              segs.push({ x0, x1: x0 + monthW, label: String(m.year) });
            } else last.x1 = x0 + monthW;
          });
          return segs.map((s, i) => (
            <g key={`y${i}`}>
              {i > 0 && <line x1={s.x0} y1={0} x2={s.x0} y2={svgH} stroke="#D5DCE6" strokeWidth={1} />}
              <text x={(Math.max(s.x0, LABEL_W) + s.x1) / 2} y={MONTH_H / 2 + 4}
                fill="#0F172A" fontSize={11.5} fontWeight={700} letterSpacing="0.04em" textAnchor="middle">{s.label}</text>
            </g>
          ));
        })()}
        {/* Month labels — abbreviation when wide, quarter marker when narrow */}
        {months.map((m, i) => {
          const xc = LABEL_W + i * monthW + monthW / 2;
          const wide = monthW >= 40;
          const label = wide
            ? new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: "short" })
            : (m.month % 3 === 0 ? QUARTER_LABEL[m.month / 3] : "");
          if (!label) return null;
          return (
            <text key={`ml${i}`} x={xc} y={MONTH_H + DAY_H / 2 + 4}
              fill="#64748B" fontSize={11} fontWeight={wide ? 500 : 600} textAnchor="middle">{label}</text>
          );
        })}

        {/* Left label header */}
        <rect x={0} y={0} width={LABEL_W} height={HEADER_H} fill="#F8FAFC" />
        <text x={14} y={HEADER_H / 2 + 4} fill="#94A3B8" fontSize={10} fontWeight={700} letterSpacing="0.08em">PROGRAMME / INITIATIVE</text>
        <rect x={0} y={HEADER_H} width={LABEL_W} height={svgH - HEADER_H} fill="#FFFFFF" />
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />

        {/* Rows */}
        {rows.map((row, i) => {
          const y = rowY(i);
          const cy = y + ROW_H / 2;
          const indent = 8 + row.depth * 13;
          const dragging = drag?.rowId === row.id;
          const pend = pending?.rowId === row.id ? pending : null;
          const sd = dragging ? drag!.curStart : pend ? pend.newStart : parseDate(row.start_date);
          const ed = dragging ? drag!.curEnd : pend ? pend.newEnd : parseDate(row.end_date);
          const draggable = !!onBarChange && !!canDragRow?.(row) && !!sd && !!ed && !row.is_milestone;
          const isCrit = criticalSet.has(row.id);
          // Reschedule conflict (G5): dragging this bar to start before a
          // dependency it relies on finishes.
          const dragConflict = dragging && !!drag && (row.depends_on ?? []).some((depId) => {
            const pe = parseDate(rowById.get(depId)?.end_date);
            return !!pe && drag.curStart.getTime() < pe.getTime();
          });

          let barEl: React.ReactNode = null;
          if (row.is_milestone && ed) {
            const mx = colX(ed);
            const sz = 7;
            barEl = (
              <polygon points={`${mx},${cy - sz} ${mx + sz},${cy} ${mx},${cy + sz} ${mx - sz},${cy}`}
                fill={rowColor(row)} stroke="#FFFFFF" strokeWidth={1.5} className="cursor-pointer"
                onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })} />
            );
          } else if (sd && ed) {
            const bx = colX(sd);
            const bw = Math.max(6, xEnd(ed) - bx);
            const bsd = parseDate(row.baseline_start);
            const bed = parseDate(row.baseline_end);
            const drifted = !!bsd && !!bed && (bsd.getTime() !== sd.getTime() || bed.getTime() !== ed.getTime());
            barEl = (
              <g>
                {drifted && bsd && bed && (
                  <rect x={colX(bsd)} y={y + ROW_H - 4} width={Math.max(3, xEnd(bed) - colX(bsd))}
                    height={2.5} rx={1.25} fill="#94A3B8" opacity={0.6}>
                    <title>Baseline plan</title>
                  </rect>
                )}
                <rect x={bx} y={y + 6} width={bw} height={ROW_H - 12} rx={5}
                  fill={dragConflict ? "#FCA5A5" : rowColor(row)}
                  stroke={dragConflict || row.over_end ? "#EF4444" : isCrit ? "#F59E0B" : "none"}
                  strokeWidth={dragConflict ? 2 : row.over_end ? 1.5 : isCrit ? 2 : 0}
                  onMouseMove={(e) => setTooltip({ x: e.clientX, y: e.clientY, row })}
                  onMouseDown={draggable ? (e) => beginDrag(e, row, "move") : undefined}
                  className={draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} />
                {dragConflict && (
                  <text x={bx + 4} y={cy + 4} fontSize={11} fill="#991B1B" className="pointer-events-none">⚠</text>
                )}
                {(() => {
                  // In-bar label: the item name inside the bar when it's wide
                  // enough to read (white on the coloured fill).
                  const chars = Math.floor((bw - 16) / 6.2);
                  if (dragConflict || bw < 64 || chars < 4) return null;
                  const txt = row.title.length > chars ? row.title.slice(0, chars - 1) + "…" : row.title;
                  return (
                    <text x={bx + 8} y={cy + 4} fontSize={10.5} fontWeight={500} fill="#FFFFFF"
                      className="pointer-events-none">{txt}</text>
                  );
                })()}
                {draggable && (
                  <>
                    <rect x={bx - 2} y={y + 6} width={6} height={ROW_H - 12} fill="transparent"
                      onMouseDown={(e) => beginDrag(e, row, "resize-l")} className="cursor-ew-resize" />
                    <rect x={bx + bw - 4} y={y + 6} width={6} height={ROW_H - 12} fill="transparent"
                      onMouseDown={(e) => beginDrag(e, row, "resize-r")} className="cursor-ew-resize" />
                  </>
                )}
                {/* Draw-to-link handles. The END dot (filled) starts a link;
                    the START dot is the visible drop target on other bars.
                    Both grow + brighten while a link is being drawn. */}
                {onLinkCreate && canLinkRow?.(row) && (
                  <>
                    {/* Start-edge target dot (left) */}
                    <circle cx={bx - 6} cy={cy} r={linking ? 5.5 : 4} fill="#FFFFFF"
                      stroke="#6366F1" strokeWidth={linking ? 2 : 1.5}
                      className={linking ? "cursor-crosshair" : "cursor-crosshair opacity-70"}>
                      <title>Connect a dependency here (this task starts after)</title>
                    </circle>
                    {/* End-edge source dot (right) — drag from here */}
                    <circle cx={bx + bw + 6} cy={cy} r={linking ? 5.5 : 4.5} fill="#6366F1"
                      stroke="#FFFFFF" strokeWidth={1.5}
                      className="cursor-crosshair"
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setLinking({ fromId: row.id, x1: bx + bw, y1: cy, x: bx + bw, y: cy }); }}>
                      <title>Drag from here to another task to add a dependency</title>
                    </circle>
                  </>
                )}
              </g>
            );
          } else if (row.depth > 0 && !row.title?.startsWith("No tasks")) {
            // No dates → a visible dashed placeholder so undated work isn't
            // invisible on the timeline (and reads as needing a plan).
            barEl = (
              <g>
                <rect x={LABEL_W + 8} y={y + 7} width={76} height={ROW_H - 14} rx={4}
                  fill="none" stroke="#CBD5E1" strokeWidth={1} strokeDasharray="3 3" />
                <text x={LABEL_W + 46} y={cy + 4} fontSize={9.5} fill="#94A3B8"
                  textAnchor="middle" className="pointer-events-none">No dates</text>
              </g>
            );
          }

          const chevronW = row.toggleable ? 17 : 0;
          const labelX = indent + chevronW;
          // Buildings/clients are an attribute of the task — a compact badge
          // after the name, not a row of their own.
          const rowEnts = (row.entities ?? []).filter((e) => e?.name);
          const hasEnts = rowEnts.length > 0 && !row.is_milestone && row.depth > 0;
          const entBadge = hasEnts
            ? (rowEnts.length === 1 ? rowEnts[0].name : `${rowEnts.length} sites`)
            : "";
          const badgeW = hasEnts ? Math.min(72, entBadge.length * 5.4 + 12) : 0;
          let label = row.title;
          const budget = Math.max(5, Math.floor((LABEL_W - labelX - 8 - (hasEnts ? badgeW + 6 : 0)) / 6.6));
          if (label.length > budget) label = label.slice(0, budget - 1) + "…";
          const badgeX = labelX + Math.min(label.length, budget) * 6.4 + 6;
          const badgeBuilding = hasEnts && rowEnts[0].type === "building";

          // Clicking a label OPENS the item (its detail has deps / prerequisites
          // / attachments / comments / watchers / approvers / sub-tasks). The
          // chevron still toggles expand/collapse. Milestones have no detail.
          const clickable = !!onRowClick && row.depth > 0 && !row.is_milestone;
          return (
            <g key={row.id}>
              {/* Lane band — depth-0 rows (programmes / sites) read as group
                  headers with a tinted full-width band + a left accent tick. */}
              {row.depth === 0 && (
                <>
                  <rect x={0} y={y} width={svgW} height={ROW_H + ROW_GAP} fill="#EEF2F7" />
                  <rect x={0} y={y} width={3} height={ROW_H + ROW_GAP} fill="#94A3B8" />
                </>
              )}
              {row.toggleable && (
                <g
                  onClick={onToggle ? () => onToggle(row.id) : undefined}
                  className={onToggle ? "cursor-pointer" : undefined}>
                  {/* Larger invisible hit area so the chevron is easy to click. */}
                  <rect x={indent - 3} y={cy - 9} width={18} height={18} rx={4}
                    fill="transparent" className="hover:fill-[#EEF2F7]" />
                  <text x={indent + 1} y={cy + 4.5} fontSize={13} fontWeight={700}
                    fill={row.open ? "#334155" : "#64748B"} className="pointer-events-none">
                    {row.loading ? "⋯" : row.open ? "▾" : "▸"}
                  </text>
                </g>
              )}
              <text x={labelX} y={cy + 4}
                fill={row.kind === "milestone" ? MILESTONE_COLOR : row.depth === 0 ? "#0F172A" : "#475569"}
                fontSize={row.depth === 0 ? 12.5 : 11.5}
                fontWeight={row.depth === 0 ? 600 : 500}
                onClick={clickable ? () => onRowClick!(row) : (row.toggleable && onToggle ? () => onToggle(row.id) : undefined)}
                className={(clickable || (row.toggleable && onToggle)) ? "cursor-pointer hover:fill-[#6366F1]" : undefined}>
                {label}
              </text>
              {hasEnts && (
                <g className="pointer-events-none">
                  <rect x={badgeX} y={cy - 7} width={badgeW} height={14} rx={4}
                    fill={badgeBuilding ? "#FEF3C7" : "#E0F2FE"} />
                  <text x={badgeX + badgeW / 2} y={cy + 3} fontSize={8.5} textAnchor="middle"
                    fill={badgeBuilding ? "#B45309" : "#0369A1"} fontWeight={600}>
                    {entBadge.length > 11 ? entBadge.slice(0, 10) + "…" : entBadge}
                  </text>
                </g>
              )}
              {barEl}
            </g>
          );
        })}

        {/* Dependency arrows between initiative bars (depends_on). */}
        {(() => {
          const idToIdx: Record<string, number> = {};
          rows.forEach((r, i) => { idToIdx[r.id] = i; });
          return rows.flatMap((row) =>
            (row.depends_on ?? []).map((depId) => {
              const fromIdx = idToIdx[depId];
              const toIdx = idToIdx[row.id];
              if (fromIdx === undefined || toIdx === undefined) return null;
              const fromEnd = parseDate(rows[fromIdx].end_date);
              const toStart = parseDate(row.start_date) ?? parseDate(row.end_date);
              if (!fromEnd || !toStart) return null;
              const x1 = xEnd(fromEnd);
              const y1 = rowY(fromIdx) + ROW_H / 2;
              const x2 = colX(toStart);
              const y2 = rowY(toIdx) + ROW_H / 2;
              return (
                <path key={`${depId}->${row.id}`}
                  d={`M ${x1} ${y1} C ${x1 + 22} ${y1}, ${x2 - 22} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke="#CBD5E1" strokeWidth={1.5} markerEnd="url(#arrow-m)" />
              );
            })
          );
        })()}

        {/* Live link line while drawing a dependency. */}
        {linking && (
          <line x1={linking.x1} y1={linking.y1} x2={linking.x} y2={linking.y}
            stroke="#6366F1" strokeWidth={1.75} strokeDasharray="4 3" markerEnd="url(#arrow-m)" />
        )}

        <defs>
          <marker id="arrow-m" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
            <path d="M0,0 L0,7 L6,3.5 z" fill="#CBD5E1" />
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
          {tooltip.row.over_end && (
            <p className="text-red-300 mt-0.5">⚠ Ends after the initiative target end</p>
          )}
          {criticalSet.has(tooltip.row.id) && (
            <p className="text-amber-300 mt-0.5">⚡ On the critical path</p>
          )}
          {tooltip.row.baseline_end && tooltip.row.end_date && tooltip.row.baseline_end !== tooltip.row.end_date && (
            <p className="text-white/60 mt-0.5">Baseline end: {tooltip.row.baseline_end}</p>
          )}
        </div>
      )}

      {/* Reschedule confirmation — dates only persist after the user confirms. */}
      {pending && (() => {
        const row = rows.find((r) => r.id === pending.rowId);
        const fmt = (d: Date) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
        const startChanged = toISO(pending.oldStart) !== toISO(pending.newStart);
        const endChanged = toISO(pending.oldEnd) !== toISO(pending.newEnd);
        return (
          <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4"
            onClick={() => setPending(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-base font-bold text-midnight">Reschedule {row?.title ? `“${row.title}”` : "this item"}?</h2>
              <p className="text-[12.5px] text-steel mt-1 mb-3">Confirm the new dates — nothing changes until you do.</p>
              <div className="space-y-2">
                <div className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-[13px]", startChanged ? "bg-mist" : "opacity-60")}>
                  <span className="text-steel">Start</span>
                  <span className="text-midnight">{fmt(pending.oldStart)} <span className="text-steel/50">→</span> <b>{fmt(pending.newStart)}</b></span>
                </div>
                <div className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-[13px]", endChanged ? "bg-mist" : "opacity-60")}>
                  <span className="text-steel">End</span>
                  <span className="text-midnight">{fmt(pending.oldEnd)} <span className="text-steel/50">→</span> <b>{fmt(pending.newEnd)}</b></span>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={() => setPending(null)}
                  className="h-9 rounded-lg border border-pebble px-4 text-sm font-semibold text-steel hover:bg-mist">Cancel</button>
                <button type="button"
                  onClick={() => { onBarChange?.(pending.rowId, toISO(pending.newStart), toISO(pending.newEnd)); setPending(null); }}
                  className="h-9 rounded-lg bg-midnight px-4 text-sm font-semibold text-white hover:opacity-90">Confirm</button>
              </div>
            </div>
          </div>
        );
      })()}
      </div>
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
  // Long plans need the month scale, or a day-scale chart gets so wide the
  // bars sit off-screen and the view looks empty. Short plans stay day-scale.
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000);
  const modalScale: "day" | "month" = spanDays > 45 ? "month" : "day";

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
            <GanttSVG rows={rows} ganttStart={start} ganttEnd={end} scale={modalScale} />
          )}
        </div>
      </div>
    </div>
  );
}
