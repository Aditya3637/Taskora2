"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

/**
 * Minimal anchored popover — portal-rendered, positioned under its trigger,
 * closes on outside-click / Escape / scroll. Built without a new Radix dep
 * (react-popover isn't installed) so DatePicker/Select can share one calm
 * surface. Controlled-open by the consumer.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  align = "start",
  width,
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  align?: "start" | "end";
  width?: number;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const w = width ?? r.width;
    const left = align === "end" ? r.right - w : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - w - 8)) });
  }, [open, anchorRef, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ top: pos.top, left: pos.left, width }}
      className={cn(
        "fixed z-[90] rounded-xl border border-pebble bg-white shadow-2xl animate-scale-in",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
