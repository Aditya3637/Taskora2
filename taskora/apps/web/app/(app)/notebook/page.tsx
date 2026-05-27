"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import Goals from "./_components/Goals";
import Checklist from "./_components/Checklist";
import PageEditor from "./_components/PageEditor";
import ShareModal from "./_components/ShareModal";
import type { Page, Person, Project } from "./_lib/types";

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

  return (
    <div className="min-h-screen p-4 md:p-6 bg-mist">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1600px] mx-auto h-[calc(100vh-2rem)]">
        {/* ── LEFT PAGE: Goals + Checklist ─────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-pebble p-4 flex flex-col gap-4 overflow-hidden">
          <div className="flex-shrink-0">
            <Goals />
          </div>
          <div className="border-t border-pebble pt-4 flex-1 overflow-hidden">
            <Checklist />
          </div>
        </div>

        {/* ── RIGHT PAGE: AI Notebook ──────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-pebble p-4 flex flex-col overflow-hidden">
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
              />
            )}
          </div>
        </div>
      </div>

      {shareOpen && activePage && (
        <ShareModal pageId={activePage.id} onClose={() => setShareOpen(false)} />
      )}
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
