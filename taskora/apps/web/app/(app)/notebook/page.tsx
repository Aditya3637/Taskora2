"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import Goals from "./_components/Goals";
import Checklist from "./_components/Checklist";
import PageEditor from "./_components/PageEditor";
import ShareModal from "./_components/ShareModal";
import type { Page, Person, Project } from "./_lib/types";

type FocusMode = null | "goals" | "checklist" | "notebook";
const RATIO_KEY = "taskora_notebook_goals_pct";

/**
 * Notebook surface (book-spread).
 *
 * Layout:
 *   ┌─────────────────────┬─────────────────────────────────┐
 *   │ GOALS               │ Project ▾  Page ▾   [Share][+]  │
 *   ├─────────────────────┤                                 │
 *   │ CHECKLIST           │  Chat-style page editor         │
 *   │ [My][Assigned•N]    │  text · tables · math · @assign │
 *   └─────────────────────┴─────────────────────────────────┘
 *
 * Single notebook per user, cross-workspace (the data model is
 * user-scoped — workspace switch does NOT switch notebooks).
 */
export default function NotebookPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [sharedPages, setSharedPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | "orphan" | "shared" | null>(null);

  // Bootstrap: projects, pages, workspace people picker.
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
        if (pagesAll[0]) {
          setActivePageId(pagesAll[0].id);
          setActiveProjectId(pagesAll[0].project_id ?? "orphan");
        }
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

  // The page-list filtered to the active project (or shared bucket).
  const visiblePages = useMemo(() => {
    if (activeProjectId === "shared") return sharedPages;
    if (activeProjectId === "orphan") return pages.filter((p) => !p.project_id);
    if (activeProjectId) return pages.filter((p) => p.project_id === activeProjectId);
    return pages;
  }, [pages, sharedPages, activeProjectId]);

  const activePage = useMemo<Page | null>(() => {
    if (!activePageId) return null;
    return (
      pages.find((p) => p.id === activePageId) ||
      sharedPages.find((p) => p.id === activePageId) ||
      null
    );
  }, [pages, sharedPages, activePageId]);

  const isOwnerOfActive = activePage ? !activePage.follower_role : false;
  const canEditActive = isOwnerOfActive || activePage?.follower_role === "editor";

  // ── Actions ────────────────────────────────────────────────────────
  const createProject = async () => {
    const name = window.prompt("Project name?");
    if (!name || !name.trim()) return;
    const proj = (await apiFetch("/api/v1/notebook/projects", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    })) as Project;
    setProjects((prev) => [...prev, proj]);
    setActiveProjectId(proj.id);
  };

  const createPage = async () => {
    const project_id =
      activeProjectId === "orphan" || activeProjectId === "shared" || !activeProjectId
        ? null
        : activeProjectId;
    const page = (await apiFetch("/api/v1/notebook/pages", {
      method: "POST",
      body: JSON.stringify({ project_id, title: "Untitled", body: [] }),
    })) as Page;
    setPages((prev) => [page, ...prev]);
    setActivePageId(page.id);
    setActiveProjectId(project_id ?? "orphan");
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

  // Drag handle between Goals and Checklist. Tracks the container's
  // bounding box on mousedown, then translates the cursor's Y position
  // into a percentage of total height.
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

  // Layout class names switch on focus mode. When a panel is focused, the
  // grid collapses to a single column and the other panels hide.
  const showLeft = focus === null || focus === "goals" || focus === "checklist";
  const showRight = focus === null || focus === "notebook";
  const gridCols =
    focus === null ? "md:grid-cols-[3fr_7fr]" : "md:grid-cols-1";

  return (
    <div className="min-h-screen p-4 md:p-6 bg-mist">
      <div className={`grid grid-cols-1 ${gridCols} gap-4 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]`}>
        {/* ── LEFT PAGE: Goals + Checklist ──────────────────────────── */}
        {showLeft && (
          <div ref={leftPanelRef} className="bg-white rounded-2xl shadow-sm border border-pebble p-4 flex flex-col overflow-hidden">
            {/* Goals */}
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

            {/* Resize handle — only when both panels are visible */}
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

            {/* Checklist */}
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
        )}

        {/* ── RIGHT PAGE: AI Notebook ──────────────────────────────── */}
        {showRight && (
        <div className="bg-white rounded-2xl shadow-sm border border-pebble p-4 flex flex-col overflow-hidden relative">
          <button
            onClick={() => setFocus(focus === "notebook" ? null : "notebook")}
            className="absolute top-2 right-3 z-10 text-steel/60 hover:text-midnight text-sm leading-none"
            title={focus === "notebook" ? "Exit focus" : "Focus this panel"}
            aria-label={focus === "notebook" ? "Exit focus" : "Focus this panel"}
          >
            {focus === "notebook" ? "×" : "⛶"}
          </button>
          {/* Top bar: project + page selectors + actions */}
          <div className="flex items-center gap-2 mb-3 text-sm">
            <select
              value={activeProjectId ?? ""}
              onChange={(e) => {
                const v = e.target.value || null;
                setActiveProjectId(v as typeof activeProjectId);
                // Auto-pick first page in this project.
                const list =
                  v === "shared" ? sharedPages
                  : v === "orphan" ? pages.filter((p) => !p.project_id)
                  : pages.filter((p) => p.project_id === v);
                setActivePageId(list[0]?.id ?? null);
              }}
              className="border border-pebble rounded px-2 py-1.5 text-sm bg-white"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              <option value="orphan">— Unfiled —</option>
              <option value="shared">Shared with me</option>
            </select>
            <button
              onClick={createProject}
              className="text-xs px-2 py-1 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40"
              title="Create project"
            >
              + Project
            </button>

            <span className="text-steel/30">·</span>

            <select
              value={activePageId ?? ""}
              onChange={(e) => setActivePageId(e.target.value || null)}
              className="border border-pebble rounded px-2 py-1.5 text-sm bg-white flex-1 min-w-0"
            >
              <option value="">— pick a page —</option>
              {visiblePages.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
            {activeProjectId !== "shared" && (
              <button
                onClick={createPage}
                className="text-xs px-2 py-1 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40"
              >
                + Page
              </button>
            )}
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
          </div>

          {/* Editor or empty state */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="text-sm text-steel/60">Loading notebook…</div>
            ) : !activePage ? (
              <EmptyState onCreate={createPage} hasProjects={projects.length > 0} />
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
        )}
      </div>

      {shareOpen && activePage && (
        <ShareModal pageId={activePage.id} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

/**
 * Wraps Goals and Checklist with a small focus toggle in the top-right.
 * When `focused` is true, the wrapper takes the full panel height and the
 * button flips to a close affordance.
 */
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

function EmptyState({ onCreate, hasProjects }: { onCreate: () => void; hasProjects: boolean }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      <div className="text-4xl mb-3">📓</div>
      <h3 className="text-base font-bold text-midnight mb-1">Your notebook</h3>
      <p className="text-sm text-steel max-w-xs mb-4">
        A private thinking space. Drop a thought, add a table with formulas, or
        @mention a teammate to assign them a task — they&apos;ll see it in their inbox.
      </p>
      <button
        onClick={onCreate}
        className="text-sm px-3 py-1.5 bg-taskora-red text-white rounded hover:opacity-90"
      >
        {hasProjects ? "+ New page" : "+ Start your first page"}
      </button>
    </div>
  );
}
