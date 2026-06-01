"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Target,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Share2,
  Trash2,
  Maximize2,
  Minimize2,
  Notebook as NotebookIcon,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import Goals from "./_components/Goals";
import Checklist from "./_components/Checklist";
import CommandPalette from "./_components/CommandPalette";
import NotebookNav from "./_components/NotebookNav";
import PageEditor from "./_components/PageEditor";
import ShareModal from "./_components/ShareModal";
import ShortcutsHelp from "./_components/ShortcutsHelp";
import TrashModal from "./_components/TrashModal";
import type { Page, Person, Project } from "./_lib/types";
import { Button, EmptyState, Kbd, Tooltip, cn } from "@/components/ui";

type FocusMode = null | "goals" | "checklist" | "notebook";
const RATIO_KEY = "taskora_notebook_goals_pct";
const NAV_OPEN_KEY = "taskora_notebook_nav_open";
const LEFT_MIN_KEY = "taskora_notebook_left_minimized";

/**
 * Notebook surface — three coordinated zones in a book-spread:
 *
 *   ┌────────────┬─────────────────────────────────────────────────┐
 *   │ GOALS      │ NotebookNav (collapsible)   |  Editor           │
 *   ├────────────┤  Search                     |  Title            │
 *   │ CHECKLIST  │  + New page                 |  Block list       │
 *   │ [My][Asn•N]│  Recent / Projects / Shared │  (text, table,    │
 *   │            │                             │   slash, math…)   │
 *   └────────────┴─────────────────────────────────────────────────┘
 *
 * Goals + Checklist live on the left page; the right page hosts the
 * collapsible navigation sidebar plus the actual editor.
 *
 * One notebook per user, cross-workspace. Workspace switch does not
 * switch notebooks — that's enforced by the backend (no business_id
 * column on any notebook_* table).
 */
