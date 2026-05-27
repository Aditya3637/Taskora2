"use client";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

/**
 * Card primitives. Replaces the ad-hoc
 *   `bg-white rounded-2xl shadow-sm border border-pebble p-4`
 * pattern scattered across the app. Compose:
 *
 *   <Card>
 *     <CardHeader>
 *       <CardTitle>...</CardTitle>
 *       <CardDescription>...</CardDescription>
 *     </CardHeader>
 *     <CardBody>...</CardBody>
 *     <CardFooter>...</CardFooter>
 *   </Card>
 *
 * `tone="raised"` adds a stronger shadow for floating panels;
 * `tone="flat"` removes the shadow for nested groupings.
 */
type Tone = "default" | "raised" | "flat";
type Padding = "none" | "sm" | "md" | "lg";

const TONES: Record<Tone, string> = {
  default: "shadow-sm",
  raised: "shadow-md",
  flat: "shadow-none",
};

const PADDING: Record<Padding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export function Card({
  tone = "default",
  padding = "none",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone; padding?: Padding }) {
  return (
    <div
      className={cn(
        "bg-surface border border-line rounded-xl",
        TONES[tone],
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 pt-4 pb-3 flex items-start justify-between gap-3", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold text-fg tracking-tighter-1",
        className,
      )}
      {...rest}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-fg-subtle mt-0.5 leading-relaxed", className)} {...rest}>
      {children}
    </p>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padding?: Padding }) {
  return (
    <div className={cn("px-5 py-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 py-3 border-t border-line bg-surface-2 rounded-b-xl flex items-center justify-end gap-2",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardSection({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-4 border-t border-line first:border-t-0", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardEyebrow({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle",
        className,
      )}
    >
      {icon}
      {children}
    </div>
  );
}
