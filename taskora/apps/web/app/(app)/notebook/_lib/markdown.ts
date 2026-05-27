/**
 * Markdown shortcut detection — runs on every onChange of a text block.
 * When the input matches a known shortcut, the parent transforms the
 * block's kind (and clears the shortcut text).
 *
 * Patterns supported:
 *   "# "    → heading 1
 *   "## "   → heading 2
 *   "### "  → heading 3
 *   "- "    → bullet
 *   "* "    → bullet
 *   "1. "   → numbered (any leading digit run)
 *   "[] "   → todo (also "[ ] ")
 *   "> "    → quote
 * Enter-triggered (called via detectEnterShortcut):
 *   "---"   → divider
 *   "```"   → code
 */

import type { BlockKind } from "./types";

export interface ShortcutHit {
  kind: BlockKind;
  level?: 1 | 2 | 3;
}

export function detectInlineShortcut(text: string): ShortcutHit | null {
  if (text === "# ") return { kind: "heading", level: 1 };
  if (text === "## ") return { kind: "heading", level: 2 };
  if (text === "### ") return { kind: "heading", level: 3 };
  if (text === "- " || text === "* ") return { kind: "bullet" };
  if (/^\d+\. $/.test(text)) return { kind: "numbered" };
  if (text === "[] " || text === "[ ] ") return { kind: "todo" };
  if (text === "> ") return { kind: "quote" };
  return null;
}

/**
 * Called when the user hits Enter — these patterns convert based on
 * the line content, not a trailing space.
 */
export function detectEnterShortcut(text: string): ShortcutHit | null {
  const t = text.trim();
  if (t === "---" || t === "***" || t === "___") return { kind: "divider" };
  if (t === "```") return { kind: "code" };
  return null;
}