export default function NotebookPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [sharedPages, setSharedPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Sidebar open/closed — persisted per user via localStorage.
  const [navOpen, setNavOpen] = useState<boolean>(true);
  useEffect(() => {
    const v = typeof window !== "undefined" && localStorage.getItem(NAV_OPEN_KEY);
    if (v === "false") setNavOpen(false);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(NAV_OPEN_KEY, String(navOpen));
  }, [navOpen]);

  // Left panel (Goals + Checklist) collapse to a thin rail so the
  // notebook editor can take the bulk of the screen.
  const [leftMinimized, setLeftMinimized] = useState<boolean>(false);
  useEffect(() => {
    const v = typeof window !== "undefined" && localStorage.getItem(LEFT_MIN_KEY);
    if (v === "true") setLeftMinimized(true);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(LEFT_MIN_KEY, String(leftMinimized));
  }, [leftMinimized]);

  // Cmd/Ctrl+K quick switcher + `?` shortcuts cheat-sheet.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // `?` opens the cheat-sheet — but only when not typing into a field,
      // so a literal "?" in a note still works.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement as HTMLElement | null;
        const typing =
          !!el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setHelpOpen(true);
        }
        return;
      }
      // Alt+1/2/3 jump between sections; Alt+0 restores the full spread.
      // Match on e.code because Option+digit yields a symbol in e.key on
      // macOS (Option+1 = "¡"). Works even while typing — preventDefault
      // stops the symbol being inserted.
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const jump: Record<string, FocusMode> = {
          Digit1: "goals",
          Digit2: "checklist",
          Digit3: "notebook",
          Digit0: null,
        };
        if (e.code in jump) {
          e.preventDefault();
          const target = jump[e.code];
          if (target && target !== "notebook") setLeftMinimized(false);
          setFocus(target);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Bootstrap: projects, pages, workspace people.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projs, pagesAll, picker] = await Promise.all([
          apiFetch("/api/v1/notebook/projects") as Promise<Project[]>,
          apiFetch("/api/v1/notebook/pages") as Promise<Page[]>,
          apiFetch("/api/v1/notebook/people-picker?q=").catch(() => ({ in_workspace: [], external: [] })),
        ]);
        if (cancelled) return;
        setProjects(projs);
        setPages(pagesAll);
        setPeople((picker?.in_workspace ?? []) as Person[]);
        if (pagesAll[0]) setActivePageId(pagesAll[0].id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadShared = useCallback(async () => {
    const data = await apiFetch("/api/v1/notebook/pages?shared=true") as Page[];
    setSharedPages(data);
  }, []);
  useEffect(() => { void loadShared(); }, [loadShared]);

  // Re-fetch owned pages — used after restoring from trash so the
  // recovered page reappears in the sidebar tree.
  const reloadPages = useCallback(async () => {
    const pagesAll = await apiFetch("/api/v1/notebook/pages") as Page[];
    setPages(pagesAll);
  }, []);

  // Resolve the active page from either owned or shared lists.
  const activePage =
    activePageId == null
      ? null
      : pages.find((p) => p.id === activePageId)
        ?? sharedPages.find((p) => p.id === activePageId)
        ?? null;

  const isOwnerOfActive = activePage ? !activePage.follower_role : false;
  const canEditActive = isOwnerOfActive || activePage?.follower_role === "editor";

  // ── Actions ─────────────────────────────────────────────────────
  const createProject = async () => {
    const name = window.prompt("Project name?");
    if (!name || !name.trim()) return;
    const proj = (await apiFetch("/api/v1/notebook/projects", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    })) as Project;
    setProjects((prev) => [...prev, proj]);
  };

  const createPage = async (projectId: string | null) => {
    const page = (await apiFetch("/api/v1/notebook/pages", {
      method: "POST",
      body: JSON.stringify({ project_id: projectId, title: "Untitled", body: [] }),
    })) as Page;
    setPages((prev) => [page, ...prev]);
    setActivePageId(page.id);
  };

  const updatePageInList = (next: Page) => {
    setPages((prev) => prev.map((p) => (p.id === next.id ? { ...p, ...next } : p)));
  };

  const archivePage = async () => {
    if (!activePage || !isOwnerOfActive) return;
    if (!window.confirm(`Delete "${activePage.title}"? This can't be undone in v1.`)) return;
    await apiFetch(`/api/v1/notebook/pages/${activePage.id}`, { method: "DELETE" });
    setPages((prev) => prev.filter((p) => p.id !== activePage.id));
    setActivePageId(null);
  };

  // Focus mode + adjustable Goals/Checklist split.
  const [focus, setFocus] = useState<FocusMode>(null);
  const [goalsPct, setGoalsPct] = useState<number>(40);
  useEffect(() => {
    const stored = typeof window !== "undefined" && localStorage.getItem(RATIO_KEY);
    const n = stored ? Number(stored) : NaN;
    if (Number.isFinite(n) && n >= 20 && n <= 80) setGoalsPct(n);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(RATIO_KEY, String(goalsPct));
  }, [goalsPct]);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<boolean>(false);
  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    dragging.current = true;
    const move = (clientY: number) => {
      if (!dragging.current || !leftPanelRef.current) return;
      const box = leftPanelRef.current.getBoundingClientRect();
      const offsetTop = clientY - box.top;
      const pct = Math.round((offsetTop / box.height) * 100);
      setGoalsPct(Math.max(20, Math.min(80, pct)));
    };
    const onMouseMove = (ev: MouseEvent) => move(ev.clientY);
    const onTouchMove = (ev: TouchEvent) => move(ev.touches[0]?.clientY ?? 0);
    const stop = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", stop);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", stop);
  };

  const showLeft = focus === null || focus === "goals" || focus === "checklist";
  const showRight = focus === null || focus === "notebook";
  // Grid columns reflect three states:
  //   - focused: single column (the focused panel only)
  //   - left minimized: a thin rail on the left, notebook takes the rest
  //   - default: 30/70 book-spread
  const gridCols =
    focus !== null
      ? "md:grid-cols-1"
      : leftMinimized
      ? "md:grid-cols-[56px_1fr]"
      : "md:grid-cols-[3fr_7fr]";

  return (
    <div className="min-h-screen p-4 md:p-6 bg-bg">
      <div className={`grid grid-cols-1 ${gridCols} gap-4 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]`}>
        {/* ── LEFT PAGE: Goals + Checklist (with minimize rail) ─────── */}
        {showLeft && (
          leftMinimized && focus === null ? (
            // Compact rail — restores to default on click.
            <div className="surface-card flex flex-col items-center py-3 gap-1.5 animate-fade-in">
              <Tooltip label="Expand Goals + Checklist" side="right">
                <button
                  onClick={() => setLeftMinimized(false)}
                  aria-label="Expand Goals + Checklist"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <PanelLeftOpen className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </button>
              </Tooltip>
              <div className="h-px w-6 bg-line my-1" aria-hidden="true" />
              <Tooltip label="Open Goals" side="right">
                <button
                  onClick={() => { setLeftMinimized(false); setFocus("goals"); }}
                  aria-label="Open Goals"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <Target className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </button>
              </Tooltip>
              <Tooltip label="Open Checklist" side="right">
                <button
                  onClick={() => { setLeftMinimized(false); setFocus("checklist"); }}
                  aria-label="Open Checklist"
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <ListChecks className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </button>
              </Tooltip>
            </div>
          ) : (
            <div ref={leftPanelRef} className="surface-card p-4 flex flex-col overflow-hidden relative animate-fade-in">
              {focus === null && (
                <Tooltip label="Minimize Goals + Checklist" side="left">
                  <button
                    onClick={() => setLeftMinimized(true)}
                    aria-label="Minimize Goals + Checklist"
                    className="absolute top-2 right-2 z-20 h-7 w-7 inline-flex items-center justify-center rounded-md text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  >
                    <PanelLeftClose className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </Tooltip>
              )}

              {(focus === null || focus === "goals") && (
                <PanelFrame
                  focused={focus === "goals"}
                  onToggleFocus={() => setFocus(focus === "goals" ? null : "goals")}
                  style={focus === null ? { height: `${goalsPct}%` } : undefined}
                  className={focus === "goals" ? "flex-1" : ""}
                >
                  <Goals />
                </PanelFrame>
              )}

              {focus === null && (
                <div
                  onMouseDown={startDrag}
                  onTouchStart={startDrag}
                  className="h-2 -my-1 cursor-row-resize flex items-center justify-center group flex-shrink-0"
                  aria-label="Resize between Goals and Checklist"
                  role="separator"
                >
                  <div className="w-8 h-0.5 bg-line group-hover:bg-brand-500/60 rounded transition-colors duration-fast" />
                </div>
              )}

              {(focus === null || focus === "checklist") && (
                <PanelFrame
                  focused={focus === "checklist"}
                  onToggleFocus={() => setFocus(focus === "checklist" ? null : "checklist")}
                  className="flex-1 min-h-0 border-t border-pebble pt-3"
                >
                  <Checklist />
                </PanelFrame>
              )}
            </div>
          )
        )}

        {/* ── RIGHT PAGE: Nav + AI Notebook ─────────────────────────── */}
        {showRight && (
          <div className="surface-card flex flex-row overflow-hidden relative animate-fade-in">
            {/* Sidebar */}
            {navOpen ? (
              <NotebookNav
                projects={projects}
                pages={pages}
                sharedPages={sharedPages}
                activePageId={activePageId}
                onSelectPage={setActivePageId}
                onCreatePage={createPage}
                onCreateProject={createProject}
                onCollapse={() => setNavOpen(false)}
                onOpenTrash={() => setTrashOpen(true)}
              />
            ) : (
              <Tooltip label="Open notebook sidebar" side="right">
                <button
                  onClick={() => setNavOpen(true)}
                  aria-label="Open notebook sidebar"
                  className="w-9 flex-shrink-0 bg-surface-2 border-r border-line flex items-start justify-center pt-3 text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </Tooltip>
            )}

            {/* Editor area */}
            <div className="flex-1 flex flex-col overflow-hidden p-4 min-w-0">
              {/* Top action bar */}
              <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0 min-h-[28px]">
                <div className="text-[11px] text-fg-subtle truncate font-medium uppercase tracking-wider">
                  {activePage
                    ? activePage.follower_role
                      ? `Shared with you · ${activePage.follower_role}`
                      : "Your page"
                    : ""}
                </div>
                <div className="flex items-center gap-1">
                  {activePage && isOwnerOfActive && (
                    <>
                      <Button
                        size="xs"
                        variant="secondary"
                        iconLeft={<Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
                        onClick={() => setShareOpen(true)}
                      >
                        Share
                      </Button>
                      <Tooltip label="Delete page">
                        <button
                          onClick={archivePage}
                          aria-label="Delete page"
                          className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-subtle hover:text-danger-600 hover:bg-danger-50 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </button>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip label={focus === "notebook" ? "Exit focus" : "Focus this panel"}>
                    <button
                      onClick={() => setFocus(focus === "notebook" ? null : "notebook")}
                      aria-label={focus === "notebook" ? "Exit focus" : "Focus this panel"}
                      aria-pressed={focus === "notebook"}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      {focus === "notebook"
                        ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Editor or empty state */}
              <div className="flex-1 overflow-hidden">
                {loading ? (
                  <NotebookLoadingState />
                ) : !activePage ? (
                  <NotebookEmpty
                    hasPages={pages.length > 0}
                    onCreate={() => createPage(null)}
                  />
                ) : (
                  <PageEditor
                    page={activePage}
                    workspacePeople={people}
                    readOnly={!canEditActive}
                    onSaved={updatePageInList}
                    allPages={[...pages, ...sharedPages]}
                    onOpenPage={(id) => setActivePageId(id)}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {shareOpen && activePage && (
        <ShareModal pageId={activePage.id} onClose={() => setShareOpen(false)} />
      )}

      {paletteOpen && (
        <CommandPalette
          pages={pages}
          sharedPages={sharedPages}
          onPick={setActivePageId}
          onClose={() => setPaletteOpen(false)}
          onCreateNew={() => createPage(null)}
        />
      )}

      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}

      {trashOpen && (
        <TrashModal
          onClose={() => setTrashOpen(false)}
          onRestored={(restored) => {
            void reloadPages();
            setActivePageId(restored.id);
          }}
        />
      )}
    </div>
  );
}

function PanelFrame({
  focused,
  onToggleFocus,
  className = "",
  style,
  children,
}: {
  focused: boolean;
  onToggleFocus: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative ${focused ? "flex-1" : ""} ${className} overflow-hidden`}
      style={style}
    >
      <Tooltip label={focused ? "Exit focus" : "Focus this panel"}>
        <button
          onClick={onToggleFocus}
          aria-label={focused ? "Exit focus" : "Focus this panel"}
          aria-pressed={focused}
          className="absolute top-0 right-0 z-10 h-7 w-7 inline-flex items-center justify-center rounded text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          {focused
            ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
        </button>
      </Tooltip>
      <div className="h-full overflow-hidden pr-6">{children}</div>
    </div>
  );
}

function NotebookLoadingState() {
  return (
    <div className="h-full px-1 py-2 animate-fade-in">
      <div className="space-y-3 max-w-2xl">
        <div className="skeleton h-7 w-1/3 rounded" />
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-11/12 rounded" />
        <div className="skeleton h-3 w-9/12 rounded" />
        <div className="skeleton h-24 w-full rounded-lg mt-6" />
      </div>
    </div>
  );
}

function NotebookEmpty({
  hasPages,
  onCreate,
}: {
  hasPages: boolean;
  onCreate: () => void;
}) {
  return (
    <EmptyState
      icon={<NotebookIcon className="h-6 w-6" strokeWidth={1.6} />}
      title={hasPages ? "Pick a page to keep writing" : "Your private thinking space"}
      description={
        hasPages
          ? "Choose a page from the sidebar — or start something new."
          : "Capture a thought, sketch a table with formulas, or @mention a teammate to send them a task. Nothing here leaves your workspace."
      }
      primary={
        <Button variant="primary" size="md" onClick={onCreate} iconLeft={<Sparkles className="h-4 w-4" strokeWidth={1.8} />}>
          {hasPages ? "New page" : "Start your first page"}
        </Button>
      }
      hint={
        <>
          <span>Quick switch</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </>
      }
    />
  );
}
