"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../_lib/types";

/**
 * Cmd/Ctrl+K quick switcher — Linear / Notion / VS Code style. Opens
 * a modal list of all pages (owned + shared). Type to filter; ↑/↓
 * navigate; Enter jumps; Esc closes.
 *
 * Stateless about hotkeys — the parent owns the open/close state and
 * listens for the global Cmd+K binding. This component focuses the
 * input on mount so the user can start typing immediately.
 */
export default function CommandPalette({
  pages,
  sharedPages,
  onPick,
  onClose,
  onCreateNew,
}: {
  pages: Page[];
  sharedPages: Page[];
  onPick: (id: string) => void;
  onClose: () => void;
  onCreateNew?: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const items = useMemo(() => {
    const all = [...pages, ...sharedPages];
    const needle = q.trim().toLowerCase();
    if (!needle) {
      // Recency-ranked default list.
      return [...all]
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
        .slice(0, 30);
    }
    // Fuzzy-ish: title contains needle. Cheap, predictable.
    const hits = all.filter((p) => p.title.toLowerCase().includes(needle));
    // Rank: exact-prefix > contains > everything else (by recency).
    return hits.sort((a, b) => {
      const ap = a.title.toLowerCase().startsWith(needle) ? 0 : 1;
      const bp = b.title.toLowerCase().startsWith(needle) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
  }, [q, pages, sharedPages]);

  useEffect(() => { if (idx >= items.length) setIdx(0); }, [items.length, idx]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-24"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-pebble rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
      >
        <div className="border-b border-pebble px-3 py-2 flex items-center gap-2">
          <span className="text-steel/50">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages…"
            className="flex-1 text-sm bg-transparent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const hit = items[idx];
                if (hit) { onPick(hit.id); onClose(); }
              }
            }}
          />
          <kbd className="text-[10px] text-steel/60 border border-pebble rounded px-1">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-3 py-4 text-sm text-steel/60 italic text-center">
              No pages match &quot;{q}&quot;
              {onCreateNew && (
                <div className="mt-2">
                  <button
                    onClick={() => { onCreateNew(); onClose(); }}
                    className="text-xs px-2 py-1 bg-midnight text-white rounded hover:opacity-90"
                  >
                    + Create &quot;{q}&quot;
                  </button>
                </div>
              )}
            </div>
          )}
          {items.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { onPick(p.id); onClose(); }}
              onMouseEnter={() => setIdx(i)}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm ${
                i === idx ? "bg-pebble/60" : "hover:bg-pebble/30"
              }`}
            >
              <span className="w-5 text-center text-base flex-shrink-0">
                {p.icon || "📄"}
              </span>
              <span className="flex-1 truncate text-midnight">{p.title || "Untitled"}</span>
              {p.follower_role && (
                <span className="text-[10px] uppercase tracking-wide text-steel/50">
                  {p.follower_role}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="border-t border-pebble px-3 py-1.5 flex items-center gap-3 text-[10px] text-steel/60">
          <span><kbd className="border border-pebble rounded px-1">↑</kbd>{" "}<kbd className="border border-pebble rounded px-1">↓</kbd>{" "}navigate</span>
          <span><kbd className="border border-pebble rounded px-1">↵</kbd>{" "}open</span>
          <span className="ml-auto">{items.length} page{items.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
