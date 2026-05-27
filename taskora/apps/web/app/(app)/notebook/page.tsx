"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import Goals from "./_components/Goals";
import Checklist from "./_components/Checklist";
import CommandPalette from "./_components/CommandPalette";
import NotebookNav from "./_components/NotebookNav";
import PageEditor from "./_components/PageEditor";
import ShareModal from "./_components/ShareModal";
import type { Page, Person, Project } from "./_lib/types";

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

  // Cmd/Ctrl+K quick switcher.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
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
    <div className="min-h-screen p-4 md:p-6 bg-mist">
      <div className={`grid grid-cols-1 ${gridCols} gap-4 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]`}>
        {/* ── LEFT PAGE: Goals + Checklist (with minimize rail) ─────── */}
        {showLeft && (
          leftMinimized && focus === null ? (
            // Compact rail — restores to default on click.
            <div className="bg-white rounded-2xl shadow-sm border border-pebble flex flex-col items-center py-3 gap-3">
              <button
                onClick={() => setLeftMinimized(false)}
                className="w-9 h-9 flex items-center justify-center rounded text-lg hover:bg-pebble/60"
                title="Expand Goals + Checklist"
                aria-label="Expand Goals + Checklist"
              >
                ↔
              </button>
              <button
                onClick={() => { setLeftMinimized(false); setFocus("goals"); }}
                className="w-9 h-9 flex items-center justify-center rounded text-lg hover:bg-pebble/60"
                title="Open Goals"
                aria-label="Open Goals"
              >
                🎯
              </button>
              <button
                onClick={() => { setLeftMinimized(false); setFocus("checklist"); }}
                className="w-9 h-9 flex items-center justify-center rounded text-lg hover:bg-pebble/60"
                title="Open Checklist"
                aria-label="Open Checklist"
              >
                ☑
              </button>
            </div>
          ) : (
            <div ref={leftPanelRef} className="bg-white rounded-2xl shadow-sm border border-pebble p-4 flex flex-col overflow-hidden relative">
              {focus === null && (
                <button
                  onClick={() => setLeftMinimized(true)}
                  className="absolute top-2 right-2 z-20 text-steel/60 hover:text-midnight text-sm leading-none p-1"
                  title="Minimize Goals + Checklist"
                  aria-label="Minimize Goals + Checklist"
                >
                  ⇤
                </button>
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
                  <div className="w-8 h-0.5 bg-pebble group-hover:bg-taskora-red/60 rounded transition-colors" />
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
          <div className="bg-white rounded-2xl shadow-sm border border-pebble flex flex-row overflow-hidden relative">
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
              />
            ) : (
              <button
                onClick={() => setNavOpen(true)}
                className="w-8 flex-shrink-0 bg-pebble/30 border-r border-pebble flex items-start justify-center pt-3 text-steel/60 hover:text-midnight"
                title="Open notebook sidebar"
                aria-label="Open notebook sidebar"
              >
                ▶
              </button>
            )}

            {/* Editor area */}
            <div className="flex-1 flex flex-col overflow-hidden p-4 min-w-0">
              {/* Top action bar */}
              <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
                <div className="text-xs text-steel/60 truncate">
                  {activePage
                    ? activePage.follower_role
                      ? `Shared with you · ${activePage.follower_role}`
                      : "Your page"
                    : ""}
                </div>
                <div className="flex items-center gap-1.5">
                  {activePage && isOwnerOfActive && (
                    <>
                      <button
                        onClick={() => setShareOpen(true)}
                        className="text-xs px-2 py-1 bg-midnight text-white rounded hover:opacity-90"
                      >
                        Share
                      </button>
                      <button
                        onClick={archivePage}
                        className="text-xs px-2 py-1 border border-pebble text-steel rounded hover:text-red-500 hover:border-red-300"
                        title="Delete page"
                      >
                        ⌫
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setFocus(focus === "notebook" ? null : "notebook")}
                    className="text-steel/60 hover:text-midnight text-sm leading-none px-1.5"
                    title={focus === "notebook" ? "Exit focus" : "Focus this panel"}
                    aria-label={focus === "notebook" ? "Exit focus" : "Focus this panel"}
                  >
                    {focus === "notebook" ? "×" : "⛶"}
                  </button>
                </div>
              </div>

              {/* Editor or empty state */}
              <div className="flex-1 overflow-hidden">
                {loading ? (
                  <div className="text-sm text-steel/60">Loading notebook…</div>
                ) : !activePage ? (
                  <EmptyState onCreate={() => createPage(null)} hasPages={pages.length > 0} />
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
      <button
        onClick={onToggleFocus}
        className="absolute top-0 right-0 z-10 text-steel/60 hover:text-midnight text-sm leading-none p-1"
        title={focused ? "Exit focus" : "Focus this panel"}
        aria-label={focused ? "Exit focus" : "Focus this panel"}
      >
        {focused ? "×" : "⛶"}
      </button>
      <div className="h-full overflow-hidden pr-5">{children}</div>
    </div>
  );
}

function EmptyState({ onCreate, hasPages }: { onCreate: () => void; hasPages: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="text-4xl mb-3">📓</div>
      <h3 className="text-base font-bold text-midnight mb-1">
        {hasPages ? "Pick a page from the sidebar" : "Your notebook"}
      </h3>
      <p className="text-sm text-steel max-w-xs mb-4">
        {hasPages
          ? "Or start something new below."
          : "A private thinking space. Drop a thought, add a table with formulas, or @mention a teammate to assign them a task — they’ll see it in their inbox."}
      </p>
      <button
        onClick={onCreate}
        className="text-sm px-3 py-1.5 bg-taskora-red text-white rounded hover:opacity-90"
      >
        {hasPages ? "+ New page" : "+ Start your first page"}
      </button>
    </div>
  );
}
