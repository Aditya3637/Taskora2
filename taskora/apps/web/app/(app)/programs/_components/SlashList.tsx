"use client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type SlashItem = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  // Runs the editor action. range = the "/query" range to delete first.
  command: (args: { editor: any; range: any }) => void;
};

/**
 * The "/" command palette. Driven by TipTap's suggestion utility (same plumbing
 * as the @-mention list): receives filtered `items` + `command` (which runs the
 * chosen item's editor action). Exposes onKeyDown for arrow/enter routing.
 */
export const SlashList = forwardRef(function SlashList(
  props: { items: SlashItem[]; command: (item: SlashItem) => void },
  ref,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.items]);

  const pick = (i: number) => { const it = props.items[i]; if (it) props.command(it); };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const n = props.items.length;
      if (!n) return false;
      if (event.key === "ArrowDown") { setSelected((s) => (s + 1) % n); return true; }
      if (event.key === "ArrowUp") { setSelected((s) => (s - 1 + n) % n); return true; }
      if (event.key === "Enter") { pick(selected); return true; }
      return false;
    },
  }));

  if (!props.items.length) {
    return <div className="wd-mention-pop px-3 py-2 text-xs text-fg-subtle">No matching block</div>;
  }
  return (
    <div className="wd-mention-pop">
      {props.items.map((item, i) => {
        const Icon = item.icon;
        return (
          <button
            key={item.title}
            onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            onMouseEnter={() => setSelected(i)}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left ${i === selected ? "bg-mist" : ""}`}
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md border border-pebble bg-white shrink-0">
              <Icon className="w-4 h-4 text-fg-muted" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-fg">{item.title}</span>
              <span className="block text-[11px] text-fg-subtle truncate">{item.subtitle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
});
