"use client";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Portal-based dropdown menu (Radix). Replaces hand-rolled menus that lived
 * inside `overflow-hidden` containers and silently clipped to nothing (the
 * "kebab opens nothing" bug). Content renders in a portal with proper
 * focus/escape/outside-click handling.
 *
 *   <Menu trigger={<button>⋯</button>}>
 *     <MenuItem onSelect={edit}>Edit</MenuItem>
 *     <MenuSeparator />
 *     <MenuItem danger onSelect={remove}>Delete</MenuItem>
 *   </Menu>
 */
export function Menu({
  trigger,
  children,
  align = "end",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className={cn(
            "z-[80] min-w-[184px] rounded-xl border border-pebble bg-white p-1 shadow-2xl",
            "data-[state=open]:animate-scale-in origin-[var(--radix-dropdown-menu-content-transform-origin)]",
          )}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item
      disabled={disabled}
      onSelect={(e) => { e.preventDefault(); onSelect?.(); }}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none",
        "data-[disabled]:opacity-40 data-[disabled]:cursor-default",
        danger
          ? "text-red-600 data-[highlighted]:bg-red-50"
          : "text-midnight data-[highlighted]:bg-mist",
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1 h-px bg-pebble/70" />;
}
