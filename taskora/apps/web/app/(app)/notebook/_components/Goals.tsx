"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

/**
 * Goals panel — single owner-only document per user. Free-form text;
 * we store an array of strings so a richer block structure can land
 * later without a migration.
 *
 * Autosave on blur + debounce on edit so we don't hammer the API.
 */
export default function Goals() {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch("/api/v1/notebook/goals");
        const body: unknown = data?.body ?? [];
        setItems(Array.isArray(body) ? (body as string[]) : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const persist = useCallback(async (next: string[]) => {
    setSaving(true);
    try {
      await apiFetch("/api/v1/notebook/goals", {
        method: "PUT",
        body: JSON.stringify({ body: next }),
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const updateAt = (i: number, v: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[i] = v;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persist(next), 800);
      return next;
    });
  };

  const addRow = () => {
    setItems((prev) => {
      const next = [...prev, ""];
      persist(next);
      return next;
    });
  };

  const removeAt = (i: number) => {
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      persist(next);
      return next;
    });
  };

  if (loading) {
    return <div className="text-xs text-steel/60">Loading goals…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold tracking-wide text-steel uppercase">Goals</h2>
        {saving && <span className="text-[10px] text-steel/60">saving…</span>}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-steel/60 italic">
          No goals yet — add one below. These are private to you.
        </p>
      )}
      <ul className="space-y-1">
        {items.map((g, i) => (
          <li key={i} className="flex gap-1.5 items-start group">
            <span className="text-taskora-red mt-1.5 text-xs">◆</span>
            <textarea
              value={g}
              onChange={(e) => updateAt(i, e.target.value)}
              rows={1}
              className="flex-1 bg-transparent text-sm text-midnight resize-none focus:outline-none placeholder:text-steel/40"
              placeholder="What are you aiming for?"
              style={{ minHeight: "1.5rem" }}
            />
            <button
              onClick={() => removeAt(i)}
              className="opacity-0 group-hover:opacity-100 text-steel/50 hover:text-red-500 text-xs leading-none mt-1"
              aria-label="Remove goal"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={addRow}
        className="text-xs text-steel/70 hover:text-taskora-red transition-colors"
      >
        + Add a goal
      </button>
    </div>
  );
}
