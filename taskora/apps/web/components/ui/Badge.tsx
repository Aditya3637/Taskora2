"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Tone =
  | "neutral"
  | "brand"
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "outline";

type Size = "sm" | "md";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-fg-muted",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-success-50 text-success-700",
  warn: "bg-warn-50 text-warn-700",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-info-50 text-info-700",
  outline: "bg-transparent text-fg-muted border border-line",
};

const SIZES: Record<Size, string> = {
  sm: "h-5 px-1.5 text-[10.5px] gap-1",
  md: "h-6 px-2 text-xs gap-1.5",
};

/**
 * Small status/label chip. Tones map to semantic states; `outline` is
 * the right pick for filter chips or neutral metadata.
 */
export function Badge({
  tone = "neutral",
  size = "sm",
  dot,
  icon,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
  size?: Size;
  dot?: boolean;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full whitespace-nowrap",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "neutral" && "bg-fg-subtle",
            tone === "brand" && "bg-brand-500",
            tone === "success" && "bg-success-500",
            tone === "warn" && "bg-warn-500",
            tone === "danger" && "bg-danger-500",
            tone === "info" && "bg-info-500",
            tone === "outline" && "bg-fg-subtle",
          )}
        />
      )}
      {icon}
      {children}
    </span>
  );
}
