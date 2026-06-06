"use client";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { FileText, Download, X, ImageOff } from "lucide-react";

/**
 * A workspace-doc attachment (D6 / §8). The body stores ONLY the
 * attachment id — never the bytes or a signed URL (which expires). The node
 * view resolves a fresh short-lived signed URL from the backend at render
 * time (GET /attachments/{id}/url), which re-checks the doc's visibility, so
 * the persisted document stays small and a stale doc can never leak a file.
 */
export const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: { default: null },
      filename: { default: "" },
      mime: { default: "" },
      isImage: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({
        "data-attachment-id": HTMLAttributes.attachmentId,
        "data-filename": HTMLAttributes.filename,
        "data-mime": HTMLAttributes.mime,
        "data-is-image": HTMLAttributes.isImage ? "true" : "false",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function AttachmentView({ node, deleteNode, editor }: NodeViewProps) {
  const { attachmentId, filename, isImage } = node.attrs as {
    attachmentId: string | null;
    filename: string;
    isImage: boolean;
  };
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<number | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  // Resolve a fresh signed URL for images so they render inline. File chips
  // resolve on-demand (on Download click) to avoid minting URLs we may not use.
  useEffect(() => {
    let alive = true;
    if (!attachmentId || !isImage) return;
    apiFetch(`/api/v1/attachments/${attachmentId}/url`)
      .then((r) => { if (alive) { setUrl(r?.url ?? null); setSize(r?.size_bytes); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attachmentId, isImage]);

  const download = async () => {
    try {
      const r = await apiFetch(`/api/v1/attachments/${attachmentId}/url`);
      if (r?.url) window.open(r.url, "_blank", "noopener");
    } catch {
      setFailed(true);
    }
  };

  const remove = async () => {
    try { await apiFetch(`/api/v1/attachments/${attachmentId}`, { method: "DELETE" }); } catch { /* row may already be gone */ }
    deleteNode();
  };

  const canEdit = editor.isEditable;

  return (
    <NodeViewWrapper className="my-2" data-attachment-id={attachmentId ?? undefined}>
      <div className="group relative inline-block max-w-full">
        {isImage ? (
          failed ? (
            <div className="flex items-center gap-2 text-xs text-fg-subtle border border-pebble rounded-lg px-3 py-2">
              <ImageOff className="w-4 h-4" /> Couldn’t load “{filename}”.
            </div>
          ) : url ? (
            <img src={url} alt={filename} className="max-w-full rounded-lg border border-pebble" />
          ) : (
            <div className="w-48 h-28 rounded-lg border border-pebble bg-mist animate-pulse" />
          )
        ) : (
          <button
            type="button"
            onClick={download}
            className="flex items-center gap-2 text-left border border-pebble rounded-lg px-3 py-2 hover:bg-mist transition-colors max-w-sm"
          >
            <FileText className="w-5 h-5 text-ocean shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm text-fg truncate">{filename || "Attachment"}</span>
              {size ? <span className="block text-[11px] text-fg-subtle">{fmtBytes(size)}</span> : null}
            </span>
            <Download className="w-4 h-4 text-fg-subtle shrink-0 ml-1" />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            title="Remove attachment"
            onClick={remove}
            contentEditable={false}
            className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-pebble rounded-full p-0.5 text-fg-muted hover:text-danger-600 shadow-sm"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}
