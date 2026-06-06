"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Target, X, Plus } from "lucide-react";
import { apiFetch } from "@/lib/api";

/**
 * Goals panel — single owner-only document per user. Free-form text;
 * we store an array of strings so a richer block structure can land
 * later without a migration.
 *
 * Keyboard-first:
 *   - Enter           → commit the line and start a new goal below
 *   - Shift+Enter     → newline within the current goal
 *   - Backspace (empty, not the only row) → delete this goal, focus prev
 *   - ArrowUp/Down at the line edge → move between goals
 *
 * Autosave: debounced on edit, immediate on structural changes
 * (add/remove) so a new empty row isn't lost if you navigate away.
 */
export default function Goals() {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  // Index to focus after the next render (set by add/remove ops).
  const focusTarget = useRef<number | null>(null);

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

  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Apply a queued focus request once the new row is in the DOM, and keep
  // every row sized to its content (so Shift+Enter newlines grow the box).
  useEffect(() => {
    inputRefs.current.forEach(fit);
    if (focusTarget.current == null) return;
    const el = inputRefs.current[focusTarget.current];
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
    focusTarget.current = null;
  });

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

  /** Insert a fresh empty goal after index `i` (or at end when i = -1). */
  const insertAfter = (i: number) => {
    setItems((prev) => {
      const at = i < 0 ? prev.length : i + 1;
      const next = [...prev];
      next.splice(at, 0, "");
      focusTarget.current = at;
      persist(next);
      return next;
    });
  };

  const removeAt = (i: number, focusPrev = false) => {
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      if (focusPrev) focusTarget.current = Math.max(0, i - 1);
      persist(next);
      return next;
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    const el = e.currentTarget;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      insertAfter(i);
      return;
    }
    if (e.key === "Backspace" && el.value === "" && items.length > 1) {
      e.preventDefault();
      removeAt(i, true);
      return;
    }
    if (e.key === "ArrowUp" && el.selectionStart === 0 && i > 0) {
      e.preventDefault();
      focusTarget.current = i - 1;
      // Trigger the focus effect without changing data.
      setItems((prev) => [...prev]);
    } else if (
      e.key === "ArrowDown" &&
      el.selectionStart === el.value.length &&
      i < items.length - 1
    ) {
      e.preventDefault();
      focusTarget.current = i + 1;
      setItems((prev) => [...prev]);
    }
  };

  if (loading) {
    return <div className="text-xs text-steel/60">Loading goals…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
          <Target className="w-3.5 h-3.5 text-ocean" /> Goals
        </h2>
        {saving && <span className="text-[10px] text-fg-subtle">saving…</span>}
      </div>
      {items.length === 0 && (
        <p className="text-xs text-fg-subtle">
          No goals yet — add one below. These are private to you.
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((g, i) => (
          <li key={i} className="flex gap-2 items-start group rounded-md px-1.5 py-1 -mx-1.5 hover:bg-mist/60 transition-colors">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-ocean/70 shrink-0" />
            <textarea
              ref={(el) => { inputRefs.current[i] = el; }}
              value={g}
              onChange={(e) => updateAt(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              rows={1}
              className="flex-1 bg-transparent text-sm text-fg resize-none focus:outline-none placeholder:text-fg-subtle"
              placeholder="What are you aiming for?"
              style={{ minHeight: "1.5rem" }}
            />
            <button
              onClick={() => removeAt(i)}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-fg-subtle hover:text-red-500 hover:bg-white mt-0.5"
              aria-label="Remove goal"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={() => insertAfter(-1)}
        className="flex items-center gap-1 text-xs text-fg-subtle hover:text-ocean transition-colors mt-1"
      >
        <Plus className="w-3.5 h-3.5" /> Add a goal <span className="text-fg-subtle/70">· or press Enter</span>
      </button>
    </div>
  );
}
