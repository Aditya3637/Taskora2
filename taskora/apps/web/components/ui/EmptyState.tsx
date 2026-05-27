"use client";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Page/section empty state. The hierarchy is intentional:
 *   - large icon (decorative, gradient bg)
 *   - title (display weight, balanced wrapping)
 *   - description (medium-length sentence, never a paragraph)
 *   - primary CTA (optional secondary as a ghost button)
 *   - keyboard hint footer (optional)
 *
 * Always wrap in a parent that owns layout — this component just
 * centers its content vertically inside whatever box you give it.
 */
export function EmptyState({
  icon,
  title,
  description,
  primary,
  secondary,
  hint,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  primary?: ReactNode;
  secondary?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "h-full flex flex-col items-center justify-center text-center px-6 py-12 animate-fade-up",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-5 h-14 w-14 flex items-center justify-center rounded-2xl bg-gradient-to-br from-muted to-surface-2 border border-line text-fg-muted shadow-xs"
        >
          {icon}
        </div>
      )}
      <h3 className="font-display text-lg font-semibold text-fg tracking-tighter-1 mb-1.5 max-w-sm">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-fg-muted leading-relaxed max-w-sm">
          {description}
        </p>
      )}
      {(primary || secondary) && (
        <div className="mt-6 flex items-center gap-2">
          {primary}
          {secondary}
        </div>
      )}
      {hint && (
        <div className="mt-6 text-[11px] text-fg-subtle flex items-center gap-2">
          {hint}
        </div>
      )}
    </div>
  );
}
