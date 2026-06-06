"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { RichDocEditor } from "@/components/richdoc/RichDocEditor";
import EmojiPicker from "./EmojiPicker";
import type { Page } from "../_lib/types";
import { blocksToProseMirror } from "../_lib/convert";
import { compressImageToDataUrl } from "../_lib/image";

/**
 * Notebook page editor on the shared TipTap surface (convergence N-2). Renders
 * the title + icon header and the RichDocEditor body. On first open a legacy
 * (`format !== 'pm'`) page is converted from its flat Block[] body to TipTap
 * JSON and saved (migrate-on-open) — the old `body` is kept server-side as a
 * backup. Title / icon / body autosave on a debounce.
 *
 * Notebook-specific @person-delegation and [[page]] links/backlinks are not yet
 * on this surface (rebuilt in a later phase); for now those read as plain text.
 */
export default function RichPageEditor({
  page,
  onSaved,
  readOnly,
}: {
  page: Page;
  onSaved?: (next: Page) => void;
  readOnly: boolean;
}) {
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState<string | null>(page.icon ?? null);
  const [doc, setDoc] = useState<unknown | null>(null);
  const [iconOpen, setIconOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      <div className="mx-auto max-w-[760px] px-6 py-6">
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

        {/* Body — mount only once the TipTap doc is ready (after conversion). */}
        {doc !== null && (
          <RichDocEditor
            key={page.id}
            value={doc}
            editable={!readOnly}
            onChange={(json) => scheduleSave({ body_doc: json })}
            onImageUpload={readOnly ? undefined : onImageUpload}
            onPromote={readOnly ? undefined : onPromote}
            onAssist={readOnly ? undefined : onAssist}
            promoteLabel="checklist item"
            placeholder="Write… type “/” for blocks, or drop an image in."
          />
        )}
      </div>
    </div>
  );
}
