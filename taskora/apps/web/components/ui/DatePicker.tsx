"use client";
import { useRef, useState } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Popover } from "./Popover";
import { cn } from "./cn";

const WD = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parse(s?: string | null) { if (!s) return null; const [y, m, d] = s.split("T")[0].split("-").map(Number); return y ? new Date(y, (m || 1) - 1, d || 1) : null; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

/**
 * Calm custom date picker — replaces native type="date" chrome with a
 * portal-popover month grid. value/onChange use ISO yyyy-mm-dd. Optional
 * clearable (for optional-capture dates) and min bound.
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  size = "md",
  clearable = false,
  min,
  disabled = false,
  align = "start",
}: {
  value?: string | null;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  clearable?: boolean;
  min?: string | null;
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = parse(value);
  const minD = parse(min);
  const [view, setView] = useState(() => selected ?? new Date());

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = new Date();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));

  const fmt = selected
    ? selected.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-lg border border-pebble bg-white text-midnight",
          "hover:border-steel/50 focus:outline-none focus:ring-2 focus:ring-taskora-red/30 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          size === "sm" ? "h-8 px-2.5 text-[12.5px]" : "h-9 px-3 text-[13px]",
          className,
        )}
      >
        <span className={cn("flex items-center gap-2 truncate", !fmt && "text-steel/70")}>
          <CalIcon className="h-3.5 w-3.5 text-steel/60" />
          <span className="truncate">{fmt ?? placeholder}</span>
        </span>
        {clearable && selected && (
          <X
            className="h-3.5 w-3.5 text-steel/50 hover:text-taskora-red"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
          />
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align={align} width={252} className="p-3">
        <div className="flex items-center justify-between mb-2">
          <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-mist text-steel">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[13px] font-semibold text-midnight">{MONTHS[view.getMonth()]} {view.getFullYear()}</span>
          <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-mist text-steel">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {WD.map((w, i) => <div key={i} className="h-6 flex items-center justify-center text-[10px] font-semibold text-steel/60">{w}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const isSel = selected && sameDay(d, selected);
            const isToday = sameDay(d, today);
            const isDisabled = !!minD && d < minD;
            return (
              <button
                key={i}
                type="button"
                disabled={isDisabled}
                onClick={() => { onChange(toISO(d)); setOpen(false); }}
                className={cn(
                  "h-8 w-8 rounded-md text-[12.5px] flex items-center justify-center transition-colors",
                  isDisabled && "opacity-30 cursor-not-allowed",
                  isSel ? "bg-taskora-red text-white font-semibold"
                    : isToday ? "text-taskora-red font-semibold hover:bg-mist"
                      : "text-midnight hover:bg-mist",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
        {clearable && (
          <button type="button" onClick={() => { onChange(null); setOpen(false); }}
            className="mt-2 w-full text-[12px] text-steel hover:text-taskora-red py-1">Clear date</button>
        )}
      </Popover>
    </>
  );
}
