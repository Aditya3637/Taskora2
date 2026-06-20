"use client";
import { useRef, useState, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Popover } from "./Popover";
import { cn } from "./cn";

export type SelectOption = { value: string; label: string; icon?: ReactNode };

/**
 * Calm custom select — replaces native <select> chrome. Portal-popover list
 * with check on the active value. Keyboard: Enter/Space opens; arrows + Enter
 * pick; Esc closes (handled by Popover).
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
  size = "md",
  disabled = false,
  align = "start",
}: {
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  function onKey(e: React.KeyboardEvent) {
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = options[active]; if (o) { onChange(o.value); setOpen(false); } }
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKey}
        className={cn(
          "inline-flex items-center justify-between gap-2 rounded-lg border border-pebble bg-white text-midnight",
          "hover:border-steel/50 focus:outline-none focus:ring-2 focus:ring-taskora-red/30 transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          size === "sm" ? "h-8 px-2.5 text-[12.5px]" : "h-9 px-3 text-[13px]",
          className,
        )}
      >
        <span className={cn("flex items-center gap-2 truncate", !current && "text-steel/70")}>
          {current?.icon}
          <span className="truncate">{current?.label ?? placeholder}</span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-steel/60 flex-shrink-0" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} align={align} width={Math.max(176, ref.current?.offsetWidth ?? 176)} className="p-1 max-h-[260px] overflow-y-auto">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => { onChange(o.value); setOpen(false); }}
            className={cn(
              "w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] text-left",
              active === i ? "bg-mist" : "hover:bg-mist/60",
            )}
          >
            {o.icon}
            <span className="flex-1 truncate text-midnight">{o.label}</span>
            {o.value === value && <Check className="h-3.5 w-3.5 text-taskora-red" />}
          </button>
        ))}
      </Popover>
    </>
  );
}
