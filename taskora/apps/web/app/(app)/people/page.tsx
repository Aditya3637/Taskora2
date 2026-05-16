"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { PersonCard } from "@/components/people/PersonCard";
import { FocusBoard } from "@/components/people/FocusBoard";
import type { BoardResp, FocusResp } from "@/components/people/types";

export default function PeoplePage() {
  const [board, setBoard] = useState<BoardResp | null>(null);
  const [focus, setFocus] = useState<FocusResp | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState("");

  const loadBoard = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      setBoard(await apiFetch("/api/v1/people/board"));
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("access required")) setDenied(true);
      else setErr(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (!focusId) {
      setFocus(null);
      return;
    }
    let live = true;
    apiFetch(`/api/v1/people/board/${focusId}`)
      .then((d) => live && setFocus(d))
      .catch((e) => live && setErr(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [focusId]);

  if (denied) {
    return (
      <div className="h-[calc(100vh-3.5rem)] md:h-screen grid place-items-center bg-mist p-6">
        <div className="bg-white rounded-xl border border-pebble p-8 max-w-sm text-center">
          <p className="text-3xl mb-3">🔒</p>
          <h1 className="text-midnight font-semibold mb-1">People board</h1>
          <p className="text-sm text-steel">
            This is a management view. Ask a workspace admin to grant you access
            from Workspace Settings.
          </p>
        </div>
      </div>
    );
  }

  if (focusId && focus) {
    return (
      <div className="h-[calc(100vh-3.5rem)] md:h-screen">
        <FocusBoard focus={focus} onBack={() => setFocusId(null)} />
      </div>
    );
  }

  const t = board?.totals;

  return (
    <div className="h-[calc(100vh-3.5rem)] md:h-screen flex flex-col bg-mist overflow-hidden">
      <div className="bg-white border-b border-pebble px-5 py-3 flex-shrink-0">
        <h1 className="text-midnight font-semibold text-lg">People</h1>
        <p className="text-xs text-steel">
          {t
            ? `${t.people} people · ${t.overdue} overdue · ${t.blocked} blocked · ${t.awaiting_their_approval} awaiting their approval`
            : "Who to push, on what — ranked by where attention is needed."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading && (
          <p className="text-steel text-sm text-center py-12">Loading…</p>
        )}
        {err && !loading && (
          <p className="text-red-700 text-sm text-center py-12">{err}</p>
        )}
        {!loading && board && board.people.length === 0 && (
          <p className="text-steel text-sm text-center py-12">
            No one owns active work yet.
          </p>
        )}
        {!loading && board && board.people.length > 0 && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {board.people.map((p) => (
              <PersonCard
                key={p.user_id}
                person={p}
                onOpen={setFocusId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
