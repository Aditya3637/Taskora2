"use client";
import { cn } from "./cn";

const SIZES = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-[1.5px]",
  md: "h-5 w-5 border-2",
  lg: "h-7 w-7 border-2",
  xl: "h-10 w-10 border-[3px]",
} as const;

type Size = keyof typeof SIZES;

/**
 * Inline spinner. Prefer {@link Skeleton} for content; this is for
 * inline action feedback (button loading, sidebar boot, etc).
 */
export function Spinner({
  size = "md",
  className,
  label = "Loading",
}: {
  size?: Size;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        "inline-block rounded-full border-line border-t-brand-500 animate-spin",
        SIZES[size],
        className,
      )}
    />
  );
}
