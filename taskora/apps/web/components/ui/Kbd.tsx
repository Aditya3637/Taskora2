"use client";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Single keyboard key. For chords, use {@link KbdChord} which adds a
 * subtle "+" between keys and groups them visually.
 */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

export function KbdChord({
  keys,
  className,
}: {
  keys: ReactNode[];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {keys.map((k, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          <Kbd>{k}</Kbd>
          {i < keys.length - 1 && (
            <span aria-hidden="true" className="text-fg-subtle text-[10px]">+</span>
          )}
        </span>
      ))}
    </span>
  );
}
