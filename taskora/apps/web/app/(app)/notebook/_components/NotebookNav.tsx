"use client";
import { useEffect, useMemo, useState } from "react";
import {
  PanelLeftClose, Search, X, Plus, Trash2, FileText, FolderClosed,
  ChevronRight, ChevronDown, CheckSquare, Square, Star, Pin, Tag,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { cn } from "@/components/ui";
import type { Page, Project } from "../_lib/types";

const EXPANDED_KEY = "taskora_notebook_expanded_projects";

type SearchPage = {
  id: string; title: string; icon?: string | null;
  snippet: string; shared: boolean;
};
type SearchItem = { id: string; content: string; status?: string };
type SearchResults = { pages: SearchPage[]; checklist: SearchItem[] };

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
  onOpenTrash,
  onTogglePin,
  onToggleFavourite,
  tagFilter = null,
  onTagFilter,
}: {
  projects: Project[];
  pages: Page[];
  sharedPages: Page[];
  activePageId: string | null;
  onSelectPage: (id: string) => void;
  onCreatePage: (projectId: string | null) => void;
  onCreateProject: () => void;
  onCollapse: () => void;
  onOpenTrash: () => void;
  onTogglePin?: (page: Page) => void;
  onToggleFavourite?: (page: Page) => void;
  tagFilter?: string | null;
  onTagFilter?: (tag: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Server-side search results (title + body + checklist). Debounced.
  const [results, setResults] = useState<SearchResults>({ pages: [], checklist: [] });
  const [searching, setSearching] = useState(false);

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

  // When a tag is active, the tree narrows to pages carrying it.
  const visiblePages = useMemo(
    () => (tagFilter ? pages.filter((p) => (p.tags ?? []).includes(tagFilter)) : pages),
    [pages, tagFilter],
  );

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const p of pages) for (const t of p.tags ?? []) s.add(t);
    return Array.from(s).sort();
  }, [pages]);

  // Index pages by project
  const pagesByProject = useMemo(() => {
    const m = new Map<string, Page[]>();
    for (const p of visiblePages) {
      if (!p.project_id) continue;
      const arr = m.get(p.project_id) ?? [];
      arr.push(p);
      m.set(p.project_id, arr);
    }
    m.forEach((arr) => arr.sort(byUpdatedAtDesc));
    return m;
  }, [visiblePages]);

  const orphans = useMemo(
    () => visiblePages.filter((p) => !p.project_id).sort(byUpdatedAtDesc),
    [visiblePages],
  );

  const recent = useMemo(
    () => [...visiblePages].sort(byUpdatedAtDesc).slice(0, 5),
    [visiblePages],
  );

  const pinned = useMemo(
    () => visiblePages.filter((p) => p.pinned).sort(byUpdatedAtDesc),
    [visiblePages],
  );

  const favourites = useMemo(
    () => visiblePages.filter((p) => p.favourite && !p.pinned).sort(byUpdatedAtDesc),
    [visiblePages],
  );

  // Debounced backend search across titles + body + checklist. Needs ≥2
  // chars; clears immediately when the box is emptied.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setResults({ pages: [], checklist: [] });
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const data = await apiFetch(
          `/api/v1/notebook/search?q=${encodeURIComponent(needle)}`,
        );
        setResults({
          pages: data?.pages ?? [],
          checklist: data?.checklist ?? [],
        });
      } catch {
        setResults({ pages: [], checklist: [] });
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  const hasResults = results.pages.length > 0 || results.checklist.length > 0;

  return (
    <aside className="w-60 flex-shrink-0 bg-mist/30 border-r border-pebble flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2.5 flex-shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">Notebook</h2>
          <button
            onClick={onCollapse}
            className="p-1 rounded-md text-fg-subtle hover:text-fg hover:bg-mist transition-colors"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-subtle pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages…"
            className="w-full text-sm bg-white border border-pebble rounded-lg pl-8 pr-7 py-1.5 placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-ocean/30 focus:border-ocean transition-shadow"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-fg-subtle hover:text-fg hover:bg-mist"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 mt-2">
          <button
            onClick={() => onCreatePage(null)}
            className="flex-1 flex items-center justify-center gap-1 text-xs bg-ocean text-white px-2 py-1.5 rounded-lg hover:opacity-90 font-medium transition-opacity"
            title="New page (creates an unfiled page)"
          >
            <Plus className="w-3.5 h-3.5" /> New page
          </button>
          <button
            onClick={onCreateProject}
            className="flex items-center gap-1 text-xs border border-pebble text-fg-muted px-2 py-1.5 rounded-lg hover:text-fg hover:bg-white transition-colors"
            title="New project (folder)"
          >
            <Plus className="w-3.5 h-3.5" /> Project
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {q.trim() ? (
          // ── Search results (title + body + checklist) ───────────
          <div>
            {q.trim().length < 2 ? (
              <p className="text-xs text-steel/60 italic px-2 py-2">
                Type at least 2 characters…
              </p>
            ) : searching && !hasResults ? (
              <p className="text-xs text-steel/60 italic px-2 py-2">Searching…</p>
            ) : !hasResults ? (
              <p className="text-xs text-steel/60 italic px-2 py-2">
                No matches for &quot;{q.trim()}&quot;
              </p>
            ) : (
              <>
                {results.pages.length > 0 && (
                  <>
                    <SectionHeader label={`Pages (${results.pages.length})`} />
                    {results.pages.map((p) => (
                      <SearchResultItem
                        key={p.id}
                        result={p}
                        active={p.id === activePageId}
                        onClick={() => onSelectPage(p.id)}
                      />
                    ))}
                  </>
                )}
                {results.checklist.length > 0 && (
                  <div className="mt-2">
                    <SectionHeader label={`Checklist (${results.checklist.length})`} />
                    {results.checklist.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-start gap-1.5 px-2 py-1 text-sm text-fg-muted"
                      >
                        {c.status === "done"
                          ? <CheckSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ocean" />
                          : <Square className="w-3.5 h-3.5 mt-0.5 shrink-0 text-fg-subtle" />}
                        <span
                          className={`truncate ${c.status === "done" ? "line-through text-fg-subtle" : ""}`}
                        >
                          {c.content}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          // ── Default tree ────────────────────────────────────────
          <>
            {/* Active tag filter banner */}
            {tagFilter && (
              <button
                type="button"
                onClick={() => onTagFilter?.(null)}
                className="mb-2 w-full flex items-center gap-1.5 rounded-md bg-brand-500/10 text-brand-700 px-2 py-1.5 text-[12px] font-medium hover:bg-brand-500/15"
              >
                <Tag className="w-3.5 h-3.5" /> #{tagFilter}
                <X className="w-3.5 h-3.5 ml-auto" />
              </button>
            )}

            {/* Tags — click to filter */}
            {allTags.length > 0 && !tagFilter && (
              <div className="mb-2">
                <SectionHeader label="Tags" />
                <div className="flex flex-wrap gap-1 px-1 pb-1">
                  {allTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => onTagFilter?.(t)}
                      className="inline-flex items-center gap-0.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg hover:border-fg-subtle"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pinned.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Pinned" />
                {pinned.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                    onTogglePin={onTogglePin}
                    onToggleFavourite={onToggleFavourite}
                  />
                ))}
              </div>
            )}

            {favourites.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Favourites" />
                {favourites.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                    onTogglePin={onTogglePin}
                    onToggleFavourite={onToggleFavourite}
                  />
                ))}
              </div>
            )}

            {recent.length > 0 && (
              <div className="mb-2">
                <SectionHeader label="Recent" />
                {recent.map((p) => (
                  <PageItem
                    key={p.id}
                    page={p}
                    active={p.id === activePageId}
                    onClick={() => onSelectPage(p.id)}
                    onTogglePin={onTogglePin}
                    onToggleFavourite={onToggleFavourite}
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
                      <div className="group flex items-center gap-0.5 rounded-md hover:bg-mist px-1">
                        <button
                          onClick={() => toggleExpand(proj.id)}
                          className="w-4 h-6 inline-flex items-center justify-center text-fg-subtle"
                          aria-label={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                        <FolderClosed className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                        <button
                          onClick={() => toggleExpand(proj.id)}
                          className="flex-1 text-left text-sm text-fg font-medium truncate py-1 pl-1"
                        >
                          {proj.name}
                        </button>
                        <button
                          onClick={() => onCreatePage(proj.id)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-fg-subtle hover:text-ocean hover:bg-white"
                          title="Add page to this project"
                        >
                          <Plus className="w-3.5 h-3.5" />
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
                                onTogglePin={onTogglePin}
                                onToggleFavourite={onToggleFavourite}
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
                    onTogglePin={onTogglePin}
                    onToggleFavourite={onToggleFavourite}
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
                    shared
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

      {/* Footer — Trash */}
      <div className="border-t border-pebble px-2 py-1.5 flex-shrink-0">
        <button
          onClick={onOpenTrash}
          className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-fg-muted hover:text-fg hover:bg-mist transition-colors"
          title="Recently deleted pages"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Trash</span>
        </button>
      </div>
    </aside>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-fg-subtle/80 uppercase">
      {label}
    </div>
  );
}

function PageItem({
  page,
  active,
  onClick,
  rightLabel,
  onTogglePin,
  onToggleFavourite,
  shared = false,
}: {
  page: Page;
  active: boolean;
  onClick: () => void;
  rightLabel?: string;
  onTogglePin?: (page: Page) => void;
  onToggleFavourite?: (page: Page) => void;
  shared?: boolean;
}) {
  return (
    <div
      className={cn(
        "group w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-sm transition-colors relative",
        // Shared-with-me pages get a violet left accent + tint so they stand
        // apart from your own notes.
        shared && "border-l-2 border-violet-400 bg-violet-50/40",
        active ? (shared ? "bg-violet-100/70" : "bg-ocean/10") : "hover:bg-mist",
      )}
    >
      <button
        onClick={onClick}
        className={cn(
          "flex items-center gap-2 flex-1 min-w-0 text-left",
          active ? (shared ? "text-violet-700 font-medium" : "text-ocean font-medium") : "text-fg-muted group-hover:text-fg",
        )}
      >
        <span aria-hidden="true" className="w-4 flex items-center justify-center text-sm flex-shrink-0">
          {page.icon || <FileText className={`w-3.5 h-3.5 ${active ? (shared ? "text-violet-600" : "text-ocean") : "text-fg-subtle"}`} />}
        </span>
        <span className="truncate">{page.title || "Untitled"}</span>
      </button>
      {rightLabel && (
        <span className={`text-[10px] uppercase tracking-wide flex-shrink-0 ${active ? "text-ocean/70" : "text-fg-subtle"}`}>
          {rightLabel}
        </span>
      )}
      {onToggleFavourite && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleFavourite(page); }}
          title={page.favourite ? "Unfavourite" : "Favourite"}
          aria-label={page.favourite ? "Unfavourite" : "Favourite"}
          className={cn(
            "p-0.5 rounded flex-shrink-0 transition-opacity",
            page.favourite ? "text-amber-500" : "opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-amber-500",
          )}
        >
          <Star className="w-3.5 h-3.5" fill={page.favourite ? "currentColor" : "none"} />
        </button>
      )}
      {onTogglePin && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(page); }}
          title={page.pinned ? "Unpin" : "Pin to top"}
          aria-label={page.pinned ? "Unpin" : "Pin to top"}
          className={cn(
            "p-0.5 rounded flex-shrink-0 transition-opacity",
            page.pinned ? "text-ocean" : "opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-ocean",
          )}
        >
          <Pin className="w-3.5 h-3.5" fill={page.pinned ? "currentColor" : "none"} />
        </button>
      )}
    </div>
  );
}

function SearchResultItem({
  result,
  active,
  onClick,
}: {
  result: SearchPage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex flex-col gap-0.5 px-2 py-1.5 rounded-md transition-colors ${
        active ? "bg-ocean/10" : "hover:bg-mist"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="w-4 flex items-center justify-center text-sm flex-shrink-0">
          {result.icon || <FileText className={`w-3.5 h-3.5 ${active ? "text-ocean" : "text-fg-subtle"}`} />}
        </span>
        <span className={`truncate flex-1 text-sm ${active ? "text-ocean font-medium" : "text-fg"}`}>
          {result.title || "Untitled"}
        </span>
        {result.shared && (
          <span className={`text-[10px] uppercase tracking-wide flex-shrink-0 ${active ? "text-ocean/70" : "text-fg-subtle"}`}>
            shared
          </span>
        )}
      </span>
      {result.snippet && (
        <span className={`text-[11px] leading-snug line-clamp-2 pl-6 ${active ? "text-ocean/80" : "text-fg-subtle"}`}>
          {result.snippet}
        </span>
      )}
    </button>
  );
}

function byUpdatedAtDesc(a: Page, b: Page): number {
  return (b.updated_at || "").localeCompare(a.updated_at || "");
}
