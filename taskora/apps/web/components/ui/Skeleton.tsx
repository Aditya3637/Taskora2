"use client";
import { cn } from "./cn";

/**
 * Loading shimmer block. Use as a placeholder for content with known
 * dimensions — match the rendered element's geometry to avoid layout
 * shift when real content arrives. Always preferred over a centered
 * spinner for *content* (vs. action-button) loading.
 */
export function Skeleton({
  className,
  rounded = "md",
}: {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}) {
  const radius =
    rounded === "full" ? "rounded-full" :
    rounded === "lg"   ? "rounded-lg" :
    rounded === "sm"   ? "rounded-sm" :
                         "rounded-md";
  return <div className={cn("skeleton", radius, className)} aria-hidden="true" />;
}

/** Convenience for a multi-line text placeholder. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}
