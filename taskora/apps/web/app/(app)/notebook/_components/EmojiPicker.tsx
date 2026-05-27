"use client";
import { useEffect, useRef, useState } from "react";

const PRESETS = [
  "📓", "📝", "📒", "📔", "📕", "📗", "📘", "📙",
  "💡", "✨", "⭐", "🎯", "🚀", "🔥", "✅", "🛠️",
  "📊", "📈", "📉", "🗓️", "⏰", "📌", "🔖", "🏷️",
  "👥", "🤝", "💬", "📞", "🎤", "🎥", "📸", "🎨",
  "🏠", "🏢", "🏗️", "🛒", "💰", "💼", "🧾", "📦",
  "🌟", "❤️", "🌱", "🌍", "☀️", "🌙", "⚡", "🎉",
];

/**
 * Minimal emoji picker — a small popover with a grid of preset emojis
 * plus a free-text input for arbitrary characters (Unicode or short
 * shortcodes the user pastes in). Click an emoji to pick.
 */
export default function EmojiPicker({
  value,
  onChange,
  onClose,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  onClose: () => void;
}) {
  const [custom, setCustom] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Escape dismisses; click-outside dismisses. Bound at document level
  // because the picker is positioned absolute inside an arbitrary parent.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    // Defer mousedown listener by a tick so the click that opened the
    // picker doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Pick an icon"
      className="absolute z-30 bg-white border border-pebble rounded-lg shadow-lg p-2 w-64"
    >
      <div className="grid grid-cols-8 gap-1 mb-2">
        {PRESETS.map((e) => (
          <button
            key={e}
            onClick={() => { onChange(e); onClose(); }}
            aria-label={`Pick ${e}`}
            className={`h-7 w-7 flex items-center justify-center rounded text-lg hover:bg-pebble/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taskora-red/40 ${
              value === e ? "bg-pebble" : ""
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-pebble pt-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value.slice(0, 8))}
          placeholder="Paste any emoji"
          aria-label="Custom emoji"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 text-sm border border-pebble rounded px-2 py-1 focus:outline-none focus:border-taskora-red"
        />
        <button
          onClick={() => { if (custom) { onChange(custom); onClose(); } }}
          className="text-xs px-2 py-1 bg-midnight text-white rounded hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taskora-red/40"
          disabled={!custom}
        >
          Use
        </button>
        {value && (
          <button
            onClick={() => { onChange(null); onClose(); }}
            aria-label="Remove icon"
            className="text-xs px-2 py-1 border border-pebble text-steel rounded hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-taskora-red/40"
            title="Remove icon"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
