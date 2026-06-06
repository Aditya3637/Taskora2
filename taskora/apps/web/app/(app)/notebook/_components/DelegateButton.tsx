"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * Notebook "Delegate" toolbar action (convergence N-4b). Sends the current line
 * to the inbox of the teammate @-mentioned on it (notebook_assignments). Reads
 * the line + its first `user:<id>` mention straight from the editor state — no
 * separate recipient picker, mirroring the old delegate-by-mention flow.
 */
export function DelegateButton({ editor, pageId }: { editor: Editor; pageId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const delegate = async () => {
    // The textblock the cursor is in.
    const { $from } = editor.state.selection;
    const line = $from.parent;
    const text = (line.textContent || "").trim();

    let recipientId: string | null = null;
    let recipientName = "teammate";
    line.descendants((node: any) => {
      if (recipientId) return false;
      if (node.type?.name === "mention" && typeof node.attrs?.id === "string" && node.attrs.id.startsWith("user:")) {
        recipientId = node.attrs.id.slice(5);
        recipientName = node.attrs.label || recipientName;
      }
      return true;
    });

    if (!recipientId) { flash(false, "@-mention a teammate on this line to delegate it."); return; }
    if (!text) { flash(false, "Nothing on this line to delegate."); return; }

    setBusy(true);
    try {
      await apiFetch("/api/v1/notebook/assignments", {
        method: "POST",
        body: JSON.stringify({ recipient_id: recipientId, content: text, source_page_id: pageId }),
      });
      flash(true, `Sent to ${recipientName}’s inbox.`);
    } catch (e: any) {
      flash(false, e?.status === 403 ? "You can’t delegate to that person." : "Couldn’t send — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="relative">
      <button
        type="button"
        title="Delegate this line to the @-mentioned teammate"
        onMouseDown={(e) => e.preventDefault()}
        onClick={delegate}
        disabled={busy}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-fg-muted hover:bg-mist hover:text-ocean transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Delegate
      </button>
      {msg && (
        <span
          className={`absolute left-0 top-full mt-1 whitespace-nowrap text-[11px] rounded-md px-2 py-1 z-20 ${
            msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
