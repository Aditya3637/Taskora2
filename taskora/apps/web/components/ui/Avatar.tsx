"use client";
import { useMemo } from "react";
import { cn } from "./cn";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, string> = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-12 w-12 text-base",
};

// Stable hash → pick one of N gradient seeds. Same name always gets the
// same color. Keeps the avatar grid feeling cohesive (no random clash).
const GRADIENTS = [
  "from-brand-500 to-brand-700",
  "from-info-500 to-info-700",
  "from-success-500 to-success-700",
  "from-warn-500 to-warn-700",
  "from-fuchsia-500 to-fuchsia-700",
  "from-violet-500 to-violet-700",
  "from-teal-500 to-teal-700",
  "from-rose-500 to-rose-700",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Identity avatar — initials over a deterministic gradient so the same
 * name always shows the same colors. Pass `src` to render a real image
 * (falls back to initials on load failure via `onError`).
 */
export function Avatar({
  name,
  src,
  size = "md",
  className,
  square,
}: {
  name: string;
  src?: string | null;
  size?: Size;
  className?: string;
  /** Square (rounded) for workspaces; circle (default) for people. */
  square?: boolean;
}) {
  const gradient = useMemo(() => GRADIENTS[hash(name || "?") % GRADIENTS.length], [name]);
  return (
    <span
      role="img"
      aria-label={`${name} avatar`}
      className={cn(
        "inline-flex items-center justify-center font-semibold text-white flex-shrink-0 shadow-sm select-none",
        "bg-gradient-to-br",
        gradient,
        square ? "rounded-lg" : "rounded-full",
        SIZES[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className={cn(
            "h-full w-full object-cover",
            square ? "rounded-lg" : "rounded-full",
          )}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
