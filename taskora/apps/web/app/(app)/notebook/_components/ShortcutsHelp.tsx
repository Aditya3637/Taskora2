"use client";
import { useEffect } from "react";
import { Kbd } from "@/components/ui";

/**
 * Keyboard cheat-sheet overlay. Opened with `?` from the notebook
 * (when not typing in a field). Pure reference — no state of its own
 * beyond Esc-to-close.
 */
const GROUPS: { title: string; rows: { keys: string[]; desc: string }[] }[] = [
  {
    title: "Everywhere",
    rows: [
      { keys: ["⌘", "K"], desc: "Quick-switch / create page" },
      { keys: ["?"], desc: "Show this cheat-sheet" },
      { keys: ["Esc"], desc: "Close menus / overlays" },
    ],
  },
  {
    title: "Jump between sections",
    rows: [
      { keys: ["Alt", "1"], desc: "Goals" },
      { keys: ["Alt", "2"], desc: "Checklist" },
      { keys: ["Alt", "3"], desc: "Notebook" },
      { keys: ["Alt", "0"], desc: "Back to the full spread" },
    ],
  },
  {
    title: "Goals & Checklist",
    rows: [
      { keys: ["Enter"], desc: "Add the next goal / checklist item" },
      { keys: ["Shift", "Enter"], desc: "New line within a goal" },
      { keys: ["Backspace"], desc: "Delete the empty goal, focus previous" },
      { keys: ["↑", "↓"], desc: "Move between goals" },
      { keys: ["Click"], desc: "Edit an existing checklist item" },
    ],
  },
  {
    title: "Notebook page",
    rows: [
      { keys: ["/"], desc: "Open the block menu (text, table, image…)" },
      { keys: ["#", "Space"], desc: "Heading · — list · [] todo · > quote" },
      { keys: ["⌘", "B"], desc: "Bold the selection (**text**)" },
      { keys: ["⌘", "I"], desc: "Italicise the selection (*text*)" },
      { keys: ["Enter"], desc: "New block — continues bullets, numbers & to-dos" },
      { keys: ["Shift", "Enter"], desc: "Soft line break within the block" },
      { keys: ["Backspace"], desc: "At an empty block — turn it back to text" },
      { keys: ["↑", "↓"], desc: "Move between blocks at the line edge" },
      { keys: ["Paste"], desc: "Drop an image straight onto the page" },
    ],
  },
  {
    title: "Tables",
    rows: [
      { keys: ["Tab"], desc: "Next cell · Shift+Tab previous" },
      { keys: ["Enter"], desc: "Move to the cell below" },
      { keys: ["="], desc: "Start a formula: =A1+B1, =SUM(A1:A5)" },
    ],
  },
];

export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-midnight">⌨ Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="text-steel/60 hover:text-midnight text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-steel/70 mb-2">
                {g.title}
              </h3>
              <ul className="space-y-1.5">
                {g.rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-steel">{r.desc}</span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {r.keys.map((k, j) => (
                        <Kbd key={j}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
