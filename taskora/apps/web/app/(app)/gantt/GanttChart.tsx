"use client";
import { useState, useEffect } from "react";
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

/** Compute a sensible [start,end] window for a set of rows. */
export function ganttRange(rows: GanttRow[], baseStart?: string | null, baseEnd?: string | null) {
  const today = new Date();
  let start = addDays(today, -5);
  let end = addDays(today, 30);
  const s = parseDate(baseStart);
  const e = parseDate(baseEnd);
  if (s) start = addDays(s, -2);
  if (e) end = addDays(e, 5);
  rows.forEach((r) => {
    const rs = parseDate(r.start_date);
    const re = parseDate(r.end_date);
    if (rs && rs < start) start = addDays(rs, -2);
    if (re && re > end) end = addDays(re, 5);
  });
  return { start, end };
}

export function GanttSVG({ rows, ganttStart, ganttEnd }: { rows: GanttRow[]; ganttStart: Date; ganttEnd: Date }) {
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
        {rows.map((_, i) => (
          <rect key={i} x={0} y={rowY(i)} width={svgW} height={ROW_H}
            fill={i % 2 === 0 ? "#F7F8FA" : "#FFFFFF"} />
        ))}

        <rect x={0} y={0} width={svgW} height={HEADER_H} fill="#1a1a2e" />
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} y1={HEADER_H} x2={t.x} y2={svgH} stroke="#E2E8F0" strokeWidth={1} />
            <text x={t.x + 4} y={HEADER_H / 2 + 5} fill="#FFFFFF" fontSize={10} fontWeight={600}>{t.label}</text>
          </g>
        ))}

        {todayOffset >= 0 && todayOffset <= totalDays && (
          <>
            <line x1={LABEL_W + todayOffset * DAY_W} y1={HEADER_H}
              x2={LABEL_W + todayOffset * DAY_W} y2={svgH}
              stroke="#E53E3E" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={LABEL_W + todayOffset * DAY_W + 3} y={HEADER_H - 8}
              fill="#E53E3E" fontSize={9} fontWeight={700}>TODAY</text>
          </>
        )}

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

        <div className="overflow-auto flex-1">
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
