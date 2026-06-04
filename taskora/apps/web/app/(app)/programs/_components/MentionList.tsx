"use client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { FolderKanban, CheckSquare, User } from "lucide-react";

export type MentionItem = { type: "initiative" | "task" | "user"; id: string; label: string; sub: string };

const ICON = {
  initiative: FolderKanban,
  task: CheckSquare,
  user: User,
} as const;

/**
 * The @-mention dropdown. Driven by TipTap's suggestion utility: it passes
 * `items` (from our search API) and `command` (inserts the mention node).
 * Exposes onKeyDown so the suggestion plugin can route arrow/enter keys here.
 */
export const MentionList = forwardRef(function MentionList(
  props: { items: MentionItem[]; command: (item: { id: string; label: string }) => void },
  ref,
) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [props.items]);

  const pick = (i: number) => {
    const item = props.items[i];
    if (item) props.command({ id: item.id, label: item.label });
  };

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
    return <div className="wd-mention-pop px-3 py-2 text-xs text-fg-subtle">No matches</div>;
  }
  return (
    <div className="wd-mention-pop">
      {props.items.map((item, i) => {
        const Icon = ICON[item.type];
        return (
          <button
            key={item.id}
            onMouseDown={(e) => { e.preventDefault(); pick(i); }}
            onMouseEnter={() => setSelected(i)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
              i === selected ? "bg-mist" : ""
            }`}
          >
            <Icon className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
            <span className="truncate text-fg">{item.label || "Untitled"}</span>
            <span className="ml-auto text-[10px] text-fg-subtle shrink-0">{item.sub}</span>
          </button>
        );
      })}
    </div>
  );
});
