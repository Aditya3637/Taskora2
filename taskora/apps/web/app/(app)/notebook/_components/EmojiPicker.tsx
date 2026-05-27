"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/components/ui";

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
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
      className="absolute z-30 bg-surface border border-line rounded-xl shadow-lg p-2 w-[260px] animate-scale-in origin-top-left"
    >
      <div className="grid grid-cols-8 gap-0.5 mb-2">
        {PRESETS.map((e) => (
          <button
            key={e}
            onClick={() => { onChange(e); onClose(); }}
            aria-label={`Pick ${e}`}
            className={cn(
              "h-7 w-7 inline-flex items-center justify-center rounded text-base transition-colors duration-fast",
              "hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
              value === e ? "bg-brand-50 ring-1 ring-brand-500/30" : "",
            )}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 border-t border-line pt-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value.slice(0, 8))}
          placeholder="Paste any emoji"
          aria-label="Custom emoji"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 text-[13px] border border-line rounded-md px-2 py-1 bg-surface focus:outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 transition-colors duration-fast"
        />
        <button
          onClick={() => { if (custom) { onChange(custom); onClose(); } }}
          disabled={!custom}
          className="text-xs px-2.5 py-1 bg-fg text-bg rounded-md hover:bg-fg/85 disabled:opacity-40 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Use
        </button>
        {value && (
          <button
            onClick={() => { onChange(null); onClose(); }}
            aria-label="Remove icon"
            title="Remove icon"
            className="h-7 w-7 inline-flex items-center justify-center rounded text-fg-subtle hover:text-danger-600 hover:bg-danger-50 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  );
}
