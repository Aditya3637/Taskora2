"use client";
import { useEffect, useMemo, useState } from "react";
import type { Page, Project } from "../_lib/types";

const EXPANDED_KEY = "taskora_notebook_expanded_projects";

/**
 * Collapsible left sidebar for the Notebook panel — the "ChatGPT for
 * your notes" affordance the user asked for.
 *
 * Header:
 *   - Title + close (collapse) button
 *   - Search input
 *   - + New page (prominent)
 *   - + Project (secondary)
 *
 * Body sections (each can be empty + hidden):
 *   - Recent (last 5 pages by updated_at)
 *   - Projects (expandable nodes)
 *   - Unfiled (pages without a project_id)
 *   - Shared with me (caller is a follower)
 *
 * Search filters across all pages by title (case-insensitive). When the
 * search box has anything in it, sections collapse into a flat result
 * list ranked by recency.
 */
export default function NotebookNav({
  projects,
  pages,
  sharedPages,
  activePageId,
  onSelectPage,
  onCreatePage,
  onCreateProject,
  onCollapse,
}: {
  projects: Project[];
  pages: Page[];
  sharedPages: Page[];
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  onCreatePage: (projectId: string | null) => void;
  onCreateProject: () => void;
  onCollapse: () => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Hydrate the expand state from localStorage so the user's open
  // folders survive a reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr)) setExpanded(new Set(arr));
      }
    } catch { /* ignore */ }
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignore */ }
      return next;
    });
  };

  // Index pages by project
  const pagesByProject = useMemo(() => {
    const m = new Map<string, Page[]>();
    for (const p of pages) {
      if (!p.project_id) continue;
      const arr = m.get(p.project_id) ?? [];
      arr.push(p);
      m.set(p.project_id, arr);
    }
    m.forEach((arr) => arr.sort(byUpdatedAtDesc));
    return m;
  }, [pages]);

  const orphans = useMemo(
    () => pages.filter((p) => !p.project_id).sort(byUpdatedAtDesc),
    [pages],
  );

  const recent = useMemo(
    () => [...pages].sort(byUpdatedAtDesc).slice(0, 5),
    [pages],
  );

  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const hit = (p: Page) => p.title.toLowerCase().includes(needle);
    const own = pages.filter(hit);
    const shared = sharedPages.filter(hit);
    return [...own, ...shared].sort(byUpdatedAtDesc).slice(0, 50);
  }, [q, pages, sharedPages]);

  return (
    <aside className="w-60 flex-shrink-0 bg-pebble/30 border-r border-pebble flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-pebble flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold tracking-wide text-steel uppercase">Notebook</h2>
          <button
            onClick={onCollapse}
            className="text-steel/60 hover:text-midnight text-sm leading-none"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            ◀
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages…"
            className="w-full text-sm bg-white border border-pebble rounded px-2 py-1 pl-7 focus:outline-none focus:border-taskora-red"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-steel/50 text-xs">
            ⌕
          </span>
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-steel/60 hover:text-midnight text-xs"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 mt-2">
          <button
            onClick={() => onCreatePage(null)}
            className="flex-1 text-xs bg-midnight text-white px-2 py-1.5 rounded hover:opacity-90 font-medium"
            title="New page (creates an unfiled page)"
          >
            + New page
          </button>
          <button
            onClick={onCreateProject}
            className="text-xs border border-pebble text-steel px-2 py-1.5 rounded hover:text-midnight hover:bg-white"
            title="New project (folder)"
          >
            + Project
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {q ? (
          // ── Search results (flat) ───────────────────────────────
          <div>
            {searchHits.length === 0 ? (
              <p className="text-xs text-steel/60 italic px-2 py-2">
                No pages match &quot;{q}&quot;
              </p>
            ) : (
              <>
                <SectionHeader label={`Results (${searchHits.length})`} />
                {searchHits.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                  />
                ))}
              </>
            )}
          </div>
        ) : (
          // ── Default tree ────────────────────────────────────────
          <>
            {recent.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Recent" />
                {recent.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                  />
                ))}
              </div>
            )}

            {projects.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Projects" />
                {projects.map((proj) => {
                  const isOpen = expanded.has(proj.id);
                  const childPages = pagesByProject.get(proj.id) ?? [];
                  return (
                    <div key={proj.id}>
                      <div className="group flex items-center gap-0.5 rounded hover:bg-white">
                        <button
                          onClick={() => toggleExpand(proj.id)}
                          className="w-5 h-6 inline-flex items-center justify-center text-steel/60 text-xs"
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? "▾" : "▸"}
                        </button>
                        <button
                          onClick={() => toggleExpand(proj.id)}
                          className="flex-1 text-left text-sm text-midnight font-medium truncate py-1"
                        >
                          {proj.name}
                        </button>
                        <button
                          onClick={() => onCreatePage(proj.id)}
                          className="opacity-0 group-hover:opacity-100 text-steel/60 hover:text-midnight text-xs px-1.5 py-0.5"
                          title="Add page to this project"
                        >
                          +
                        </button>
                      </div>
                      {isOpen && (
                        <div className="pl-5">
                          {childPages.length === 0 ? (
                            <p className="text-xs text-steel/50 italic py-1 px-2">
                              No pages yet
                            </p>
                          ) : (
                            childPages.map((p) => (
                              <PageItem
                                key={p.id}
                                page={p}
                                active={p.id === activePageId}
                                onClick={() => onSelectPage(p.id)}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {orphans.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Unfiled" />
                {orphans.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                  />
                ))}
              </div>
            )}

            {sharedPages.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Shared with me" />
                {sharedPages.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                    rightLabel={p.follower_role === "editor" ? "edit" : "view"}
                  />
                ))}
              </div>
            )}

            {pages.length === 0 && sharedPages.length === 0 && (
              <p className="text-xs text-steel/60 italic px-2 py-4 text-center">
                Your notebook is empty. Tap <b>+ New page</b> above to begin.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-2 py-1 text-[10px] font-bold tracking-wider text-steel/60 uppercase">
      {label}
    </div>
  );
}

function PageItem({
  page,
  active,
  onClick,
  rightLabel,
}: {
  page: Page;
  active: boolean;
  onClick: () => void;
  rightLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center justify-between gap-2 px-2 py-1 rounded text-sm truncate ${
        active
          ? "bg-midnight text-white"
          : "text-midnight hover:bg-white"
      }`}
    >
      <span className="truncate flex-1">{page.title || "Untitled"}</span>
      {rightLabel && (
        <span
          className={`text-[10px] uppercase tracking-wide flex-shrink-0 ${
            active ? "text-white/70" : "text-steel/50"
          }`}
        >
          {rightLabel}
        </span>
      )}
    </button>
  );
}

function byUpdatedAtDesc(a: Page, b: Page): number {
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}
