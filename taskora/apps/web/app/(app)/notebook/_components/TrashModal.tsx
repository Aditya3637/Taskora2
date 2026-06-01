"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Page } from "../_lib/types";

/**
 * Trash — soft-archived pages, restorable or purgeable. Pages are
 * soft-deleted (archived_at) on delete, so nothing is actually lost until
 * the owner purges it here.
 *
 *   - Restore  → un-archives; the page reappears in the sidebar (parent
 *                refetches via onRestored). If its project was archived,
 *                the backend moves it to Unfiled so it stays visible.
 *   - Delete forever → hard delete (confirmed). Irreversible.
 */
function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function TrashModal({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  /** Called after a successful restore so the parent can refresh its
   *  page list (and optionally open the restored page). */
  onRestored: (restored: Page) => void;
}) {
  const [items, setItems] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await apiFetch("/api/v1/notebook/pages/trash")) as Page[];
      setItems(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const restore = async (p: Page) => {
    setBusyId(p.id);
    try {
      const restored = (await apiFetch(`/api/v1/notebook/pages/${p.id}/restore`, {
        method: "POST",
      })) as Page;
      setItems((prev) => prev.filter((x) => x.id !== p.id));
      onRestored(restored);
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (p: Page) => {
    if (!window.confirm(`Permanently delete "${p.title || "Untitled"}"? This cannot be undone.`)) {
      return;
    }
    setBusyId(p.id);
    try {
      await apiFetch(`/api/v1/notebook/pages/${p.id}/permanent`, { method: "DELETE" });
      setItems((prev) => prev.filter((x) => x.id !== p.id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Trash"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-pebble flex-shrink-0">
          <h2 className="text-base font-bold text-midnight">🗑 Trash</h2>
          <button
            onClick={onClose}
            className="text-steel/60 hover:text-midnight text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-3 flex-1">
          {loading ? (
            <p className="text-sm text-steel/60 px-2 py-6 text-center">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-steel/60 px-2 py-8 text-center italic">
              Trash is empty. Deleted pages land here and can be restored.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg border border-pebble hover:border-steel/40"
                >
                  <span aria-hidden className="w-5 text-center flex-shrink-0">
                    {p.icon || "📄"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-midnight truncate">
                      {p.title || "Untitled"}
                    </span>
                    <span className="block text-[11px] text-steel/60">
                      Deleted {timeAgo(p.archived_at)}
                    </span>
                  </span>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => restore(p)}
                    className="text-xs px-2 py-1 rounded border border-pebble text-steel hover:text-midnight hover:bg-pebble/40 disabled:opacity-50 flex-shrink-0"
                  >
                    Restore
                  </button>
                  <button
                    disabled={busyId === p.id}
                    onClick={() => purge(p)}
                    className="text-xs px-2 py-1 rounded border border-pebble text-steel/70 hover:text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-50 flex-shrink-0"
                  >
                    Delete forever
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="px-5 py-2.5 border-t border-pebble flex-shrink-0">
            <p className="text-[11px] text-steel/55">
              Restored pages return to the sidebar. “Delete forever” can’t be undone.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
