"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { StickyNote, ChevronLeft, ChevronRight, Plus, Trash2, ArrowRightToLine, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn, useToast } from "@/components/ui";

/**
 * Quick Capture — a tiny global scratch pad. Bottom-right FAB stacked above
 * the persona switcher (clear of the bell, top-right) or ⌘/Ctrl+Shift+Space.
 * Small cards (~100 words), flip left/right, autosave, "move to" a Notebook
 * page (which clears the card), delete with undo. Never changes route or
 * blocks the page behind it.
 */
type Note = { id: string; content: string };
type Page = { id: string; title: string };

const SOFT_WORD_CAP = 100;

export default function QuickCapture() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [moveOpen, setMoveOpen] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const current = notes[idx];

  const load = useCallback(async () => {
    try {
      const data = await apiFetch("/api/v1/quick-notes");
      setNotes(Array.isArray(data) ? data.map((n: any) => ({ id: n.id, content: n.content ?? "" })) : []);
    } catch { /* transient */ }
  }, []);

  async function addCard(content = "") {
    try {
      const n = await apiFetch("/api/v1/quick-notes", { method: "POST", body: JSON.stringify({ content }) });
      setNotes((prev) => {
        const next = [...prev, { id: n.id, content: n.content ?? content }];
        setIdx(next.length - 1);
        return next;
      });
      return n.id as string;
    } catch { return null; }
  }

  // Open: load the stack, ensure at least one card, fetch pages for "move to".
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      await load();
      setNotes((prev) => prev); // keep
      try {
        const ps = await apiFetch("/api/v1/notebook/pages");
        setPages(Array.isArray(ps) ? ps.map((p: any) => ({ id: p.id, title: p.title || "Untitled" })) : []);
      } catch { /* non-critical */ }
    } else {
      setMoveOpen(false);
    }
  }

  // After load, make sure there's a card to type into.
  useEffect(() => {
    if (open && notes.length === 0) { void addCard(""); }
    if (idx > notes.length - 1) setIdx(Math.max(0, notes.length - 1));
  }, [open, notes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global shortcut + Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "Space") {
        e.preventDefault();
        void toggle();
      } else if (e.key === "Escape" && open) {
        setOpen(false); setMoveOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) { setOpen(false); setMoveOpen(false); }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function editContent(v: string) {
    if (!current) return;
    const id = current.id;
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, content: v } : n)));
    if (saveTimers.current[id]) clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      apiFetch(`/api/v1/quick-notes/${id}`, { method: "PATCH", body: JSON.stringify({ content: v }) }).catch(() => {});
    }, 600);
  }

  function flip(d: 1 | -1) {
    setDir(d);
    setIdx((i) => Math.min(notes.length - 1, Math.max(0, i + d)));
  }

  async function removeCard() {
    if (!current) return;
    const removed = current;
    const at = idx;
    setNotes((prev) => prev.filter((n) => n.id !== removed.id));
    setIdx((i) => Math.max(0, Math.min(i, notes.length - 2)));
    try {
      await apiFetch(`/api/v1/quick-notes/${removed.id}`, { method: "DELETE" });
    } catch { /* best effort */ }
    toast({
      title: "Card deleted",
      action: {
        label: "Undo",
        onClick: async () => {
          const id = await addCard(removed.content);
          if (id) setIdx(Math.min(at, notes.length - 1));
        },
      },
    });
  }

  async function moveToPage(pageId: string, pageTitle: string) {
    if (!current) return;
    const id = current.id;
    setMoveOpen(false);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setIdx((i) => Math.max(0, i - 1));
    try {
      await apiFetch(`/api/v1/quick-notes/${id}/move-to-page`, { method: "POST", body: JSON.stringify({ page_id: pageId }) });
      toast({ title: "Moved to page", description: pageTitle, variant: "success" });
    } catch (e: any) {
      toast({ title: "Couldn’t move card", description: e?.message, variant: "error" });
      void load();
    }
  }

  const words = current ? current.content.trim().split(/\s+/).filter(Boolean).length : 0;
  const over = words > SOFT_WORD_CAP;

  return (
    <div className="fixed bottom-20 right-5 z-[60]" ref={panelRef}>
      {open && (
        <div className="absolute bottom-12 right-0 w-[320px] rounded-2xl border border-pebble bg-white shadow-2xl animate-scale-in origin-bottom-right overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 h-10 border-b border-pebble">
            <StickyNote className="h-4 w-4 text-taskora-red" />
            <span className="text-[13px] font-semibold text-midnight">Quick capture</span>
            <span className="ml-auto text-[11px] text-steel/70 tabular">
              {notes.length > 0 ? `${idx + 1} / ${notes.length}` : "0"}
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-steel/60 hover:text-steel">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-3">
            <div key={current?.id ?? "empty"} className={cn("animate-fade-in", dir === 1 ? "" : "")}>
              <textarea
                autoFocus
                value={current?.content ?? ""}
                onChange={(e) => editContent(e.target.value)}
                placeholder="Jot a quick thought…"
                rows={5}
                className="w-full resize-none rounded-lg border border-pebble bg-white p-2.5 text-[13px] text-midnight outline-none focus:border-taskora-red"
              />
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("text-[11px]", over ? "text-amber-600 font-medium" : "text-steel/60")}>
                {over ? "Long — consider moving to a page" : `${words} word${words === 1 ? "" : "s"}`}
              </span>
            </div>
          </div>

          {/* Move-to-page picker */}
          {moveOpen && (
            <div className="border-t border-pebble max-h-44 overflow-y-auto">
              {pages.length === 0 ? (
                <p className="px-3.5 py-3 text-[12px] text-steel">No notebook pages yet.</p>
              ) : (
                pages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => moveToPage(p.id, p.title)}
                    className="w-full text-left px-3.5 py-2 text-[12.5px] text-midnight hover:bg-mist border-t border-pebble/40 first:border-t-0"
                  >
                    {p.title}
                  </button>
                ))
              )}
            </div>
          )}

          <div className="flex items-center gap-1 px-2.5 h-11 border-t border-pebble">
            <button type="button" onClick={() => flip(-1)} disabled={idx <= 0} aria-label="Previous card"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:bg-mist disabled:opacity-30">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => flip(1)} disabled={idx >= notes.length - 1} aria-label="Next card"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:bg-mist disabled:opacity-30">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => addCard("")} aria-label="New card"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:bg-mist">
              <Plus className="h-4 w-4" />
            </button>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => setMoveOpen((v) => !v)} disabled={!current}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-midnight hover:bg-mist disabled:opacity-30">
                <ArrowRightToLine className="h-3.5 w-3.5" /> Move to page
              </button>
              <button type="button" onClick={removeCard} disabled={!current} aria-label="Delete card"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md text-steel hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label="Quick capture (⌘⇧Space)"
        title="Quick capture (⌘⇧Space)"
        className={cn(
          "h-10 w-10 inline-flex items-center justify-center rounded-full shadow-lg transition-colors",
          "bg-midnight text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taskora-red/40",
        )}
      >
        <StickyNote className="h-[18px] w-[18px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}
