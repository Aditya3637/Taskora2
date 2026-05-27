"use client";
import { useState } from "react";

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
  return (
    <div className="absolute z-30 bg-white border border-pebble rounded-lg shadow-lg p-2 w-64">
      <div className="grid grid-cols-8 gap-1 mb-2">
        {PRESETS.map((e) => (
          <button
            key={e}
            onClick={() => { onChange(e); onClose(); }}
            className={`h-7 w-7 flex items-center justify-center rounded text-lg hover:bg-pebble/60 ${
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
          className="flex-1 text-sm border border-pebble rounded px-2 py-1 focus:outline-none focus:border-taskora-red"
        />
        <button
          onClick={() => { if (custom) { onChange(custom); onClose(); } }}
          className="text-xs px-2 py-1 bg-midnight text-white rounded hover:opacity-90"
          disabled={!custom}
        >
          Use
        </button>
        {value && (
          <button
            onClick={() => { onChange(null); onClose(); }}
            className="text-xs px-2 py-1 border border-pebble text-steel rounded hover:text-red-500"
            title="Remove icon"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
