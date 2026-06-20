"use client";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * App-wide toast + the universal "undo" surface. Built on Radix Toast so it
 * gets focus management, swipe-to-dismiss, and a11y for free.
 *
 *   const { toast } = useToast();
 *   toast({ title: "Card deleted", action: { label: "Undo", onClick: restore } });
 *
 * The `action` slot is how every destructive action becomes reversible: do the
 * delete optimistically, hand back an undo callback, and the toast offers it
 * for ~6s. Mount <ToastProvider> once near the root (done in the app layout).
 */
type ToastAction = { label: string; onClick: () => void };
type ToastVariant = "default" | "success" | "error";
export type ToastInput = {
  title: string;
  description?: string;
  action?: ToastAction;
  variant?: ToastVariant;
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

const ToastCtx = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  // No-op fallback keeps callers safe if used outside the provider (tests/SSR).
  return ctx ?? { toast: (_t: ToastInput) => {} };
}

let _seq = 0;

const VARIANT_BAR: Record<ToastVariant, string> = {
  default: "bg-midnight",
  success: "bg-emerald-500",
  error: "bg-taskora-red",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((t: ToastInput) => {
    setItems((prev) => [...prev, { ...t, id: ++_seq }]);
  }, []);
  const remove = useCallback(
    (id: number) => setItems((prev) => prev.filter((x) => x.id !== id)),
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastCtx.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={6000}>
        {children}
        {items.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration ?? 6000}
            onOpenChange={(open) => { if (!open) remove(t.id); }}
            className={cn(
              "relative flex items-start gap-3 overflow-hidden rounded-xl bg-white",
              "border border-pebble shadow-2xl px-4 py-3 pl-5",
              "data-[state=open]:animate-scale-in data-[swipe=end]:animate-fade-in",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("absolute left-0 top-0 bottom-0 w-[3px]", VARIANT_BAR[t.variant ?? "default"])}
            />
            <div className="min-w-0 flex-1">
              <ToastPrimitive.Title className="text-[13px] font-semibold text-midnight">
                {t.title}
              </ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-[12px] text-steel mt-0.5">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            {t.action && (
              <ToastPrimitive.Action altText={t.action.label} asChild>
                <button
                  type="button"
                  onClick={() => { t.action!.onClick(); remove(t.id); }}
                  className="flex-shrink-0 text-[12.5px] font-semibold text-taskora-red hover:underline"
                >
                  {t.action.label}
                </button>
              </ToastPrimitive.Action>
            )}
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="flex-shrink-0 text-steel/60 hover:text-steel text-[15px] leading-none -mt-0.5"
            >
              ×
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] m-0 flex w-[360px] max-w-[calc(100vw-2rem)] list-none flex-col gap-2 p-0 outline-none" />
      </ToastPrimitive.Provider>
    </ToastCtx.Provider>
  );
}
