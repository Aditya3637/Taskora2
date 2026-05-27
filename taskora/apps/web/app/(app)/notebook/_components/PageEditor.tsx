"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  evaluateCell,
  evaluateExpression,
  looksLikePureMath,
  type CellMap,
} from "../_lib/formula";
import { detectInBody, type Suggestion } from "../_lib/intent";
import {
  newBlockId,
  type Assignment,
  type Block,
  type Page,
  type Person,
  type TableBlock,
} from "../_lib/types";

/**
 * Chat-style page editor. Renders the page body as a vertical list of
 * "message bubble" blocks (text or table). New blocks append to the
 * bottom. Each text block is editable in place; tables open as
 * grid editors.
 *
 * Tables: simple grid of cells. A cell starting with '=' is evaluated
 * as a formula against the rest of the table (A1-style refs).
 *
 * Inline math: text blocks render their content through a regex that
 * (a) evaluates pure-math lines automatically and (b) replaces
 * '=expr' tokens inline.
 *
 * Intent suggestions: T0 regex picks up todo phrases + @mentions and
 * surfaces a "Suggestions (n)" pill at the top. Tapping a suggestion
 * either creates a checklist item or opens the assign confirm.
 */
export default function PageEditor({
  page,
  onSaved,
  workspacePeople,
  readOnly,
}: {
  page: Page;
  onSaved?: (next: Page) => void;
  workspacePeople: Person[];
  readOnly: boolean;
}) {
  const [title, setTitle] = useState(page.title);
  const [blocks, setBlocks] = useState<Block[]>(page.body || []);
  const [saving, setSaving] = useState(false);
  const [sentStatuses, setSentStatuses] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state ONLY when the page id changes. Re-syncing on every
  // page.body / page.title prop change would clobber in-flight edits
  // when the autosave round-trip returns and the parent updates the
  // page object — the server response often arrives mid-typing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTitle(page.title);
    setBlocks(page.body || []);
  }, [page.id]);

  // Load sender-side assignment statuses so we can render the pill on
  // the source-block line.
  useEffect(() => {
    (async () => {
      try {
        const sent = await apiFetch(
          `/api/v1/notebook/assignments/sent?source_page_id=${page.id}`,
        );
        const map: Record<string, string> = {};
        for (const a of sent as Assignment[]) {
          if (a.source_block_id) map[a.source_block_id] = a.status;
        }
        setSentStatuses(map);
      } catch {
        // non-critical
      }
    })();
  }, [page.id]);

  // T0 intent — re-run on every block change.
  const resolveMention = useCallback(
    (mention: string) => {
      const m = mention.toLowerCase();
      const hit = workspacePeople.find(
        (p) =>
          p.name.toLowerCase().startsWith(m) ||
          p.name.toLowerCase().includes(m),
      );
      return hit ? { id: hit.id, name: hit.name } : null;
    },
    [workspacePeople],
  );

  useEffect(() => {
    setSuggestions(detectInBody(blocks, resolveMention));
  }, [blocks, resolveMention]);

  const persist = useCallback(
    async (nextTitle: string, nextBlocks: Block[]) => {
      setSaving(true);
      try {
        const resp = (await apiFetch(`/api/v1/notebook/pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: nextTitle, body: nextBlocks }),
        })) as Page;
        onSaved?.(resp);
      } finally {
        setSaving(false);
      }
    },
    [page.id, onSaved],
  );

  const scheduleSave = (nextTitle: string, nextBlocks: Block[]) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(nextTitle, nextBlocks), 600);
  };

  const updateBlock = (idx: number, patch: Partial<Block>) => {
    setBlocks((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...(patch as Block) } as Block;
      scheduleSave(title, next);
      return next;
    });
  };

  const addTextBlock = () => {
    setBlocks((prev) => {
      const next: Block[] = [...prev, { id: newBlockId(), type: "text", text: "" }];
      scheduleSave(title, next);
      return next;
    });
  };

  // Insert a fresh empty text block immediately after the given index —
  // used by Cmd/Shift+Enter to "split" out of an existing block into a
  // new one without losing focus flow.
  const insertTextBlockAfter = (idx: number) => {
    setBlocks((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { id: newBlockId(), type: "text", text: "" });
      scheduleSave(title, next);
      return next;
    });
  };

  const addTable = () => {
    setBlocks((prev) => {
      const empty: TableBlock = {
        id: newBlockId(),
        type: "table",
        rows: 3,
        cols: 3,
        cells: Array(9).fill(""),
      };
      const next: Block[] = [...prev, empty];
      scheduleSave(title, next);
      return next;
    });
  };

  const deleteBlock = (idx: number) => {
    setBlocks((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      scheduleSave(title, next);
      return next;
    });
  };

  // ── Suggestion actions ────────────────────────────────────────────
  const acceptTodo = async (s: Suggestion) => {
    await apiFetch("/api/v1/notebook/checklist", {
      method: "POST",
      body: JSON.stringify({ content: s.text, source_page_id: page.id }),
    });
    setSuggestions((prev) => prev.filter((x) => x !== s));
  };

  const acceptAssign = async (s: Extract<Suggestion, { kind: "assign" }>) => {
    try {
      await apiFetch("/api/v1/notebook/assignments", {
        method: "POST",
        body: JSON.stringify({
          recipient_id: s.mentionId,
          content: s.text,
          source_page_id: page.id,
          source_block_id: s.blockId,
        }),
      });
      setSentStatuses((m) => ({ ...m, [s.blockId]: "pending" }));
      setSuggestions((prev) => prev.filter((x) => x !== s));
    } catch (err: unknown) {
      alert((err as Error)?.message ?? "Failed to assign");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Title row */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            scheduleSave(e.target.value, blocks);
          }}
          disabled={readOnly}
          className="text-lg font-bold text-midnight bg-transparent focus:outline-none flex-1 min-w-0 disabled:cursor-not-allowed"
          placeholder="Untitled"
        />
        <div className="flex items-center gap-2 text-[11px] text-steel/70">
          {readOnly && <span className="px-1.5 py-0.5 bg-pebble/60 rounded">Read-only</span>}
          {saving && <span>saving…</span>}
        </div>
      </div>

      {/* Suggestions pill */}
      {suggestions.length > 0 && (
        <div className="mb-3">
          <button
            onClick={() => setShowSuggestions((v) => !v)}
            className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-900 hover:bg-amber-200"
          >
            ✨ Suggestions ({suggestions.length})
          </button>
          {showSuggestions && (
            <div className="mt-2 space-y-1 border border-amber-200 rounded p-2 bg-amber-50">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="flex-1 text-midnight">
                    {s.kind === "assign" && (
                      <>
                        Assign to <b>@{s.mentionName}</b>: <i>{s.text}</i>
                      </>
                    )}
                    {s.kind === "todo" && <>Add to your checklist: <i>{s.text}</i></>}
                    {s.kind === "goal" && <>Promote to Goals: <i>{s.text}</i></>}
                  </span>
                  <button
                    onClick={() => {
                      if (s.kind === "assign") void acceptAssign(s);
                      else if (s.kind === "todo") void acceptTodo(s);
                      else setSuggestions((prev) => prev.filter((x) => x !== s));
                    }}
                    className="text-amber-900 hover:underline"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setSuggestions((prev) => prev.filter((x) => x !== s))}
                    className="text-steel/60 hover:text-red-500"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Block list (chat-style) */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {blocks.length === 0 && (
          <p className="text-sm text-steel/60 italic">
            Start writing — each line becomes a thought you can return to.
            Type a todo phrase with @someone to assign them a task.
          </p>
        )}
        {blocks.map((b, idx) =>
          b.type === "text" ? (
            <TextBlockView
              key={b.id}
              block={b}
              readOnly={readOnly}
              status={sentStatuses[b.id]}
              onChange={(text) => updateBlock(idx, { text })}
              onDelete={() => deleteBlock(idx)}
              onSplit={() => insertTextBlockAfter(idx)}
              workspacePeople={workspacePeople}
            />
          ) : (
            <TableBlockView
              key={b.id}
              block={b}
              readOnly={readOnly}
              onChange={(next) => updateBlock(idx, next as Partial<Block>)}
              onDelete={() => deleteBlock(idx)}
            />
          ),
        )}
      </div>

      {/* Composer */}
      {!readOnly && (
        <div className="mt-3 flex gap-2 pt-2 border-t border-pebble">
          <button
            onClick={addTextBlock}
            className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40"
          >
            + Text
          </button>
          <button
            onClick={addTable}
            className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40"
          >
            + Table
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Text block — chat bubble with inline math rendering
// ─────────────────────────────────────────────────────────────────────

function TextBlockView({
  block,
  readOnly,
  status,
  onChange,
  onDelete,
  onSplit,
  workspacePeople,
}: {
  block: { id: string; type: "text"; text: string };
  readOnly: boolean;
  status?: string;
  onChange: (text: string) => void;
  onDelete: () => void;
  onSplit: () => void;
  workspacePeople: Person[];
}) {
  // Empty blocks start in edit mode so the user can just type — they
  // shouldn't have to click first. After typing once, clicking outside
  // commits to the rendered (math-aware) view.
  const [editing, setEditing] = useState(block.text.length === 0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const rendered = useMemo(
    () => renderTextWithMath(block.text, workspacePeople),
    [block.text, workspacePeople],
  );

  // Auto-resize the textarea on every keystroke so newlines are visible.
  // Without this, the default `rows` attribute is a one-shot hint and
  // `\n` characters go into the value but the visible height stays at
  // 1 row — looks like Enter is broken.
  const fitHeight = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { if (editing) fitHeight(); }, [editing, block.text]);

  return (
    <div className="group bg-pebble/40 rounded-lg px-3 py-2 relative">
      {editing && !readOnly ? (
        <textarea
          ref={taRef}
          autoFocus
          value={block.text}
          onChange={(e) => { onChange(e.target.value); fitHeight(); }}
          onBlur={() => { if (block.text.length > 0) setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              return;
            }
            // Shift+Enter or Cmd/Ctrl+Enter — finish this block and
            // open a fresh empty block immediately below.
            if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              setEditing(false);
              onSplit();
            }
            // Plain Enter falls through → default newline insertion
            // (visible because fitHeight runs on the next onChange).
          }}
          rows={1}
          placeholder="Type here. Enter for a new line · Shift+Enter for a new block"
          className="w-full bg-transparent text-sm text-midnight resize-none focus:outline-none placeholder:text-steel/40 overflow-hidden"
        />
      ) : (
        <div
          onClick={() => !readOnly && setEditing(true)}
          className={`whitespace-pre-wrap text-sm text-midnight ${
            readOnly ? "cursor-default" : "cursor-text"
          } ${block.text ? "" : "italic text-steel/40"}`}
        >
          {block.text ? rendered : "Tap to write…"}
        </div>
      )}

      <div className="flex items-center gap-2 mt-1 text-[10px]">
        {status && (
          <span
            className={`px-1.5 py-0.5 rounded-full ${
              status === "pending" ? "bg-amber-100 text-amber-900"
              : status === "accepted" ? "bg-blue-100 text-blue-900"
              : status === "done" ? "bg-green-100 text-green-900"
              : "bg-red-100 text-red-900"
            }`}
          >
            {status[0].toUpperCase() + status.slice(1)}
          </span>
        )}
      </div>

      {!readOnly && (
        <button
          onClick={onDelete}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-steel/50 hover:text-red-500 text-xs"
          aria-label="Delete"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Render text with:
//   - pure-math lines auto-evaluated:  "5*3+2"      → "5*3+2 = 17"
//   - explicit =expr in mixed text:    "=5*3+2"     → "17"
//   - @mention rendered grey if not in workspace
function renderTextWithMath(text: string, workspacePeople: Person[]): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    if (looksLikePureMath(line)) {
      const r = evaluateExpression(line);
      return (
        <div key={li}>
          <span>{line}</span>
          <span className="text-steel/70"> = </span>
          <span className="font-semibold text-midnight">
            {r.ok ? formatNumber(r.value) : `#${r.error}!`}
          </span>
        </div>
      );
    }
    // Replace inline =expr tokens and @mentions.
    const nodes: React.ReactNode[] = [];
    let i = 0;
    // We combine two regexes by walking; cheap and avoids stray matches.
    const combined = /(=([\d.+\-*/%()\s]+?)(?=[\s,;.!?]|$))|(@[A-Za-z][A-Za-z0-9._-]{0,40})/g;
    let m: RegExpExecArray | null;
    while ((m = combined.exec(line)) !== null) {
      if (m.index > i) nodes.push(line.slice(i, m.index));
      if (m[1]) {
        // =expr
        const r = evaluateExpression(m[2]);
        nodes.push(
          <span key={`eq-${li}-${m.index}`}
                title={m[1]}
                className="font-semibold text-midnight bg-amber-50 px-1 rounded">
            {r.ok ? formatNumber(r.value) : `#${r.error}!`}
          </span>,
        );
      } else if (m[3]) {
        const handle = m[3].slice(1).toLowerCase();
        const known = workspacePeople.some(
          (p) => p.name.toLowerCase().includes(handle),
        );
        nodes.push(
          <span
            key={`m-${li}-${m.index}`}
            className={known ? "text-taskora-red font-medium" : "text-steel/60"}
            title={known ? "" : "Not in your workspace"}
          >
            {m[3]}
          </span>,
        );
      }
      i = m.index + m[0].length;
    }
    if (i < line.length) nodes.push(line.slice(i));
    return <div key={li}>{nodes.length ? nodes : " "}</div>;
  });
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4).replace(/\.?0+$/, "");
}

