"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, Wand2, ListChecks, FileText, Gauge, Loader2, X, Copy, CornerDownLeft } from "lucide-react";

export type AiResult =
  | { kind: "text"; text: string }
  | { kind: "actions"; actions: string[] };

type Action = { key: string; label: string; icon: typeof Wand2; hint: string };
const ACTIONS: Action[] = [
  { key: "enhance", label: "Enhance notes", icon: Wand2, hint: "Clean up & structure" },
  { key: "summarize", label: "Summarize", icon: FileText, hint: "Tighten to bullets" },
  { key: "draft_status", label: "Draft status", icon: Gauge, hint: "RAG + next steps from live data" },
  { key: "extract_actions", label: "Extract action items", icon: ListChecks, hint: "Pull out to-dos" },
];

// Minimal markdown → HTML (paragraphs, "-" bullets, **bold**) so inserted AI
// output keeps its shape without a full markdown parser.
function mdLite(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let html = "", inUl = false;
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inUl) { html += "<ul>"; inUl = true; }
      html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
    } else {
      if (inUl) { html += "</ul>"; inUl = false; }
      if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
  }
  if (inUl) html += "</ul>";
  return html || `<p>${inline(md)}</p>`;
}

/**
 * The ✨ in-document AI control. A small menu of actions (enhance / summarize /
 * draft status / extract action items); results land in a review card so the
 * user inserts/replaces/adds — AI drafts, human approves. Grounded server-side
 * in the initiative's live data.
 */
export function AiAssist({
  editor,
  onAssist,
  onPromote,
  promoteLabel,
}: {
  editor: Editor;
  onAssist: (action: string, selection: string) => Promise<AiResult>;
  onPromote?: (text: string) => void;
  promoteLabel?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiResult | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [picked, setPicked] = useState<Record<number, boolean>>({});

  const run = async (action: string) => {
    const { from, to, empty } = editor.state.selection;
    const selection = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
    setRange(empty ? null : { from, to });
    setMenuOpen(false);
    setBusy(action);
    setError(null);
    try {
      const res = await onAssist(action, selection);
      setResult(res);
      if (res.kind === "actions") setPicked(Object.fromEntries(res.actions.map((_, i) => [i, true])));
    } catch (e: any) {
      setError(e?.detail || e?.message || "The AI request failed.");
    } finally {
      setBusy(null);
    }
  };

  const close = () => { setResult(null); setError(null); setRange(null); };

  const insertText = (text: string, replace: boolean) => {
    const chain = editor.chain().focus();
    if (replace && range) chain.deleteRange(range);
    chain.insertContent(mdLite(text)).run();
    close();
  };

  const insertChecklist = (items: string[]) => {
    editor.chain().focus().insertContent({
      type: "taskList",
      content: items.map((t) => ({
        type: "taskItem", attrs: { checked: false },
        content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
      })),
    }).run();
    close();
  };

  const addAsTasks = (items: string[]) => {
    items.forEach((t) => onPromote?.(t));
    close();
  };

  return (
    <span className="relative">
      <button
        type="button"
        title="Ask AI"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={!!busy}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-ocean hover:bg-mist transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} AI
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[60] w-60 wd-mention-pop">
            {ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(a.key)}
                  className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-mist"
                >
                  <Icon className="w-4 h-4 text-ocean shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{a.label}</span>
                    <span className="block text-[11px] text-fg-subtle truncate">{a.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {(result || error) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-midnight/30 p-4" onClick={close}>
          <div className="bg-white rounded-2xl shadow-2xl border border-pebble w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-pebble">
              <Sparkles className="w-4 h-4 text-ocean" />
              <span className="text-sm font-semibold text-fg flex-1">AI suggestion</span>
              <button onClick={close} className="p-1 rounded-md hover:bg-mist text-fg-muted"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {error ? (
                <p className="text-sm text-danger-600">{error}</p>
              ) : result?.kind === "text" ? (
                <div className="text-sm text-fg whitespace-pre-wrap leading-relaxed">{result.text}</div>
              ) : result?.kind === "actions" ? (
                result.actions.length === 0 ? (
                  <p className="text-sm text-fg-subtle">No action items found in this document.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {result.actions.map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <input type="checkbox" checked={picked[i] ?? true}
                          onChange={(e) => setPicked((p) => ({ ...p, [i]: e.target.checked }))}
                          className="mt-1 w-4 h-4 accent-ocean" />
                        <span className="text-sm text-fg">{t}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>

            {!error && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-pebble">
                {result?.kind === "text" && (
                  <>
                    <button onClick={() => navigator.clipboard?.writeText(result.text)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-fg-muted hover:bg-mist">
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    {range && (
                      <button onClick={() => insertText(result.text, true)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-pebble hover:border-ocean hover:text-ocean">
                        Replace selection
                      </button>
                    )}
                    <button onClick={() => insertText(result.text, false)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ocean text-white hover:opacity-90">
                      <CornerDownLeft className="w-3.5 h-3.5" /> Insert
                    </button>
                  </>
                )}
                {result?.kind === "actions" && result.actions.length > 0 && (
                  <>
                    {onPromote && (
                      <button onClick={() => addAsTasks(result.actions.filter((_, i) => picked[i] ?? true))}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-pebble hover:border-ocean hover:text-ocean">
                        Add as {promoteLabel ?? "task"}s
                      </button>
                    )}
                    <button onClick={() => insertChecklist(result.actions.filter((_, i) => picked[i] ?? true))}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ocean text-white hover:opacity-90">
                      <ListChecks className="w-3.5 h-3.5" /> Insert as to-do list
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
