"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { Spinner } from "@/components/ui";
import { X, Maximize2, Minimize2, FileText, Paperclip, Link2 } from "lucide-react";
import { WorkDocEditor, type UploadedAttachment } from "./WorkDocEditor";
import { DocFilesRail } from "./DocFilesRail";

type Bookmark = { url: string; label?: string };
type Doc = {
  id: string;
  title: string;
  body: unknown;
  updated_at?: string;
  can_write?: boolean;
  bookmarks?: Bookmark[];
};
type Backlink = { doc_id: string; doc_title: string; initiative_id: string; initiative_name: string };

function editedAgo(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The initiative Work Document (D2 + the §-feel pass). Opens as a right
 * slide-over (quick peek) and expands (⤢) to a full-page focus view: a
 * centered writing canvas with a right context rail (Files · Mentions).
 * Loads the initiative's first work doc (or offers to create one), autosaves
 * body + title, and accepts drag-drop / paste / 📎 uploads.
 */
export function WorkDocPanel({
  initiativeId,
  initiativeName,
  programName,
  onClose,
  docsBasePath,
  headerName,
  headerSub,
  backlinksPath,
  promotePath,
}: {
  initiativeId: string;
  initiativeName: string;
  programName?: string;
  onClose: () => void;
  /** Override the list/create endpoint (default: initiative docs). Lets the
   *  same panel host task-scoped docs (`/tasks/{id}/docs`). */
  docsBasePath?: string;
  headerName?: string;
  headerSub?: string;
  /** null disables the Mentions/backlinks rail (tasks have none today). */
  backlinksPath?: string | null;
  /** null disables promote-to-task (tasks don't promote into themselves). */
  promotePath?: string | null;
}) {
  const docsEndpoint = docsBasePath ?? `/api/v1/initiatives/${initiativeId}/docs`;
  const blPath = backlinksPath === undefined ? `/api/v1/initiatives/${initiativeId}/backlinks` : backlinksPath;
  const promPath = promotePath === undefined ? `/api/v1/initiatives/${initiativeId}/promote-task` : promotePath;
  const displayName = headerName ?? initiativeName;
  const displaySub = headerSub ?? programName;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "readonly">("idle");
  const [promoteMsg, setPromoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filesVersion, setFilesVersion] = useState(0); // bump to reload the Files rail
  const [railTab, setRailTab] = useState<"files" | "mentions">("files");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the initiative's first work doc (newest), if any.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list: Doc[] = await apiFetch(docsEndpoint);
      if (list.length > 0) {
        setDoc(await apiFetch(`/api/v1/docs/${list[0].id}`));
      } else {
        setDoc(null); // none yet — show the create CTA
      }
    } catch (e: any) {
      setError(e?.detail || `Couldn't load the work document${e?.status ? ` (HTTP ${e.status})` : ""}.`);
    } finally {
      setLoading(false);
    }
    // Inbound mentions (best-effort; don't block the doc). Skipped when disabled.
    if (blPath) {
      apiFetch(blPath)
        .then((r) => setBacklinks(r?.backlinks ?? []))
        .catch(() => setBacklinks([]));
    }
  }, [docsEndpoint, blPath]);

  useEffect(() => { load(); }, [load]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function createDoc() {
    try {
      const created: Doc = await apiFetch(docsEndpoint, {
        method: "POST",
        body: JSON.stringify({ title: "Work document" }),
      });
      setDoc(created);
    } catch (e: any) {
      setError(e?.detail || "Couldn't create the work document.");
    }
  }

  // Debounced autosave of the editor body / title.
  const queueSave = useCallback(
    (patch: { body?: unknown; title?: string }) => {
      if (!doc) return;
      if (doc.can_write === false) { setSaveState("readonly"); return; }
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          await apiFetch(`/api/v1/docs/${doc.id}`, { method: "PATCH", body: JSON.stringify(patch) });
          setSaveState("saved");
          setDoc((d) => (d ? { ...d, updated_at: new Date().toISOString() } : d));
        } catch (e: any) {
          setSaveState(e?.status === 403 ? "readonly" : "idle");
          if (e?.status !== 403) setError("Autosave failed — your last edits may not be saved.");
        }
      }, 700);
    },
    [doc],
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // D5: promote selected text (or the current line) into a task.
  const promoteToTask = useCallback(async (text: string) => {
    if (!promPath) return;
    try {
      const t = await apiFetch(promPath, {
        method: "POST", body: JSON.stringify({ title: text }),
      });
      setPromoteMsg({ ok: true, text: `Added task: “${t.title}”` });
    } catch (e: any) {
      setPromoteMsg({ ok: false, text: e?.status === 403 ? "You can't add tasks here." : "Couldn't add the task." });
    }
    setTimeout(() => setPromoteMsg(null), 3000);
  }, [promPath]);

  // §8: upload a file — sign, upload to Storage with the one-time token, record.
  const uploadAttachment = useCallback(
    async (file: File): Promise<UploadedAttachment | null> => {
      if (!doc) return null;
      const meta = {
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      };
      try {
        const signed = await apiFetch(`/api/v1/docs/${doc.id}/attachments/sign`, {
          method: "POST",
          body: JSON.stringify(meta),
        });
        const { error: upErr } = await supabase.storage
          .from(signed.bucket)
          .uploadToSignedUrl(signed.path, signed.token, file);
        if (upErr) throw new Error(upErr.message);
        const att = await apiFetch(`/api/v1/docs/${doc.id}/attachments`, {
          method: "POST",
          body: JSON.stringify({ ...meta, storage_path: signed.path }),
        });
        setFilesVersion((v) => v + 1); // refresh the Files rail
        return { id: att.id, filename: att.filename, mime_type: att.mime_type, is_image: att.is_image };
      } catch (e: any) {
        const text =
          e?.status === 413 ? "File too large (max 25 MB)."
          : e?.status === 415 ? "That file type isn’t allowed."
          : e?.status === 403 ? "You can’t upload here."
          : "Upload failed — please try again.";
        setPromoteMsg({ ok: false, text });
        setTimeout(() => setPromoteMsg(null), 3000);
        return null;
      }
    },
    [doc],
  );

  // AI pass: run a ✨ action server-side (grounded in the initiative's live data).
  const runAssist = useCallback(
    async (action: string, selection: string) => {
      if (!doc) throw new Error("No document");
      return apiFetch(`/api/v1/docs/${doc.id}/ai`, {
        method: "POST",
        body: JSON.stringify({ action, selection: selection || undefined }),
      });
    },
    [doc],
  );

  const editable = doc?.can_write !== false;

  // The writing surface (shared by both layouts).
  const canvas = loading ? (
    <div className="h-[50vh] flex items-center justify-center"><Spinner /></div>
  ) : error ? (
    <div className="text-sm text-danger-600">
      {error}
      <button onClick={load} className="ml-2 underline text-ocean">Retry</button>
    </div>
  ) : !doc ? (
    <div className="h-[50vh] flex flex-col items-center justify-center text-center gap-3">
      <FileText className="w-8 h-8 text-fg-subtle" />
      <p className="text-sm text-fg-muted max-w-xs">
        No work document yet for <span className="font-medium text-fg">{displayName}</span>.
      </p>
      <button onClick={createDoc}
        className="px-3 py-1.5 rounded-lg bg-ocean text-white text-sm font-semibold hover:opacity-90">
        Start a work document
      </button>
    </div>
  ) : (
    <>
      {!editable && (
        <div className="mb-3 text-xs text-fg-subtle bg-mist rounded-lg px-3 py-2">
          You have read-only access to this document.
        </div>
      )}
      <input
        defaultValue={doc.title}
        disabled={!editable}
        onChange={(e) => queueSave({ title: e.target.value || "Work document" })}
        className={`w-full bg-transparent outline-none font-display font-semibold text-fg disabled:opacity-100 mb-2 ${
          expanded ? "text-3xl" : "text-xl"
        }`}
        placeholder="Untitled"
      />
      {promoteMsg && (
        <div className={`mb-2 text-xs rounded-lg px-3 py-2 ${
          promoteMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
        }`}>
          {promoteMsg.text}
        </div>
      )}
      <WorkDocEditor
        key={doc.id}
        value={doc.body}
        editable={editable}
        onChange={(json) => queueSave({ body: json })}
        onPromote={editable && promPath ? promoteToTask : undefined}
        onUpload={editable ? uploadAttachment : undefined}
        onAssist={editable ? runAssist : undefined}
      />
      <DocBookmarks
        docId={doc.id}
        bookmarks={doc.bookmarks ?? []}
        editable={editable}
        onChange={(bm) => setDoc((d) => (d ? { ...d, bookmarks: bm } : d))}
      />
    </>
  );

  const mentionsList = (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-3.5 h-3.5 text-fg-subtle" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Mentioned in {backlinks.length > 0 && <span className="text-fg-subtle/70">· {backlinks.length}</span>}
        </span>
      </div>
      {backlinks.length === 0 ? (
        <p className="text-xs text-fg-subtle">No other docs mention this initiative yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {backlinks.map((b) => (
            <li key={b.doc_id} className="text-xs text-fg-muted truncate">
              <FileText className="inline w-3.5 h-3.5 text-fg-subtle mr-1 -mt-0.5" />
              {b.doc_title}
              <span className="text-fg-subtle"> · {b.initiative_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const header = (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-pebble shrink-0">
      <FileText className="w-4 h-4 text-ocean shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg-subtle truncate">
          {displaySub ? `${displaySub} · ` : ""}{displayName}
        </div>
        <div className="text-sm font-semibold text-fg truncate">Work document</div>
      </div>
      {doc?.updated_at && saveState !== "saving" && (
        <span className="text-[11px] text-fg-subtle shrink-0 hidden sm:inline">Edited {editedAgo(doc.updated_at)}</span>
      )}
      <SaveBadge state={saveState} />
      <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Collapse" : "Expand to full screen"}
        className="p-1.5 rounded-md hover:bg-mist text-fg-muted">
        {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
      <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-md hover:bg-mist text-fg-muted">
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  // ── Full-page focus mode: centered canvas + right context rail ────────────
  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {header}
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[760px] px-8 py-10">{canvas}</div>
          </div>
          {doc && (
            <aside className="w-80 shrink-0 border-l border-pebble bg-mist/10 overflow-y-auto">
              <div className="flex items-center gap-1 px-3 pt-3">
                <RailTab label="Files" active={railTab === "files"} onClick={() => setRailTab("files")} icon={<Paperclip className="w-3.5 h-3.5" />} />
                <RailTab label="Mentions" active={railTab === "mentions"} onClick={() => setRailTab("mentions")} icon={<Link2 className="w-3.5 h-3.5" />} />
              </div>
              {railTab === "files" ? <DocFilesRail docId={doc.id} refreshKey={filesVersion} /> : mentionsList}
            </aside>
          )}
        </div>
      </div>
    );
  }

  // ── Side-peek (quick) ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-midnight/20 backdrop-blur-[1px]" />
      <aside className="relative h-full bg-white shadow-2xl border-l border-pebble flex flex-col animate-slide-in-right w-full max-w-xl">
        {header}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {canvas}
          {doc && (
            <div className="mt-6 pt-2 border-t border-pebble">
              <DocFilesRail docId={doc.id} refreshKey={filesVersion} />
            </div>
          )}
          {backlinks.length > 0 && mentionsList}
        </div>
      </aside>
    </div>
  );
}

function RailTab({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${
        active ? "bg-white text-ocean shadow-sm" : "text-fg-muted hover:text-fg"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "readonly" }) {
  if (state === "idle") return null;
  const map = { saving: "Saving…", saved: "Saved", readonly: "Read-only" } as const;
  return <span className="text-xs text-fg-subtle shrink-0">{map[state]}</span>;
}

/** External link bookmarks for a doc (deck: "files, links & references"). */
function DocBookmarks({
  docId, bookmarks, editable, onChange,
}: {
  docId: string;
  bookmarks: { url: string; label?: string }[];
  editable: boolean;
  onChange: (bm: { url: string; label?: string }[]) => void;
}) {
  async function save(next: { url: string; label?: string }[]) {
    onChange(next);
    try { await apiFetch(`/api/v1/docs/${docId}`, { method: "PATCH", body: JSON.stringify({ bookmarks: next }) }); }
    catch { /* optimistic; next load corrects */ }
  }
  function add() {
    const url = window.prompt("Link URL (https://…)")?.trim();
    if (!url) return;
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const label = window.prompt("Label (optional)")?.trim() || normalized;
    save([...bookmarks, { url: normalized, label }]);
  }
  if (bookmarks.length === 0 && !editable) return null;
  return (
    <div className="mt-5 pt-3 border-t border-pebble">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="w-3.5 h-3.5 text-fg-subtle" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Links</span>
      </div>
      <ul className="space-y-1">
        {bookmarks.map((b, i) => (
          <li key={i} className="flex items-center gap-2 text-[12.5px]">
            <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-ocean hover:underline truncate">{b.label || b.url}</a>
            {editable && (
              <button type="button" onClick={() => save(bookmarks.filter((_, j) => j !== i))} className="ml-auto text-fg-subtle hover:text-red-600">Remove</button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <button type="button" onClick={add} className="mt-1.5 text-[12px] text-ocean font-semibold hover:underline">+ Add link</button>
      )}
    </div>
  );
}
