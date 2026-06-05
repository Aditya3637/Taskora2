"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { X, Maximize2, Minimize2, FileText } from "lucide-react";
import { WorkDocEditor } from "./WorkDocEditor";

type Doc = {
  id: string;
  title: string;
  body: unknown;
  updated_at?: string;
  can_write?: boolean;
};
type Backlink = { doc_id: string; doc_title: string; initiative_id: string; initiative_name: string };

/**
 * Slide-over Work Document for an initiative (D2). Opens from the right; the
 * page stays behind it; ⤢ expands to full width. Loads the initiative's first
 * work doc (or offers to create one), then autosaves the body + title.
 */
export function WorkDocPanel({
  initiativeId,
  initiativeName,
  onClose,
}: {
  initiativeId: string;
  initiativeName: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "readonly">("idle");
  const [promoteMsg, setPromoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the initiative's first work doc (newest), if any.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list: Doc[] = await apiFetch(`/api/v1/initiatives/${initiativeId}/docs`);
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
    // Inbound mentions of this initiative (best-effort; don't block the doc).
    apiFetch(`/api/v1/initiatives/${initiativeId}/backlinks`)
      .then((r) => setBacklinks(r?.backlinks ?? []))
      .catch(() => setBacklinks([]));
  }, [initiativeId]);

  useEffect(() => { load(); }, [load]);

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function createDoc() {
    try {
      const created: Doc = await apiFetch(`/api/v1/initiatives/${initiativeId}/docs`, {
        method: "POST",
        body: JSON.stringify({ title: "Work document" }),
      });
      setDoc(created);
    } catch (e: any) {
      setError(e?.detail || "Couldn't create the work document.");
    }
  }

  // Debounced autosave of the editor body.
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
        } catch (e: any) {
          setSaveState(e?.status === 403 ? "readonly" : "idle");
          if (e?.status !== 403) setError("Autosave failed — your last edits may not be saved.");
        }
      }, 700);
    },
    [doc],
  );

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  // D5: promote selected text (or the current line) into a task on this initiative.
  const promoteToTask = useCallback(async (text: string) => {
    try {
      const t = await apiFetch(`/api/v1/initiatives/${initiativeId}/promote-task`, {
        method: "POST", body: JSON.stringify({ title: text }),
      });
      setPromoteMsg({ ok: true, text: `Added task: “${t.title}”` });
    } catch (e: any) {
      setPromoteMsg({ ok: false, text: e?.status === 403 ? "You can't add tasks here." : "Couldn't add the task." });
    }
    setTimeout(() => setPromoteMsg(null), 3000);
  }, [initiativeId]);

  const editable = doc?.can_write !== false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* scrim */}
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-midnight/20 backdrop-blur-[1px]" />
      <aside
        className={`relative h-full bg-white shadow-2xl border-l border-pebble flex flex-col animate-slide-in-right ${
          expanded ? "w-full max-w-4xl" : "w-full max-w-xl"
        }`}
      >
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-pebble shrink-0">
          <FileText className="w-4 h-4 text-ocean shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg truncate">Work document</div>
            <div className="text-xs text-fg-subtle truncate">{initiativeName}</div>
          </div>
          <SaveBadge state={saveState} />
          <button onClick={() => setExpanded((v) => !v)} title={expanded ? "Collapse" : "Expand"}
            className="p-1.5 rounded-md hover:bg-mist text-fg-muted">
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={onClose} title="Close (Esc)" className="p-1.5 rounded-md hover:bg-mist text-fg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
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
                No work document yet for <span className="font-medium text-fg">{initiativeName}</span>.
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
                className="w-full text-xl font-display font-semibold text-fg bg-transparent outline-none mb-2 disabled:opacity-100"
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
                onPromote={editable ? promoteToTask : undefined}
              />
            </>
          )}

          {backlinks.length > 0 && (
            <div className="mt-6 pt-4 border-t border-pebble">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle mb-2">
                Mentioned in
              </div>
              <ul className="space-y-1">
                {backlinks.map((b) => (
                  <li key={b.doc_id} className="text-sm text-fg-muted truncate">
                    <FileText className="inline w-3.5 h-3.5 text-fg-subtle mr-1 -mt-0.5" />
                    {b.doc_title}
                    <span className="text-fg-subtle"> · {b.initiative_name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "readonly" }) {
  if (state === "idle") return null;
  const map = {
    saving: "Saving…",
    saved: "Saved",
    readonly: "Read-only",
  } as const;
  return <span className="text-xs text-fg-subtle shrink-0">{map[state]}</span>;
}
