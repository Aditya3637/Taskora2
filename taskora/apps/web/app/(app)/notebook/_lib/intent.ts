/**
 * T0 intent detection — pure regex, runs on every block on save.
 *
 * Output is a list of *suggestions*; the FE renders them as a
 * non-modal "AI suggestions (n)" pill in the corner. User explicitly
 * accepts each one. No auto-apply.
 *
 * Three suggestion kinds for v1:
 *   - todo:        "Add to your checklist?" (verb + person/object)
 *   - assign:      "Assign to @X?" (verb + @mention of workspace member)
 *   - goal:        "Promote to Goals?" (goal-shaped sentence)
 */

export type Suggestion =
  | { kind: "todo"; text: string; blockId: string }
  | { kind: "assign"; text: string; blockId: string; mentionId: string; mentionName: string }
  | { kind: "goal"; text: string; blockId: string };

const TODO_HINTS = [
  /\bneed to\b/i,
  /\bshould\b/i,
  /\bmust\b/i,
  /\btodo\b/i,
  /\bremember to\b/i,
  /\bdon[''’]t forget\b/i,
  /\b(by|before|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(st|nd|rd|th)?)/i,
  /^\s*[-*]\s*\[\s*\]/m, // checkbox markdown
];

const GOAL_HINTS = [
  /^\s*(i\s+want\s+to|my\s+goal\s+is\s+to|i\s+will|plan\s+to\s+(ship|launch|finish))\b/i,
  /\bby\s+q[1-4]\b/i,
  /\bby\s+end\s+of\s+(year|quarter|month)\b/i,
];

/**
 * Parse @mentions from a block of text. Returns the list of mention
 * tokens (the substring between '@' and the next whitespace/punct).
 * The caller resolves these against the people-picker.
 */
export function extractMentions(text: string): string[] {
  const out: string[] = [];
  // ASCII-safe pattern (matches `@Aditya`, `@aditya_singh`, etc.). Non-ASCII
  // names won't get an inbox flow but still render as grey-pill text.
  const re = /@([A-Za-z][A-Za-z0-9._-]{0,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/**
 * Scan a single block for suggestions.
 * `resolveMention` is a function the caller supplies — given a mention
 * token like "Aditya" return the matching workspace user id+name (or
 * null for external/no-match).
 */
export function detectInBlock(
  blockId: string,
  text: string,
  resolveMention: (mention: string) => { id: string; name: string } | null,
): Suggestion[] {
  const t = text.trim();
  if (!t) return [];
  const out: Suggestion[] = [];

  const todoLike = TODO_HINTS.some((r) => r.test(t));
  const goalLike = GOAL_HINTS.some((r) => r.test(t));
  const mentions = extractMentions(t);

  // Assign wins over todo when there's a workspace mention.
  if (todoLike && mentions.length > 0) {
    for (const m of mentions) {
      const resolved = resolveMention(m);
      if (resolved) {
        out.push({
          kind: "assign",
          text: t,
          blockId,
          mentionId: resolved.id,
          mentionName: resolved.name,
        });
      }
    }
    // If at least one resolved, skip plain-todo suggestion (we already
    // offered the better path).
    if (out.length > 0) return out;
  }

  if (todoLike) {
    out.push({ kind: "todo", text: t, blockId });
  }
  if (goalLike) {
    out.push({ kind: "goal", text: t, blockId });
  }
  return out;
}

/**
 * Run T0 across the full page body. Returns at most `cap` suggestions
 * (default 10) so the suggestion pill doesn't explode on long pages.
 */
export function detectInBody(
  body: { id: string; type: string; text?: string }[],
  resolveMention: (mention: string) => { id: string; name: string } | null,
  cap = 10,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const b of body) {
    if (b.type !== "text" || !b.text) continue;
    for (const s of detectInBlock(b.id, b.text, resolveMention)) {
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}
