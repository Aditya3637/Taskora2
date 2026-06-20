"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/ui";

/**
 * Global command palette (⌘K / Ctrl+K). Two sources:
 *  - Go to: the 7 surfaces (static, filtered).
 *  - Jump to: live search via /mentions/search (initiatives, tasks, buildings,
 *    clients, people) — reused from the doc @-picker.
 * Mounted once globally in the app layout. Additive; never blocks the page.
 */
type Cmd = { id: string; label: string; sub: string; run: () => void };

const SURFACES: { label: string; href: string }[] = [
  { label: "Home", href: "/home" },
  { label: "Roadmap", href: "/roadmap" },
  { label: "Work", href: "/tasks" },
  { label: "Sites", href: "/sites" },
  { label: "People", href: "/people" },
  { label: "Insights", href: "/insights" },
  { label: "Notebook", href: "/notebook" },
];

// Where a search hit routes (to the owning surface; exact-item deep-links TBD).
function hrefForType(type: string): string | null {
  if (type === "initiative" || type === "program") return "/roadmap";
  if (type === "task" || type === "subtask" || type === "entity") return "/tasks";
  if (type === "building" || type === "client") return "/sites";
  if (type === "user") return "/people";
  return null;
}

export default function CommandK() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [jump, setJump] = useState<Cmd[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Toggle on ⌘K / Ctrl+K; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("taskora:command-k", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("taskora:command-k", onOpen);
    };
  }, []);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQ("");
      setJump([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const go = useCallback((href: string) => { setOpen(false); router.push(href); }, [router]);

  // Debounced jump search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setJump([]); return; }
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : "";
    if (!bid) return;
    const t = setTimeout(async () => {
      try {
        const data = await apiFetch(
          `/api/v1/mentions/search?business_id=${encodeURIComponent(bid)}&q=${encodeURIComponent(term)}`,
        );
        const results: Cmd[] = (data?.results ?? [])
          .map((r: { type: string; id: string; label: string; sub: string }) => {
            const href = hrefForType(r.type);
            if (!href) return null;
            return { id: r.id, label: r.label || "(untitled)", sub: r.sub, run: () => go(href) };
          })
          .filter(Boolean) as Cmd[];
        setJump(results);
        setActive(0);
      } catch { setJump([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [q, open, go]);

  const navCmds: Cmd[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    return SURFACES
      .filter((s) => !term || s.label.toLowerCase().includes(term))
      .map((s) => ({ id: `nav:${s.href}`, label: s.label, sub: "Go to", run: () => go(s.href) }));
  }, [q, go]);

  // Create actions — route to the owning surface with ?new so it opens the
  // create flow on arrival.
  const createCmds: Cmd[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = [
      { id: "new:task", label: "New task", href: "/tasks?new=1" },
      { id: "new:initiative", label: "New initiative", href: "/programs?new=1" },
    ];
    return all
      .filter((c) => !term || c.label.toLowerCase().includes(term) || "create new".includes(term))
      .map((c) => ({ id: c.id, label: c.label, sub: "Create", run: () => go(c.href) }));
  }, [q, go]);

  const items = useMemo(() => [...createCmds, ...navCmds, ...jump], [createCmds, navCmds, jump]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[12vh] px-4 bg-black/40" onClick={close}>
      <div
        className="w-full max-w-[560px] rounded-xl bg-white shadow-2xl border border-pebble overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-pebble">
          <Search className="h-4 w-4 text-steel" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search or jump to…"
            className="flex-1 text-[14px] text-midnight outline-none placeholder:text-steel/60"
          />
          <kbd className="text-[10px] text-steel/60 border border-pebble rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-steel">No matches.</p>
          ) : (
            <>
              {createCmds.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-steel/60">Create</div>
              )}
              {createCmds.map((c, i) => (
                <Row key={c.id} cmd={c} activeRow={active === i} onHover={() => setActive(i)} />
              ))}
              {navCmds.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-steel/60">Go to</div>
              )}
              {navCmds.map((c, i) => {
                const idx = createCmds.length + i;
                return <Row key={c.id} cmd={c} activeRow={active === idx} onHover={() => setActive(idx)} />;
              })}
              {jump.length > 0 && (
                <div className="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wide text-steel/60">Jump to</div>
              )}
              {jump.map((c, j) => {
                const idx = createCmds.length + navCmds.length + j;
                return <Row key={`${c.id}:${j}`} cmd={c} activeRow={active === idx} onHover={() => setActive(idx)} />;
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ cmd, activeRow, onHover }: { cmd: Cmd; activeRow: boolean; onHover: () => void }) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={cmd.run}
      className={cn(
        "w-full text-left flex items-center gap-2 px-3.5 py-2 text-[13px]",
        activeRow ? "bg-mist" : "hover:bg-mist/50",
      )}
    >
      <span className="flex-1 truncate text-midnight">{cmd.label}</span>
      <span className="text-[11px] text-steel/70">{cmd.sub}</span>
      {activeRow && <CornerDownLeft className="h-3.5 w-3.5 text-steel/50" />}
    </button>
  );
}
