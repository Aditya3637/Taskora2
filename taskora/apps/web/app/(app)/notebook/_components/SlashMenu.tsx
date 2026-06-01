"use client";
import { useEffect, useMemo, useState } from "react";
import type { BlockKind } from "../_lib/types";

/**
 * Notion-style slash command menu.
 *
 * Triggered by the parent when the user types '/' at the start of an
 * empty text block. The menu shows a searchable list of block kinds;
 * arrow keys navigate, Enter inserts, Esc closes.
 *
 * Positioning is delegated to the parent (absolute on top of the
 * triggering textarea). This keeps the component dumb and reusable.
 */
export interface MenuItem {
  kind: BlockKind;
  label: string;
  hint: string;
  icon: string;
  keywords: string[];
}

const ITEMS: MenuItem[] = [
  { kind: "text",     label: "Text",         hint: "Plain paragraph",        icon: "¶",  keywords: ["text", "paragraph", "p"] },
  { kind: "heading",  label: "Heading 1",    hint: "Big section title",      icon: "H1", keywords: ["h1", "heading", "title"] },
  { kind: "heading",  label: "Heading 2",    hint: "Medium subsection",      icon: "H2", keywords: ["h2", "heading", "subtitle"] },
  { kind: "heading",  label: "Heading 3",    hint: "Small subsection",       icon: "H3", keywords: ["h3", "heading"] },
  { kind: "bullet",   label: "Bulleted list",hint: "Simple bullets",         icon: "•",  keywords: ["bullet", "list", "ul"] },
  { kind: "numbered", label: "Numbered list",hint: "Ordered list",           icon: "1.", keywords: ["numbered", "ordered", "ol", "list"] },
  { kind: "todo",     label: "To-do",        hint: "Check off as you go",    icon: "☐",  keywords: ["todo", "task", "checkbox", "check"] },
  { kind: "quote",    label: "Quote",        hint: "Highlighted aside",      icon: "❝",  keywords: ["quote", "blockquote", "callout"] },
  { kind: "code",     label: "Code",         hint: "Monospace block",        icon: "</>", keywords: ["code", "monospace", "snippet"] },
  { kind: "callout",  label: "Callout",      hint: "Tip / note / warning",   icon: "💡", keywords: ["callout", "note", "tip", "warning"] },
  { kind: "divider",  label: "Divider",      hint: "Horizontal rule",        icon: "—",  keywords: ["divider", "hr", "separator"] },
  { kind: "table",    label: "Table",        hint: "Grid with formulas",     icon: "▦",  keywords: ["table", "spreadsheet", "grid"] },
  { kind: "image",    label: "Image",        hint: "Paste, drop, or upload",  icon: "🖼", keywords: ["image", "picture", "photo", "img", "screenshot", "paste"] },
];

/** The kind label uniquely identifies an item including heading level. */
export function itemPayload(item: MenuItem): { kind: BlockKind; level?: 1 | 2 | 3 } {
  if (item.kind === "heading") {
    if (item.label.endsWith("1")) return { kind: "heading", level: 1 };
    if (item.label.endsWith("2")) return { kind: "heading", level: 2 };
    if (item.label.endsWith("3")) return { kind: "heading", level: 3 };
  }
  return { kind: item.kind };
}

export default function SlashMenu({
  query,
  onPick,
  onClose,
}: {
  query: string;
  onPick: (payload: { kind: BlockKind; level?: 1 | 2 | 3 }) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ITEMS;
    return ITEMS.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.keywords.some((k) => k.includes(q)),
    );
  }, [query]);

  const [active, setActive] = useState(0);

  // Keep the active index in range when filtering shrinks the list.
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(1, filtered.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[active];
        if (item) onPick(itemPayload(item));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, active, onPick, onClose]);

  if (filtered.length === 0) {
    return (
      <div className="absolute z-30 bg-white border border-pebble rounded-lg shadow-lg p-2 text-xs text-steel/60 min-w-[260px]">
        No matches for &quot;/{query}&quot;
      </div>
    );
  }

  return (
    <div className="absolute z-30 bg-white border border-pebble rounded-lg shadow-lg py-1 min-w-[260px] max-h-72 overflow-y-auto">
      {filtered.map((item, i) => (
        <button
          key={item.label}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(itemPayload(item));
          }}
          onMouseEnter={() => setActive(i)}
          className={`w-full text-left flex items-center gap-3 px-3 py-1.5 ${
            i === active ? "bg-pebble/60" : "hover:bg-pebble/30"
          }`}
        >
          <span className="w-6 h-6 inline-flex items-center justify-center text-xs font-mono text-steel/80 bg-pebble/60 rounded flex-shrink-0">
            {item.icon}
          </span>
          <span className="flex-1 min-w-0">
            <div className="text-sm text-midnight">{item.label}</div>
            <div className="text-[11px] text-steel/70 truncate">{item.hint}</div>
          </span>
        </button>
      ))}
    </div>
  );
}
