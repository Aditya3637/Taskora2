"use client";
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { FileText, Download, Paperclip } from "lucide-react";

type Attachment = {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes?: number;
  is_image: boolean;
};

function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The doc's "Files" section — a single place that lists every attachment on
 * the document (image thumbnails + file chips), independent of where each one
 * sits inline. Mirrors doc_attachments via GET /docs/{id}/attachments. Reloads
 * whenever `refreshKey` changes (e.g. after a new upload).
 */
export function DocFilesRail({ docId, refreshKey = 0 }: { docId: string; refreshKey?: number }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows: Attachment[] = await apiFetch(`/api/v1/docs/${docId}/attachments`);
      setItems(rows);
      const entries = await Promise.all(
        rows.filter((r) => r.is_image).map(async (r) => {
          try {
            const u = await apiFetch(`/api/v1/attachments/${r.id}/url`);
            return [r.id, u?.url ?? ""] as const;
          } catch {
            return [r.id, ""] as const;
          }
        }),
      );
      setThumbs(Object.fromEntries(entries));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [docId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const open = async (id: string) => {
    try {
      const u = await apiFetch(`/api/v1/attachments/${id}/url`);
      if (u?.url) window.open(u.url, "_blank", "noopener");
    } catch { /* transient — the signed URL just couldn't be minted */ }
  };

  const images = items.filter((i) => i.is_image);
  const files = items.filter((i) => !i.is_image);

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Paperclip className="w-3.5 h-3.5 text-fg-subtle" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Files {items.length > 0 && <span className="text-fg-subtle/70">· {items.length}</span>}
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => <div key={i} className="aspect-square rounded-lg bg-mist animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-fg-subtle leading-relaxed">
          No files yet. Drag an image or file onto the page, paste from your clipboard, or use 📎.
        </p>
      ) : (
        <div className="space-y-3">
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {images.map((img) => (
                <button
                  key={img.id}
                  onClick={() => open(img.id)}
                  title={img.filename}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-pebble bg-mist hover:border-ocean transition-colors"
                >
                  {thumbs[img.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[img.id]} alt={img.filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full animate-pulse" />
                  )}
                </button>
              ))}
            </div>
          )}
          {files.map((f) => (
            <button
              key={f.id}
              onClick={() => open(f.id)}
              title={f.filename}
              className="w-full flex items-center gap-2 text-left border border-pebble rounded-lg px-2.5 py-2 hover:bg-white hover:border-ocean transition-colors"
            >
              <FileText className="w-4 h-4 text-ocean shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-fg truncate">{f.filename}</span>
                {f.size_bytes ? <span className="block text-[10px] text-fg-subtle">{fmtBytes(f.size_bytes)}</span> : null}
              </span>
              <Download className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
