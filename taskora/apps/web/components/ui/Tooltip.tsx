"use client";
import { cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { cn } from "./cn";

type Side = "top" | "bottom" | "left" | "right";

const SIDE_STYLES: Record<Side, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

/**
 * Zero-dependency tooltip. Wraps a single interactive child and renders
 * a positioned label on hover/focus. Not a replacement for Radix's
 * collision-aware positioning — fine for short labels in known spots.
 *
 * Use `aria-describedby` wiring automatically (the child receives the id
 * pointing at the tooltip body) so screen readers pick it up alongside
 * the visible label.
 */
export function Tooltip({
  label,
  side = "top",
  children,
  delay = 350,
}: {
  label: ReactNode;
  side?: Side;
  children: ReactElement;
  delay?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const start = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setOpen(true), delay);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    setOpen(false);
  };

  if (!isValidElement(children)) return children;

  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    onMouseEnter: start,
    onMouseLeave: stop,
    onFocus: start,
    onBlur: stop,
    "aria-describedby": open ? id : undefined,
  });

  return (
    <span className="relative inline-flex">
      {trigger}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "absolute z-50 pointer-events-none select-none whitespace-nowrap",
            "px-2 py-1 rounded-md text-[11px] font-medium",
            "bg-chrome text-chrome-fg shadow-lg",
            "animate-fade-in",
            SIDE_STYLES[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
