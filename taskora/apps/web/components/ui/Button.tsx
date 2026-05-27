"use client";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type Size = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

/**
 * App-wide button primitive. Variants encode hierarchy (primary >
 * secondary > subtle > ghost) and one explicit destructive path
 * (danger). Sizes use a 4px rhythm. Loading swaps the icon-left slot
 * for an inline spinner and disables the button.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap " +
  "rounded-md transition-colors duration-fast ease-out-soft " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-bg " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-fg text-bg hover:bg-fg/85 active:bg-fg shadow-sm",
  secondary:
    "bg-surface text-fg border border-line hover:bg-muted hover:border-line-strong",
  subtle:
    "bg-muted text-fg hover:bg-line",
  ghost:
    "bg-transparent text-fg-muted hover:bg-muted hover:text-fg",
  danger:
    "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1.5 rounded",
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
  lg: "h-10 px-5 text-sm",
};

const Spinner = ({ size }: { size: Size }) => (
  <svg
    aria-hidden="true"
    className={cn(
      "animate-spin",
      size === "xs" ? "h-3 w-3" : size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5",
    )}
    viewBox="0 0 24 24" fill="none"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    iconLeft,
    iconRight,
    fullWidth,
    disabled,
    className,
    children,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size} /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
});
