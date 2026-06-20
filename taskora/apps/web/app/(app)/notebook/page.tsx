"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PanelLeftOpen,
  Share2,
  Trash2,
  Maximize2,
  Minimize2,
  Notebook as NotebookIcon,
  Sparkles,
  Star,
  Pin,
  Paperclip,
  Plus,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import CommandPalette from "./_components/CommandPalette";
import NotebookNav from "./_components/NotebookNav";
import RichPageEditor from "./_components/RichPageEditor";
import ShareModal from "./_components/ShareModal";
import ShortcutsHelp from "./_components/ShortcutsHelp";
import TrashModal from "./_components/TrashModal";
import type { Page, Person, Project } from "./_lib/types";
import { Button, EmptyState, Kbd, Tooltip, cn } from "@/components/ui";

const NAV_OPEN_KEY = "taskora_notebook_nav_open";

/**
 * Notebook — a calm, single-canvas writing space. A collapsible page tree on
 * the left, the editor on the right. Pages can be pinned/favourited to the top
 * of the tree. One notebook per user, cross-workspace (enforced server-side).
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
  const [zen, setZen] = useState(false);
  // Click a tag to filter the tree to just notes carrying it.
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // Sidebar open/closed — persisted per user via localStorage.
  const [navOpen, setNavOpen] = useState<boolean>(true);
  useEffect(() => {
    const v = typeof window !== "undefined" && localStorage.getItem(NAV_OPEN_KEY);
    if (v === "false") setNavOpen(false);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(NAV_OPEN_KEY, String(navOpen));
  }, [navOpen]);

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
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement as HTMLElement | null;
        const typing =
          !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setHelpOpen(true);
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

  const reloadPages = useCallback(async () => {
    const pagesAll = await apiFetch("/api/v1/notebook/pages") as Page[];
    setPages(pagesAll);
  }, []);

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

  // Pin → moves the page to the Pinned section at the top.
  const togglePin = async (page: Page) => {
    const next = !page.pinned;
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, pinned: next } : p)));
    try {
      await apiFetch(`/api/v1/notebook/pages/${page.id}`, {
        method: "PATCH", body: JSON.stringify({ pinned: next }),
      });
    } catch {
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, pinned: !next } : p)));
    }
  };

  // Star/favourite → highlight only (does not reorder).
  const toggleFavourite = async (page: Page) => {
    const next = !page.favourite;
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, favourite: next } : p)));
    try {
      await apiFetch(`/api/v1/notebook/pages/${page.id}`, {
        method: "PATCH", body: JSON.stringify({ favourite: next }),
      });
    } catch {
      setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, favourite: !next } : p)));
    }
  };

  // Update a page's tags (add/remove), persisted.
  const setTags = async (page: Page, tags: string[]) => {
    setPages((prev) => prev.map((p) => (p.id === page.id ? { ...p, tags } : p)));
    try {
      await apiFetch(`/api/v1/notebook/pages/${page.id}`, {
        method: "PATCH", body: JSON.stringify({ tags }),
      });
    } catch { /* optimistic */ }
  };

  const archivePage = async () => {
    if (!activePage || !isOwnerOfActive) return;
    if (!window.confirm(`Delete "${activePage.title}"? This can't be undone in v1.`)) return;
    await apiFetch(`/api/v1/notebook/pages/${activePage.id}`, { method: "DELETE" });
    setPages((prev) => prev.filter((p) => p.id !== activePage.id));
    setActivePageId(null);
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* ── Centered page header — compact, with how-to hints ──────── */}
      <header className="pt-5 pb-3 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <span className="inline-flex items-center justify-center h-8 w-8 rounded-xl bg-gradient-to-br from-brand-500/15 to-brand-700/10">
            <NotebookIcon className="h-[18px] w-[18px] text-brand-600" strokeWidth={1.8} />
          </span>
          <h1 className="font-display text-[22px] leading-none font-semibold tracking-tight text-fg">Notebook</h1>
        </div>
        <div className="mt-2.5 flex items-center justify-center gap-x-3 gap-y-1 flex-wrap text-[11.5px] text-fg-subtle">
          <Hint k="/" label="blocks" />
          <Hint k="@" label="mention people / pages" />
          <Hint k="⌘K" label="switch page" />
          <Hint k="drop / paste" label="attach files" />
          <Hint k="?" label="all shortcuts" />
        </div>
      </header>

      <div className="px-4 md:px-6 pb-6">
        <div className="max-w-[1480px] mx-auto h-[calc(100vh-9.5rem)]">
          <div className="surface-card h-full flex flex-row overflow-hidden rounded-2xl border border-line shadow-sm animate-fade-in">
            {/* Sidebar */}
            {navOpen && !zen ? (
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
                onTogglePin={togglePin}
                onToggleFavourite={toggleFavourite}
                tagFilter={tagFilter}
                onTagFilter={setTagFilter}
              />
            ) : (
              <Tooltip label="Open notebook sidebar" side="right">
                <button
                  onClick={() => { setNavOpen(true); setZen(false); }}
                  aria-label="Open notebook sidebar"
                  className="w-10 flex-shrink-0 bg-surface-2 border-r border-line flex items-start justify-center pt-3.5 text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40"
                >
                  <PanelLeftOpen className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </Tooltip>
            )}

            {/* Editor area */}
            <div className="flex-1 flex flex-col overflow-hidden px-5 md:px-7 py-4 min-w-0">
              {/* Top action bar */}
              <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0 min-h-[28px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-fg-subtle truncate font-medium uppercase tracking-wider">
                    {activePage
                      ? activePage.follower_role
                        ? `Shared with you · ${activePage.follower_role}`
                        : "Your page"
                      : ""}
                  </span>
                  {activePage && (
                    <span className="text-[11px] text-fg-subtle/80 whitespace-nowrap">
                      · {activePage.updated_at
                        ? new Date(activePage.updated_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })
                        : "no date"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activePage && isOwnerOfActive && (
                    <>
                      <Tooltip label={activePage.favourite ? "Unfavourite" : "Favourite"}>
                        <button
                          onClick={() => toggleFavourite(activePage)}
                          aria-label={activePage.favourite ? "Unfavourite" : "Favourite"}
                          aria-pressed={!!activePage.favourite}
                          className={cn(
                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                            activePage.favourite ? "text-amber-500 hover:bg-amber-50" : "text-fg-subtle hover:text-fg hover:bg-muted",
                          )}
                        >
                          <Star className="h-3.5 w-3.5" strokeWidth={1.8} fill={activePage.favourite ? "currentColor" : "none"} />
                        </button>
                      </Tooltip>
                      <Tooltip label={activePage.pinned ? "Unpin" : "Pin to top"}>
                        <button
                          onClick={() => togglePin(activePage)}
                          aria-label={activePage.pinned ? "Unpin page" : "Pin page"}
                          aria-pressed={!!activePage.pinned}
                          className={cn(
                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                            activePage.pinned ? "text-ocean hover:bg-ocean/10" : "text-fg-subtle hover:text-fg hover:bg-muted",
                          )}
                        >
                          <Pin className="h-3.5 w-3.5" strokeWidth={1.8} fill={activePage.pinned ? "currentColor" : "none"} />
                        </button>
                      </Tooltip>
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
                  <Tooltip label={zen ? "Exit focus" : "Focus mode"}>
                    <button
                      onClick={() => setZen((v) => !v)}
                      aria-label={zen ? "Exit focus" : "Focus mode"}
                      aria-pressed={zen}
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-subtle hover:text-fg hover:bg-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    >
                      {zen
                        ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                        : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    </button>
                  </Tooltip>
                </div>
              </div>

              {/* Tags row */}
              {activePage && (
                <PageTagsRow
                  page={activePage}
                  editable={canEditActive}
                  activeTag={tagFilter}
                  onChange={(tags) => setTags(activePage, tags)}
                  onTagClick={(t) => setTagFilter((cur) => (cur === t ? null : t))}
                />
              )}

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
                  <div className={cn("h-full flex flex-col", zen && "max-w-[760px] mx-auto")}>
                    <div className="flex-1 overflow-hidden">
                      <RichPageEditor
                        page={activePage}
                        readOnly={!canEditActive}
                        onSaved={updatePageInList}
                        people={people}
                        allPages={[...pages, ...sharedPages]}
                        onOpenPage={(id) => setActivePageId(id)}
                      />
                    </div>
                    <NotebookFiles pageId={activePage.id} editable={canEditActive} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
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

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-fg-muted">{k}</kbd>
      <span>{label}</span>
    </span>
  );
}

/** Tag chips for the active page — add/remove + click to filter the tree. */
function PageTagsRow({
  page, editable, activeTag, onChange, onTagClick,
}: {
  page: Page;
  editable: boolean;
  activeTag: string | null;
  onChange: (tags: string[]) => void;
  onTagClick: (tag: string) => void;
}) {
  const tags = page.tags ?? [];
  const addTag = () => {
    const t = window.prompt("Add a tag")?.trim().toLowerCase();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  };
  if (tags.length === 0 && !editable) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-3">
      {tags.map((t) => (
        <span key={t} className={cn(
          "group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] transition-colors",
          activeTag === t ? "border-brand-500/40 bg-brand-500/10 text-brand-700" : "border-line bg-surface text-fg-muted hover:text-fg",
        )}>
          <button type="button" onClick={() => onTagClick(t)} className="font-medium">#{t}</button>
          {editable && (
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-fg-subtle/60 hover:text-danger-600" aria-label={`Remove ${t}`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <button type="button" onClick={addTag}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11.5px] text-fg-subtle hover:text-fg hover:border-fg-subtle">
          <Plus className="h-3 w-3" /> tag
        </button>
      )}
    </div>
  );
}

/**
 * File attachments on a notebook page (Excel/PDF/Word/images/etc.). Attach
 * button + drag-drop + paste (non-image clipboard files; the editor inlines
 * pasted images itself). Sign → upload to Storage → record.
 */
function NotebookFiles({ pageId, editable }: { pageId: string; editable: boolean }) {
  const [files, setFiles] = useState<{ id: string; file_name: string; file_size_bytes?: number | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await apiFetch(`/api/v1/notebook/pages/${pageId}/files`);
      setFiles(Array.isArray(d) ? d : []);
    } catch { /* leave */ }
  }, [pageId]);
  useEffect(() => { void load(); }, [load]);

  const upload = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const sign = await apiFetch(`/api/v1/notebook/pages/${pageId}/files/sign`, {
        method: "POST", body: JSON.stringify({ file_name: file.name, content_type: file.type || "application/octet-stream" }),
      });
      if (file.size > (sign.max_bytes ?? 26214400)) throw new Error("File too large (max 25 MB).");
      const { error: upErr } = await supabase.storage
        .from(sign.bucket).uploadToSignedUrl(sign.path, sign.token, file, { contentType: file.type || undefined });
      if (upErr) throw upErr;
      await apiFetch(`/api/v1/notebook/pages/${pageId}/files`, {
        method: "POST", body: JSON.stringify({ path: sign.path, file_name: file.name, file_size_bytes: file.size }),
      });
      await load();
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [pageId, load]);

  // Paste non-image files (e.g. a copied PDF/xlsx). Images are inlined by the
  // editor, so we skip them here to avoid double-handling.
  useEffect(() => {
    if (!editable) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files ?? []);
      const nonImages = items.filter((f) => !f.type.startsWith("image/"));
      if (nonImages.length === 0) return;
      e.preventDefault();
      nonImages.forEach((f) => void upload(f));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [editable, upload]);

  async function openFile(id: string) {
    try {
      const d = await apiFetch(`/api/v1/notebook/pages/${pageId}/files/${id}/url`);
      if (d?.url) window.open(d.url, "_blank", "noopener");
    } catch { /* ignore */ }
  }
  async function remove(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    try { await apiFetch(`/api/v1/notebook/pages/${pageId}/files/${id}`, { method: "DELETE" }); } catch { void load(); }
  }

  if (files.length === 0 && !editable) return null;

  return (
    <div
      onDragOver={(e) => { if (editable) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault(); setDragOver(false);
        Array.from(e.dataTransfer.files).forEach((f) => void upload(f));
      }}
      className={cn(
        "flex-shrink-0 mt-2 pt-2.5 border-t border-line",
        dragOver && "ring-2 ring-brand-500/40 rounded-lg",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Paperclip className="h-3.5 w-3.5 text-fg-subtle" />
        {files.length === 0 && <span className="text-[12px] text-fg-subtle/70">Drop or paste a file — Excel, PDF, Word, images…</span>}
        {files.map((f) => (
          <span key={f.id} className="group inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px]">
            <button type="button" onClick={() => openFile(f.id)} className="text-ocean hover:underline max-w-[180px] truncate">{f.file_name}</button>
            {editable && (
              <button type="button" onClick={() => remove(f.id)} className="text-fg-subtle/50 hover:text-danger-600" aria-label="Remove">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {editable && (
          <label className={cn("inline-flex items-center gap-1 text-[12px] font-semibold cursor-pointer text-brand-600 hover:text-brand-700", busy && "opacity-50 pointer-events-none")}>
            {busy ? "Uploading…" : "+ Attach"}
            <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.currentTarget.value = ""; }} />
          </label>
        )}
      </div>
    </div>
  );
}

function NotebookLoadingState() {
  return (
    <div className="h-full px-1 py-2 animate-fade-in">
      <div className="space-y-3 max-w-2xl mx-auto">
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
