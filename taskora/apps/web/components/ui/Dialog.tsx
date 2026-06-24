"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Modal dialog (Radix) — portal + overlay + focus trap + escape handling, so
 * every modal behaves the same. `ConfirmDialog` below is the standard
 * destructive-confirm built on it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[90] bg-black/40 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl bg-white p-5 shadow-2xl outline-none data-[state=open]:animate-scale-in",
            maxWidth,
          )}
        >
          <DialogPrimitive.Title className="text-base font-bold text-midnight">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-sm text-steel">
              {description}
            </DialogPrimitive.Description>
          )}
          {children && <div className="mt-3">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-lg border border-pebble px-4 text-sm font-semibold text-steel hover:bg-mist"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => { onConfirm(); onOpenChange(false); }}
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-semibold text-white hover:opacity-90",
              danger ? "bg-taskora-red" : "bg-midnight",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
