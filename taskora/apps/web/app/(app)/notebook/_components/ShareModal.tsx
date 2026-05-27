"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Follower, Person } from "../_lib/types";

/**
 * Share modal. Page-level followers, read-only by default, owner can
 * promote individual followers to editor. People picker shows only
 * workspace-scoped members (server enforces the same).
 */
export default function ShareModal({
  pageId,
  onClose,
}: {
  pageId: string;
  onClose: () => void;
}) {
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const loadFollowers = useCallback(async () => {
    const data = await apiFetch(`/api/v1/notebook/pages/${pageId}/followers`);
    setFollowers(Array.isArray(data) ? data : []);
  }, [pageId]);

  useEffect(() => {
    void loadFollowers();
  }, [loadFollowers]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch(
          `/api/v1/notebook/people-picker?q=${encodeURIComponent(query)}`,
        );
        if (cancelled) return;
        // Workspace-only for sharing.
        setCandidates((data?.in_workspace ?? []) as Person[]);
      } catch {
        if (!cancelled) setCandidates([]);
      }
    })();
    return () => { cancelled = true; };
  }, [query]);

  const add = async (uid: string) => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/api/v1/notebook/pages/${pageId}/followers`, {
        method: "POST",
        body: JSON.stringify({ user_id: uid, role: "viewer" }),
      });
      await loadFollowers();
    } catch (e: unknown) {
      setErr((e as Error)?.message ?? "Failed to add");
    } finally {
      setBusy(false);
    }
  };

  const promote = async (uid: string, role: "viewer" | "editor") => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/api/v1/notebook/pages/${pageId}/followers/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await loadFollowers();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (uid: string) => {
    setBusy(true); setErr("");
    try {
      await apiFetch(`/api/v1/notebook/pages/${pageId}/followers/${uid}`, {
        method: "DELETE",
      });
      await loadFollowers();
    } finally {
      setBusy(false);
    }
  };

  const followerIds = new Set(followers.map((f) => f.user_id));
  const available = candidates.filter((c) => !followerIds.has(c.id));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 max-h-[80vh] overflow-y-auto">
        <header className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-midnight">Share this page</h3>
          <button onClick={onClose} className="text-steel hover:text-midnight">×</button>
        </header>

        <p className="text-xs text-steel/70 mb-3">
          Followers can read by default. Promote individuals to editor if they
          should co-edit. Only people in workspaces you share can be added.
        </p>

        <div className="mb-4">
          <h4 className="text-xs font-bold text-steel uppercase mb-1">Current followers</h4>
          {followers.length === 0 && (
            <p className="text-xs text-steel/60 italic">No one has access yet.</p>
          )}
          {followers.map((f) => (
            <div key={f.user_id} className="flex items-center gap-2 py-1.5 text-sm border-b border-pebble/60">
              <span className="flex-1 text-midnight">{f.name || f.user_id.slice(0, 8)}</span>
              <select
                value={f.role}
                onChange={(e) => promote(f.user_id, e.target.value as "viewer" | "editor")}
                disabled={busy}
                className="text-xs border border-pebble rounded px-1 py-0.5"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button
                onClick={() => remove(f.user_id)}
                disabled={busy}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div>
          <h4 className="text-xs font-bold text-steel uppercase mb-1">Add someone</h4>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name…"
            className="w-full border border-pebble rounded px-2 py-1.5 text-sm focus:outline-none focus:border-taskora-red mb-2"
          />
          <div className="max-h-48 overflow-y-auto">
            {available.length === 0 && (
              <p className="text-xs text-steel/60 italic">
                {query ? "No matches in your workspace." : "Start typing to find people."}
              </p>
            )}
            {available.map((c) => (
              <button
                key={c.id}
                onClick={() => add(c.id)}
                disabled={busy}
                className="w-full text-left px-2 py-1.5 hover:bg-pebble/50 rounded text-sm"
              >
                <span className="text-midnight">{c.name}</span>
                {c.email && <span className="text-steel/60 text-xs ml-2">{c.email}</span>}
              </button>
            ))}
          </div>
        </div>

        {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
      </div>
    </div>
  );
}
