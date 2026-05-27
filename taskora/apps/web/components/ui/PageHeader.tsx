"use client";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Per-page header. Use as the first child of a feature page so titles,
 * subtitles, and primary actions render with a consistent visual rhythm
 * (spacing, type scale, optional eyebrow chip).
 *
 *   <PageHeader
 *     eyebrow="Workspace"
 *     title="Programs"
 *     description="Group initiatives that share a strategic theme."
 *     actions={<Button variant="primary">+ New program</Button>}
 *   />
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
  meta,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-6 pb-5 border-b border-line",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="inline-flex items-center gap-1.5 mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">
            {eyebrow}
          </div>
        )}
        <h1 className="font-display text-display-md text-fg tracking-tightest leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-fg-muted max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
        {meta && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </header>
  );
}
