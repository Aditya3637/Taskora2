"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FileText, CornerDownLeft, ArrowUp, ArrowDown, Plus } from "lucide-react";
import type { Page } from "../_lib/types";
import { Kbd, Badge, cn } from "@/components/ui";

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
      return [...all]
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
        .slice(0, 30);
    }
    const hits = all.filter((p) => p.title.toLowerCase().includes(needle));
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
      className="fixed inset-0 z-50 bg-chrome/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick switcher"
        className={cn(
          "w-full max-w-xl mx-4 overflow-hidden",
          "bg-surface border border-line rounded-xl shadow-xl",
          "animate-scale-in",
        )}
      >
        {/* Search row */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line">
          <Search aria-hidden="true" className="h-4 w-4 text-fg-subtle flex-shrink-0" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages or commands…"
            aria-label="Search pages"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-subtle/80 focus:outline-none"
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
          <Kbd>esc</Kbd>
        </div>

        {/* Results */}
        <div
          className="max-h-[60vh] overflow-y-auto py-1.5"
          style={{ overscrollBehavior: "contain" }}
        >
          {items.length === 0 && (
            <div className="px-4 py-10 text-center animate-fade-in">
              <p className="text-sm text-fg-muted mb-3">
                No pages match <span className="font-medium text-fg">&ldquo;{q}&rdquo;</span>
              </p>
              {onCreateNew && (
                <button
                  onClick={() => { onCreateNew(); onClose(); }}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-fg text-bg rounded-md hover:bg-fg/85 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Create &ldquo;{q}&rdquo;
                </button>
              )}
            </div>
          )}
          {items.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { onPick(p.id); onClose(); }}
              onMouseEnter={() => setIdx(i)}
              className={cn(
                "w-full text-left flex items-center gap-3 px-3 mx-1.5 my-0.5 py-2 rounded-md transition-colors duration-fast",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40",
                i === idx ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-7 w-7 inline-flex items-center justify-center rounded-md flex-shrink-0 text-base",
                  i === idx ? "bg-surface border border-line" : "bg-surface-2",
                )}
              >
                {p.icon || <FileText className="h-3.5 w-3.5 text-fg-subtle" strokeWidth={1.8} />}
              </span>
              <span className="flex-1 truncate text-[13.5px] text-fg font-medium">{p.title || "Untitled"}</span>
              {p.follower_role && (
                <Badge tone="outline" size="sm">{p.follower_role}</Badge>
              )}
              {i === idx && (
                <CornerDownLeft className="h-3.5 w-3.5 text-fg-subtle flex-shrink-0" strokeWidth={1.8} />
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-line bg-surface-2 px-4 h-9 flex items-center gap-4 text-[11px] text-fg-subtle">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              <Kbd><ArrowUp className="h-2.5 w-2.5" strokeWidth={2} /></Kbd>
              <Kbd><ArrowDown className="h-2.5 w-2.5" strokeWidth={2} /></Kbd>
            </span>
            navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd><CornerDownLeft className="h-2.5 w-2.5" strokeWidth={2} /></Kbd>
            open
          </span>
          <span className="ml-auto tabular">
            {items.length} page{items.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}