// ─────────────────────────────────────────────────────────────────────
// Table block — grid with cell formulas
// ─────────────────────────────────────────────────────────────────────

function TableBlockView({
  block,
  readOnly,
  onChange,
  onDelete,
}: {
  block: TableBlock;
  readOnly: boolean;
  onChange: (patch: Partial<TableBlock>) => void;
  onDelete: () => void;
}) {
  // Build a CellMap once per render so the formula engine can resolve refs.
  const cellMap = useMemo<CellMap>(() => {
    const m: CellMap = new Map();
    for (let r = 0; r < block.rows; r++) {
      for (let c = 0; c < block.cols; c++) {
        const ref = `${colLetter(c)}${r + 1}`;
        m.set(ref, block.cells[r * block.cols + c] ?? "");
      }
    }
    return m;
  }, [block]);

  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);

  const setCell = (r: number, c: number, value: string) => {
    const next = [...block.cells];
    next[r * block.cols + c] = value;
    onChange({ cells: next });
  };

  const addRow = () => {
    const newCells = [...block.cells, ...Array(block.cols).fill("")];
    onChange({ rows: block.rows + 1, cells: newCells });
  };

  const addCol = () => {
    const newCols = block.cols + 1;
    const newCells: string[] = [];
    for (let r = 0; r < block.rows; r++) {
      for (let c = 0; c < block.cols; c++) {
        newCells.push(block.cells[r * block.cols + c] ?? "");
      }
      newCells.push("");  // new column cell
    }
    onChange({ cols: newCols, cells: newCells });
  };

  const removeRow = () => {
    if (block.rows <= 1) return;
    const newCells = block.cells.slice(0, (block.rows - 1) * block.cols);
    onChange({ rows: block.rows - 1, cells: newCells });
  };

  const removeCol = () => {
    if (block.cols <= 1) return;
    const newCols = block.cols - 1;
    const newCells: string[] = [];
    for (let r = 0; r < block.rows; r++) {
      for (let c = 0; c < newCols; c++) {
        newCells.push(block.cells[r * block.cols + c] ?? "");
      }
    }
    onChange({ cols: newCols, cells: newCells });
  };

  return (
    <div className="group border border-pebble rounded-lg p-2 bg-white relative">
      <div className="overflow-x-auto">
        <table className="border-collapse w-full">
          <tbody>
            {Array.from({ length: block.rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: block.cols }).map((_, c) => {
                  const raw = block.cells[r * block.cols + c] ?? "";
                  const isFormula = raw.trim().startsWith("=");
                  const isEditing =
                    !readOnly && editing && editing.r === r && editing.c === c;
                  const displayed = (() => {
                    if (isEditing) return raw;
                    if (!isFormula) return raw;
                    try {
                      const v = evaluateCell(`${colLetter(c)}${r + 1}`, cellMap);
                      return formatNumber(v);
                    } catch (e: unknown) {
                      const code = (e as { code?: string })?.code;
                      return `#${code || "ERR"}!`;
                    }
                  })();
                  return (
                    <td
                      key={c}
                      className="border border-pebble p-0 min-w-[80px]"
                      onClick={() => !readOnly && setEditing({ r, c })}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={raw}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onBlur={() => setEditing(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full px-1.5 py-1 text-sm bg-amber-50 focus:outline-none"
                        />
                      ) : (
                        <div
                          className={`px-1.5 py-1 text-sm cursor-text ${
                            isFormula ? "text-blue-700 font-medium" : "text-midnight"
                          }`}
                          title={isFormula ? raw : undefined}
                        >
                          {displayed || " "}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex gap-2 mt-2 text-[11px]">
          <button onClick={addRow} className="text-steel hover:text-midnight">+ row</button>
          <button onClick={addCol} className="text-steel hover:text-midnight">+ col</button>
          <button onClick={removeRow} className="text-steel hover:text-red-500">− row</button>
          <button onClick={removeCol} className="text-steel hover:text-red-500">− col</button>
          <span className="text-steel/40">·</span>
          <span className="text-steel/60">
            Cells: type a number, or <code>=A1+B1</code>, <code>=SUM(A1:A5)</code>, <code>=AVG(A1:B3)</code>
          </span>
        </div>
      )}

      {!readOnly && (
        <button
          onClick={onDelete}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-steel/50 hover:text-red-500 text-xs"
          aria-label="Delete table"
        >
          ×
        </button>
      )}
    </div>
  );
}

function colLetter(c: number): string {
  let n = c + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
