"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FileText } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { RichDocEditor } from "@/components/richdoc/RichDocEditor";
import EmojiPicker from "./EmojiPicker";
import type { Page, Person } from "../_lib/types";
import { blocksToProseMirror } from "../_lib/convert";
import { compressImageToDataUrl } from "../_lib/image";
import { notebookMention } from "../_lib/notebookMention";
import { DelegateButton } from "./DelegateButton";

/** Walk a TipTap doc and collect the page ids it @-mentions (id "page:<id>"). */
function mentionedPageIds(body: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (n: any) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") {
      if (n.type === "mention") {
        const raw = n.attrs?.id;
        if (typeof raw === "string" && raw.startsWith("page:")) ids.add(raw.slice(5));
      }
      if (n.content) walk(n.content);
    }
  };
  walk(body);
  return ids;
}

/**
 * Notebook page editor on the shared TipTap surface (convergence N-2 + N-4).
 * Title + icon header + RichDocEditor body. Legacy pages convert on first open
 * (migrate-on-open; old `body` kept as backup). N-4 restores @-mentions of
 * people + pages, clickable page links, and a backlinks panel.
 */
export default function RichPageEditor({
  page,
  onSaved,
  readOnly,
  people,
  allPages,
  onOpenPage,
}: {
  page: Page;
  onSaved?: (next: Page) => void;
  readOnly: boolean;
  people: Person[];
  allPages: Page[];
  onOpenPage: (pageId: string) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState<string | null>(page.icon ?? null);
  const [doc, setDoc] = useState<unknown | null>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "@" picker is built once but must see the latest people/pages — feed it
  // through a ref so the suggestion list stays fresh without re-mounting.
  const dataRef = useRef({ people, pages: allPages });
  useEffect(() => { dataRef.current = { people, pages: allPages }; }, [people, allPages]);
  const mention = useMemo(() => notebookMention(() => dataRef.current), []);

  // Backlinks: other pages whose body @-mentions this page.
  const backlinks = useMemo(
    () => allPages.filter((p) => p.id !== page.id && p.body_doc && mentionedPageIds(p.body_doc).has(page.id)),
    [allPages, page.id],
  );

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      setSaving(true);
      try {
        const resp = (await apiFetch(`/api/v1/notebook/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })) as Page;
        onSaved?.(resp);
      } finally {
        setSaving(false);
      }
    },
    [page.id, onSaved],
  );

  const scheduleSave = useCallback(
    (patch: Record<string, unknown>) => {
      if (readOnly) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persist(patch), 600);
    },
    [persist, readOnly],
  );

  // On page switch: load the TipTap body, converting + migrating a legacy page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTitle(page.title);
    setIcon(page.icon ?? null);
    setIconOpen(false);
    if (page.format === "pm" && page.body_doc) {
      setDoc(page.body_doc);
    } else {
      const converted = blocksToProseMirror(page.body || []);
      setDoc(converted);
      // migrate-on-open: persist the converted doc once (old `body` kept as backup).
      if (!readOnly) {
        apiFetch(`/api/v1/notebook/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body_doc: converted, format: "pm" }),
        }).then((resp) => onSaved?.(resp as Page)).catch(() => { /* retried next open */ });
      }
    }
  }, [page.id]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // N-3 adapters ──────────────────────────────────────────────────────────
  // Images stay as compressed data URLs (no storage bucket).
  const onImageUpload = useCallback(async (file: File) => {
    try {
      const src = await compressImageToDataUrl(file);
      return { src, alt: file.name };
    } catch {
      return null;
    }
  }, []);

  // Promote a line → a personal checklist item (the notebook-native "task").
  const onPromote = useCallback(async (text: string) => {
    try {
      await apiFetch("/api/v1/notebook/checklist", {
        method: "POST",
        body: JSON.stringify({ content: text, source_page_id: page.id }),
      });
    } catch { /* surfaced to the user via the AI card / non-blocking */ }
  }, [page.id]);

  // ✨ AI grounded in the page, billed to the caller's active workspace key.
  const onAssist = useCallback(async (action: string, selection: string) => {
    const bid = typeof window !== "undefined" ? localStorage.getItem("business_id") : null;
    if (!bid) throw { detail: "Open a workspace first to use AI." };
    return apiFetch(`/api/v1/notebook/pages/${page.id}/ai?business_id=${bid}`, {
      method: "POST",
      body: JSON.stringify({ action, selection: selection || undefined }),
    });
  }, [page.id]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-8 py-6">
        {/* Title + icon */}
        <div className="flex items-center gap-2 mb-3 relative">
          <button
            type="button"
            onClick={() => !readOnly && setIconOpen((v) => !v)}
            disabled={readOnly}
            title={readOnly ? "" : "Change icon"}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-mist text-xl shrink-0 disabled:cursor-default"
          >
            {icon || <span aria-hidden className="text-base text-steel/40">＋</span>}
          </button>
          {iconOpen && !readOnly && (
            <div className="absolute top-10 left-0 z-20">
              <EmojiPicker
                value={icon}
                onChange={(next) => { setIcon(next); scheduleSave({ icon: next }); }}
                onClose={() => setIconOpen(false)}
              />
            </div>
          )}
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); scheduleSave({ title: e.target.value || "Untitled" }); }}
            disabled={readOnly}
            placeholder="Untitled"
            className="text-3xl font-display font-bold text-midnight bg-transparent outline-none flex-1 min-w-0 disabled:cursor-not-allowed placeholder:text-steel/40"
          />
          <span className="text-[11px] text-steel/60 shrink-0">
            {readOnly ? "Read-only" : saving ? "Saving…" : ""}
          </span>
        </div>

        {/* Body — mount only once the TipTap doc is ready (after conversion).
            Click a page chip (data-mention-id="page:<id>") to navigate. */}
        {doc !== null && (
          <div
            onClick={(e) => {
              const el = (e.target as HTMLElement).closest('[data-mention-id^="page:"]');
              const id = el?.getAttribute("data-mention-id")?.slice(5);
              if (id) onOpenPage(id);
            }}
          >
            <RichDocEditor
              key={page.id}
              value={doc}
              editable={!readOnly}
              onChange={(json) => scheduleSave({ body_doc: json })}
              onImageUpload={readOnly ? undefined : onImageUpload}
              onPromote={readOnly ? undefined : onPromote}
              onAssist={readOnly ? undefined : onAssist}
              mention={mention}
              promoteLabel="checklist item"
              renderExtra={readOnly ? undefined : (editor) => <DelegateButton editor={editor} pageId={page.id} />}
              placeholder="Write… type “/” for blocks, “@” for people/pages, or drop an image."
            />
          </div>
        )}

        {/* Backlinks — pages that @-mention this one. */}
        {backlinks.length > 0 && (
          <div className="mt-8 pt-4 border-t border-pebble">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
              Linked from
            </div>
            <ul className="space-y-1">
              {backlinks.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => onOpenPage(p.id)}
                    className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-ocean truncate"
                  >
                    <FileText className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
                    {p.icon ? `${p.icon} ` : ""}{p.title || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
