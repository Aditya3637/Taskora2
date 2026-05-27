"use client";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  evaluateCell,
  evaluateExpression,
  hasInlineMath,
  looksLikePureMath,
  type CellMap,
} from "../_lib/formula";
import { detectInBody, type Suggestion } from "../_lib/intent";
import { detectEnterShortcut, detectInlineShortcut } from "../_lib/markdown";
import {
  freshBlock,
  isTextLike,
  newBlockId,
  type Assignment,
  type Block,
  type BlockKind,
  type Page,
  type Person,
  type TableBlock,
  type TextLikeBlock,
} from "../_lib/types";
import SlashMenu from "./SlashMenu";

/**
 * Document-style page editor.
 *
 * Highlights:
 *   - 11 block kinds: text, headings (H1/H2/H3), bulleted/numbered list,
 *     todo, quote, code, callout, divider, table.
 *   - Slash command menu — type `/` at the start of an empty text block.
 *   - Markdown shortcuts — `# `, `## `, `### `, `- `, `1. `, `[] `, `> `
 *     transform the current block; `---` + Enter inserts a divider;
 *     ``` + Enter starts a code block.
 *   - Tables with cell formulas (=A1+B1, SUM, AVG), arithmetic + percent.
 *     Tab / Shift+Tab / arrow keys / Enter navigate cells.
 *   - Drag-to-reorder blocks (HTML5 DnD).
 *   - Inline math: pure-math lines auto-evaluate; `=expr` opts in within
 *     mixed text. @workspace-mentions render coloured; non-workspace
 *     mentions render grey (text-only, no inbox flow).
 *   - Intent T0 suggestions in a non-modal corner pill.
 *
 * Conventions:
 *   - Plain Enter inside a text-like block: newline within the same
 *     block.
 *   - Shift+Enter or Cmd/Ctrl+Enter: commit the current block and open
 *     a fresh empty text block immediately below.
 *   - Backspace at the start of an empty non-text block converts it
 *     back to a text block (Notion convention).
 *   - Esc anywhere closes the slash menu / blurs the active block.
 */
export default function PageEditor({
  page,
  onSaved,
  workspacePeople,
  readOnly,
  allPages,
  onOpenPage,
}: {
  page: Page;
  onSaved?: (next: Page) => void;
  workspacePeople: Person[];
  readOnly: boolean;
  /** Caller's notebook (owned + shared). Used to resolve [[page links]]
   *  and compute the backlinks panel at the bottom of the editor. */
  allPages: Page[];
  /** Navigate to a page by id (used by [[link]] click + backlinks). */
  onOpenPage: (pageId: string) => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [blocks, setBlocks] = useState<Block[]>(page.body || []);
  const [saving, setSaving] = useState(false);
  const [sentStatuses, setSentStatuses] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);

  // Slash menu state — anchored to a block id; query is the text after `/`.
  const [slash, setSlash] = useState<{ blockId: string; query: string } | null>(null);

  // Drag-and-drop reorder state.
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state ONLY when the page id changes (see prior note in v1 about
  // the autosave round-trip clobbering local edits otherwise).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTitle(page.title);
    setBlocks(page.body || []);
    setSlash(null);
    setFocusedBlockId(null);
  }, [page.id]);

  // Load sender-side assignment statuses so we can show the pill on a
  // block that spawned an assignment.
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
      } catch { /* non-critical */ }
    })();
  }, [page.id]);

  // Title → id index, used by the [[link]] renderer + backlinks panel.
  const pageByTitle = useMemo(() => {
    const m = new Map<string, Page>();
    for (const p of allPages) m.set(p.title.toLowerCase(), p);
    return m;
  }, [allPages]);

  // Compute backlinks: every other page whose body contains [[this title]].
  const backlinks = useMemo(() => {
    const needle = `[[${page.title.toLowerCase()}]]`;
    const hits: Page[] = [];
    for (const p of allPages) {
      if (p.id === page.id) continue;
      const bodyText = JSON.stringify(p.body || []).toLowerCase();
      if (bodyText.includes(needle)) hits.push(p);
    }
    return hits;
  }, [allPages, page.id, page.title]);

  // T0 intent suggestions.
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
    // detectInBody only looks at .text on text-like blocks; we expose
    // text/heading/list/todo/quote/callout to it as if they were `text`.
    const scanShape = blocks
      .filter((b) => isTextLike(b))
      .map((b) => ({ id: b.id, type: "text", text: (b as TextLikeBlock).text }));
    setSuggestions(detectInBody(scanShape, resolveMention));
  }, [blocks, resolveMention]);

  // ─── Persistence ─────────────────────────────────────────────────
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

  const scheduleSave = useCallback(
    (nextTitle: string, nextBlocks: Block[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persist(nextTitle, nextBlocks), 600);
    },
    [persist],
  );

  // ─── Block ops ───────────────────────────────────────────────────
  const updateBlock = useCallback(
    (idx: number, patch: Partial<Block>) => {
      setBlocks((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], ...(patch as Block) } as Block;
        scheduleSave(title, next);
        return next;
      });
    },
    [scheduleSave, title],
  );

  /** Swap one block for another kind, preserving id + text where reasonable. */
  const transformBlock = useCallback(
    (idx: number, kind: BlockKind, level?: 1 | 2 | 3) => {
      setBlocks((prev) => {
        const next = [...prev];
        const cur = next[idx];
        const sharedText = isTextLike(cur) ? cur.text : "";
        const id = cur.id;
        let replacement: Block;
        switch (kind) {
          case "heading":
            replacement = { id, type: "heading", level: level ?? 1, text: sharedText };
            break;
          case "bullet":
            replacement = { id, type: "bullet", text: sharedText }; break;
          case "numbered":
            replacement = { id, type: "numbered", text: sharedText }; break;
          case "todo":
            replacement = { id, type: "todo", text: sharedText, checked: false }; break;
          case "quote":
            replacement = { id, type: "quote", text: sharedText }; break;
          case "code":
            replacement = { id, type: "code", text: sharedText, language: "" }; break;
          case "callout":
            replacement = { id, type: "callout", text: sharedText, emoji: "💡" }; break;
          case "divider":
            replacement = { id, type: "divider" }; break;
          case "table":
            replacement = freshBlock("table"); break;
          case "text":
          default:
            replacement = { id, type: "text", text: sharedText }; break;
        }
        next[idx] = replacement;
        scheduleSave(title, next);
        return next;
      });
    },
    [scheduleSave, title],
  );

  const insertAfter = useCallback(
    (idx: number, kind: BlockKind = "text") => {
      const fresh = freshBlock(kind);
      setBlocks((prev) => {
        const next = [...prev];
        next.splice(idx + 1, 0, fresh);
        scheduleSave(title, next);
        return next;
      });
      setFocusedBlockId(fresh.id);
    },
    [scheduleSave, title],
  );

  const appendBlock = useCallback(
    (kind: BlockKind = "text") => {
      const fresh = freshBlock(kind);
      setBlocks((prev) => {
        const next = [...prev, fresh];
        scheduleSave(title, next);
        return next;
      });
      setFocusedBlockId(fresh.id);
    },
    [scheduleSave, title],
  );

  const deleteBlock = useCallback(
    (idx: number) => {
      setBlocks((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        scheduleSave(title, next);
        return next;
      });
    },
    [scheduleSave, title],
  );

  const duplicateBlock = useCallback(
    (idx: number) => {
      setBlocks((prev) => {
        const copy: Block = { ...(prev[idx] as Block), id: newBlockId() };
        const next = [...prev];
        next.splice(idx + 1, 0, copy);
        scheduleSave(title, next);
        return next;
      });
    },
    [scheduleSave, title],
  );

  const moveBlock = useCallback(
    (fromId: string, toIndex: number) => {
      setBlocks((prev) => {
        const fromIdx = prev.findIndex((b) => b.id === fromId);
        if (fromIdx < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        const insertAt = fromIdx < toIndex ? toIndex - 1 : toIndex;
        next.splice(insertAt, 0, moved);
        scheduleSave(title, next);
        return next;
      });
    },
    [scheduleSave, title],
  );

  // ─── Suggestion actions ──────────────────────────────────────────
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

  // ─── Title ──────────────────────────────────────────────────────
  const onTitleChange = (v: string) => {
    setTitle(v);
    scheduleSave(v, blocks);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Title row */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-shrink-0">
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (blocks.length === 0) appendBlock("text");
              else setFocusedBlockId(blocks[0].id);
            }
          }}
          disabled={readOnly}
          className="text-2xl font-bold text-midnight bg-transparent focus:outline-none flex-1 min-w-0 disabled:cursor-not-allowed placeholder:text-steel/40"
          placeholder="Untitled"
        />
        <div className="flex items-center gap-2 text-[11px] text-steel/70">
          {readOnly && <span className="px-1.5 py-0.5 bg-pebble/60 rounded">Read-only</span>}
          {saving && <span>saving…</span>}
        </div>
      </div>

      {/* Suggestions pill */}
      {suggestions.length > 0 && (
        <div className="mb-3 flex-shrink-0">
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
                      <>Assign to <b>@{s.mentionName}</b>: <i>{s.text}</i></>
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

      {/* Block list */}
      <div className="flex-1 overflow-y-auto pr-1">
        {blocks.length === 0 && (
          <EmptyComposerHint onAdd={() => appendBlock("text")} />
        )}
        {blocks.map((b, idx) => (
          <Fragment key={b.id}>
            {dropGap === idx && draggedId && (
              <div className="h-0.5 bg-taskora-red rounded my-0.5" />
            )}
            <BlockRow
              block={b}
              idx={idx}
              total={blocks.length}
              readOnly={readOnly}
              focused={focusedBlockId === b.id}
              sentStatus={sentStatuses[b.id]}
              workspacePeople={workspacePeople}
              pageByTitle={pageByTitle}
              onOpenPage={onOpenPage}
              slashOpen={slash?.blockId === b.id}
              slashQuery={slash?.blockId === b.id ? slash.query : ""}
              onOpenSlash={(query) => setSlash({ blockId: b.id, query })}
              onCloseSlash={() => setSlash(null)}
              onSlashPick={(payload) => {
                transformBlock(idx, payload.kind, payload.level);
                setSlash(null);
                setFocusedBlockId(b.id);
              }}
              onChange={(patch) => updateBlock(idx, patch)}
              onTransform={(kind, level) => transformBlock(idx, kind, level)}
              onSplit={() => insertAfter(idx, "text")}
              onDelete={() => deleteBlock(idx)}
              onDuplicate={() => duplicateBlock(idx)}
              onConvertToText={() => transformBlock(idx, "text")}
              onFocusPrev={() => {
                if (idx > 0) setFocusedBlockId(blocks[idx - 1].id);
              }}
              onFocusNext={() => {
                if (idx < blocks.length - 1) setFocusedBlockId(blocks[idx + 1].id);
              }}
              draggable={!readOnly}
              dragged={draggedId === b.id}
              onDragStart={() => setDraggedId(b.id)}
              onDragEnd={() => { setDraggedId(null); setDropGap(null); }}
              onDragOverGap={(gap) => setDropGap(gap)}
              onDrop={(toIndex) => { if (draggedId) moveBlock(draggedId, toIndex); setDraggedId(null); setDropGap(null); }}
            />
          </Fragment>
        ))}
        {dropGap === blocks.length && draggedId && (
          <div className="h-0.5 bg-taskora-red rounded my-0.5" />
        )}
        {/* Trailing drop zone */}
        {!readOnly && (
          <div
            onDragOver={(e) => { e.preventDefault(); if (draggedId) setDropGap(blocks.length); }}
            onDrop={(e) => { e.preventDefault(); if (draggedId) { moveBlock(draggedId, blocks.length); setDraggedId(null); setDropGap(null); } }}
            className="h-8"
          />
        )}

        {/* Backlinks — pages that mention [[this page's title]]. */}
        {backlinks.length > 0 && (
          <div className="mt-4 pt-3 border-t border-pebble">
            <div className="text-xs font-bold tracking-wide text-steel uppercase mb-1.5">
              Linked from ({backlinks.length})
            </div>
            <ul className="space-y-1">
              {backlinks.map((bl) => (
                <li key={bl.id}>
                  <button
                    onClick={() => onOpenPage(bl.id)}
                    className="text-sm text-taskora-red hover:text-midnight underline underline-offset-2"
                  >
                    {bl.title || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer composer */}
      {!readOnly && (
        <div className="mt-3 flex gap-2 pt-2 border-t border-pebble flex-shrink-0">
          <button onClick={() => appendBlock("text")} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40">+ Text</button>
          <button onClick={() => appendBlock("heading")} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40">+ Heading</button>
          <button onClick={() => appendBlock("bullet")} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40">+ List</button>
          <button onClick={() => appendBlock("todo")} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40">+ Todo</button>
          <button onClick={() => appendBlock("table")} className="text-xs px-3 py-1.5 border border-pebble rounded text-steel hover:text-midnight hover:bg-pebble/40">+ Table</button>
          <span className="ml-auto text-[11px] text-steel/50 self-center">
            Type <code className="bg-pebble/60 px-1 rounded">/</code> on any empty line for more block types
          </span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BlockRow — common chrome: drag handle, gap drop zone, block menu
// ─────────────────────────────────────────────────────────────────────

interface BlockRowProps {
  block: Block;
  idx: number;
  total: number;
  readOnly: boolean;
  focused: boolean;
  sentStatus?: string;
  workspacePeople: Person[];
  pageByTitle: Map<string, Page>;
  onOpenPage: (pageId: string) => void;
  slashOpen: boolean;
  slashQuery: string;
  onOpenSlash: (query: string) => void;
  onCloseSlash: () => void;
  onSlashPick: (payload: { kind: BlockKind; level?: 1 | 2 | 3 }) => void;
  onChange: (patch: Partial<Block>) => void;
  onTransform: (kind: BlockKind, level?: 1 | 2 | 3) => void;
  onSplit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onConvertToText: () => void;
  onFocusPrev: () => void;
  onFocusNext: () => void;
  draggable: boolean;
  dragged: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverGap: (gap: number) => void;
  onDrop: (toIndex: number) => void;
}

function BlockRow(p: BlockRowProps) {
  return (
    <div
      className={`group relative flex items-start gap-1 py-0.5 ${
        p.dragged ? "opacity-40" : ""
      }`}
      onDragOver={(e) => {
        if (!p.draggable) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        p.onDragOverGap(before ? p.idx : p.idx + 1);
      }}
      onDrop={(e) => {
        if (!p.draggable) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        p.onDrop(before ? p.idx : p.idx + 1);
      }}
    >
      {/* Left chrome: drag handle + add-after */}
      {!p.readOnly && (
        <div className="flex items-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <div
            draggable={p.draggable}
            onDragStart={(e) => {
              p.onDragStart();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", p.block.id);
            }}
            onDragEnd={p.onDragEnd}
            className="w-5 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-steel/50 hover:text-midnight"
            title="Drag to reorder"
          >
            ⋮⋮
          </div>
        </div>
      )}

      {/* The block itself */}
      <div className="flex-1 min-w-0 relative">
        <BlockBody {...p} />
        {p.slashOpen && (
          <div className="absolute left-0 top-7">
            <SlashMenu
              query={p.slashQuery}
              onPick={p.onSlashPick}
              onClose={p.onCloseSlash}
            />
          </div>
        )}
      </div>

      {/* Right chrome: block menu */}
      {!p.readOnly && (
        <BlockMenu
          onConvertToText={p.onConvertToText}
          onDuplicate={p.onDuplicate}
          onDelete={p.onDelete}
        />
      )}
    </div>
  );
}

function BlockMenu({
  onConvertToText,
  onDuplicate,
  onDelete,
}: {
  onConvertToText: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-shrink-0 opacity-0 group-hover:opacity-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 inline-flex items-center justify-center text-steel/50 hover:text-midnight rounded hover:bg-pebble/40"
        title="Block options"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-20 bg-white border border-pebble rounded shadow-lg py-1 min-w-[160px] text-sm">
            <button
              onClick={() => { onConvertToText(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-pebble/40"
            >
              Convert to text
            </button>
            <button
              onClick={() => { onDuplicate(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-pebble/40"
            >
              Duplicate
            </button>
            <button
              onClick={() => { onDelete(); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BlockBody — dispatches on type
// ─────────────────────────────────────────────────────────────────────

function BlockBody(p: BlockRowProps) {
  const b = p.block;
  if (b.type === "divider") return <DividerBody />;
  if (b.type === "table")
    return (
      <TableBody
        block={b}
        readOnly={p.readOnly}
        onChange={(patch) => p.onChange(patch as Partial<Block>)}
      />
    );
  return <EditableBlockBody {...p} block={b as TextLikeBlock} />;
}

function DividerBody() {
  return <hr className="my-3 border-t border-pebble" />;
}

// ─────────────────────────────────────────────────────────────────────
// Editable text-like block (text, heading, bullet, numbered, todo,
// quote, code, callout)
// ─────────────────────────────────────────────────────────────────────

function EditableBlockBody({
  block,
  focused,
  readOnly,
  sentStatus,
  workspacePeople,
  pageByTitle,
  onOpenPage,
  slashOpen,
  onOpenSlash,
  onCloseSlash,
  onChange,
  onTransform,
  onSplit,
  onConvertToText,
  onFocusPrev,
  onFocusNext,
}: BlockRowProps & { block: TextLikeBlock }) {
  const [editing, setEditing] = useState(block.text.length === 0 || focused);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Open in edit mode when the parent says we're focused (e.g. after a
  // slash transform or onSplit). After typing once and blurring, switch
  // to rendered view so inline math + @mentions resolve.
  useEffect(() => {
    if (focused) setEditing(true);
  }, [focused]);

  const fitHeight = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => { if (editing) fitHeight(); }, [editing, block.text]);

  const isCheckable = block.type === "todo";
  const checked = block.type === "todo" ? block.checked : false;

  return (
    <div className="flex items-start gap-2">
      {/* Per-type left affix */}
      <LeftAffix block={block} checked={checked} onToggle={() => isCheckable && onChange({ checked: !checked } as Partial<Block>)} />

      <div className="flex-1 min-w-0">
        {editing && !readOnly ? (
          <textarea
            ref={taRef}
            autoFocus
            value={block.text}
            placeholder={editorPlaceholder(block)}
            onChange={(e) => {
              const v = e.target.value;
              // Markdown shortcut: only when block is currently text + the
              // entire content matches the trigger (so we don't fire mid-edit).
              if (block.type === "text") {
                const hit = detectInlineShortcut(v);
                if (hit) {
                  onTransform(hit.kind, hit.level);
                  // Clear the textarea after transform — the new block
                  // starts empty.
                  return;
                }
              }
              // Slash command activation: only when the block is text and
              // the value starts with `/` (and isn't a markdown trigger).
              if (block.type === "text" && v.startsWith("/")) {
                onOpenSlash(v.slice(1));
              } else if (slashOpen) {
                onCloseSlash();
              }
              onChange({ text: v } as Partial<Block>);
              fitHeight();
            }}
            onBlur={() => {
              if (block.text.length > 0) setEditing(false);
              onCloseSlash();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                onCloseSlash();
                return;
              }
              // Backspace at start of an empty non-text block → revert to text.
              if (e.key === "Backspace" && block.text === "" && block.type !== "text") {
                e.preventDefault();
                onConvertToText();
                return;
              }
              // Enter + modifier → split into new text block.
              if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setEditing(false);
                onSplit();
                return;
              }
              // Enter on `---` or ``` → enter-shortcut to divider/code.
              if (e.key === "Enter" && block.type === "text") {
                const hit = detectEnterShortcut(block.text);
                if (hit) {
                  e.preventDefault();
                  onTransform(hit.kind, hit.level);
                  return;
                }
              }
              // ArrowUp at line 0 → focus previous block.
              // ArrowDown at last line → focus next block.
              const el = e.currentTarget;
              if (e.key === "ArrowUp" && el.selectionStart === 0) {
                e.preventDefault();
                onFocusPrev();
              } else if (e.key === "ArrowDown" && el.selectionStart === block.text.length) {
                e.preventDefault();
                onFocusNext();
              }
              // Plain Enter falls through → newline within the same block
              // (the textarea auto-resizes on the next onChange).
            }}
            rows={1}
            className={`w-full bg-transparent resize-none focus:outline-none overflow-hidden placeholder:text-steel/40 ${textareaClass(block)}`}
          />
        ) : null}

        {/* Live math preview — shown only while editing, only when the
            block actually contains evaluatable math. Lets the user see
            their result immediately instead of having to blur first. */}
        {editing && !readOnly && hasInlineMath(block.text) && (
          <div className="mt-1 px-2 py-1 text-xs text-steel/80 bg-amber-50/60 border border-amber-200/60 rounded">
            <span className="text-[10px] uppercase tracking-wide text-steel/60 mr-2">Preview</span>
            {renderTextWithMath(block.text, workspacePeople, pageByTitle, onOpenPage)}
          </div>
        )}

        {!editing && (
          <div
            onClick={() => !readOnly && setEditing(true)}
            className={`whitespace-pre-wrap cursor-text ${textareaClass(block)} ${
              block.text ? "" : "italic text-steel/40"
            } ${block.type === "todo" && checked ? "line-through text-steel/60" : ""}`}
          >
            {block.text
              ? renderTextWithMath(block.text, workspacePeople, pageByTitle, onOpenPage)
              : editorPlaceholder(block)}
          </div>
        )}

        {sentStatus && (
          <div className="mt-1">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                sentStatus === "pending" ? "bg-amber-100 text-amber-900"
                : sentStatus === "accepted" ? "bg-blue-100 text-blue-900"
                : sentStatus === "done" ? "bg-green-100 text-green-900"
                : "bg-red-100 text-red-900"
              }`}
            >
              {sentStatus[0].toUpperCase() + sentStatus.slice(1)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function LeftAffix({
  block,
  checked,
  onToggle,
}: {
  block: TextLikeBlock;
  checked: boolean;
  onToggle: () => void;
}) {
  if (block.type === "bullet")
    return <span className="text-midnight pt-1 select-none w-4 text-center">•</span>;
  if (block.type === "numbered")
    // Cheap numbering: caller doesn't know its position; just show a glyph.
    // Could be wired to actual index later via a numbered-group util.
    return <span className="text-midnight pt-1 select-none w-4 text-center">1.</span>;
  if (block.type === "todo")
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1.5 accent-taskora-red flex-shrink-0"
      />
    );
  if (block.type === "quote")
    return <span className="w-1 self-stretch bg-pebble rounded flex-shrink-0" />;
  if (block.type === "callout")
    return <span className="pt-1 text-lg select-none">{block.emoji || "💡"}</span>;
  return null;
}

function textareaClass(block: TextLikeBlock): string {
  switch (block.type) {
    case "heading":
      return block.level === 1
        ? "text-2xl font-bold text-midnight"
        : block.level === 2
        ? "text-xl font-bold text-midnight"
        : "text-lg font-bold text-midnight";
    case "quote":
      return "text-sm text-steel italic";
    case "code":
      return "text-xs font-mono text-midnight bg-pebble/40 rounded p-2";
    case "callout":
      return "text-sm text-midnight bg-amber-50 rounded p-2";
    case "todo":
    case "bullet":
    case "numbered":
    case "text":
    default:
      return "text-sm text-midnight";
  }
}

function editorPlaceholder(block: TextLikeBlock): string {
  switch (block.type) {
    case "heading": return `Heading ${block.level}`;
    case "bullet":  return "List item";
    case "numbered":return "List item";
    case "todo":    return "Todo";
    case "quote":   return "Quote";
    case "code":    return "Code…";
    case "callout": return "Callout";
    case "text":
    default:        return "Type '/' for commands · # for heading · - for list";
  }
}

function EmptyComposerHint({ onAdd }: { onAdd: () => void }) {
  return (
    <button
      onClick={onAdd}
      className="w-full text-left text-sm text-steel/50 italic py-2 hover:text-midnight transition-colors"
    >
      Click to start writing — or type / for block options.
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Text rendering — inline math + @mentions
// ─────────────────────────────────────────────────────────────────────

function renderTextWithMath(
  text: string,
  workspacePeople: Person[],
  pageByTitle: Map<string, Page>,
  onOpenPage: (pageId: string) => void,
): React.ReactNode {
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
    const nodes: React.ReactNode[] = [];
    let i = 0;
    // Three regex alternatives:
    //   1. =math expression
    //   2. @mention
    //   3. [[page link]]
    const combined = /(=([\d.+\-*/%()\s]+?)(?=[\s,;.!?]|$))|(@[A-Za-z][A-Za-z0-9._-]{0,40})|(\[\[([^\]]{1,200})\]\])/g;
    let m: RegExpExecArray | null;
    while ((m = combined.exec(line)) !== null) {
      if (m.index > i) nodes.push(line.slice(i, m.index));
      if (m[1]) {
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
      } else if (m[4]) {
        const target = pageByTitle.get((m[5] || "").trim().toLowerCase());
        if (target) {
          nodes.push(
            <button
              key={`pl-${li}-${m.index}`}
              onClick={(ev) => { ev.stopPropagation(); onOpenPage(target.id); }}
              className="text-taskora-red font-medium underline underline-offset-2 hover:text-midnight"
              title={`Open: ${target.title}`}
            >
              {m[5]}
            </button>,
          );
        } else {
          nodes.push(
            <span
              key={`pl-${li}-${m.index}`}
              className="text-steel/60 italic"
              title="No page with this title"
            >
              [[{m[5]}]]
            </span>,
          );
        }
      }
      i = m.index + m[0].length;
    }
    if (i < line.length) nodes.push(line.slice(i));
    return <div key={li}>{nodes.length ? nodes : " "}</div>;
  });
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(4).replace(/\.?0+$/, "");
}

// ─────────────────────────────────────────────────────────────────────
// Table — sticky header row, Tab/Shift+Tab/arrow nav, cell formulas
// ─────────────────────────────────────────────────────────────────────

function TableBody({
  block,
  readOnly,
  onChange,
}: {
  block: TableBlock;
  readOnly: boolean;
  onChange: (patch: Partial<TableBlock>) => void;
}) {
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
  const cellRefs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const setCell = (r: number, c: number, value: string) => {
    const next = [...block.cells];
    next[r * block.cols + c] = value;
    onChange({ cells: next });
  };

  const addRow = () => onChange({
    rows: block.rows + 1,
    cells: [...block.cells, ...Array(block.cols).fill("")],
  });

  const addCol = () => {
    const newCells: string[] = [];
    for (let r = 0; r < block.rows; r++) {
      for (let c = 0; c < block.cols; c++) newCells.push(block.cells[r * block.cols + c] ?? "");
      newCells.push("");
    }
    onChange({ cols: block.cols + 1, cells: newCells });
  };

  const removeRow = (rowIdx: number) => {
    if (block.rows <= 1) return;
    const next: string[] = [];
    for (let r = 0; r < block.rows; r++) {
      if (r === rowIdx) continue;
      for (let c = 0; c < block.cols; c++) next.push(block.cells[r * block.cols + c] ?? "");
    }
    onChange({ rows: block.rows - 1, cells: next });
  };

  const removeCol = (colIdx: number) => {
    if (block.cols <= 1) return;
    const next: string[] = [];
    for (let r = 0; r < block.rows; r++) {
      for (let c = 0; c < block.cols; c++) {
        if (c === colIdx) continue;
        next.push(block.cells[r * block.cols + c] ?? "");
      }
    }
    onChange({ cols: block.cols - 1, cells: next });
  };

  const navigate = (r: number, c: number, dir: "right" | "left" | "down" | "up") => {
    let nr = r, nc = c;
    if (dir === "right") {
      nc = c + 1;
      if (nc >= block.cols) { nc = 0; nr = r + 1; }
    } else if (dir === "left") {
      nc = c - 1;
      if (nc < 0) { nc = block.cols - 1; nr = r - 1; }
    } else if (dir === "down") {
      nr = r + 1;
    } else if (dir === "up") {
      nr = r - 1;
    }
    if (nr < 0 || nr >= block.rows) return;
    setEditing({ r: nr, c: nc });
  };

  return (
    <div className="my-2 not-prose">
      <div className="overflow-x-auto rounded-lg border border-pebble">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {Array.from({ length: block.cols }).map((_, c) => (
                <th
                  key={c}
                  className="bg-pebble/50 border-b border-r border-pebble text-left text-xs font-semibold text-steel px-2 py-1 relative group/col"
                >
                  <div className="flex items-center justify-between">
                    <span>{colLetter(c)}</span>
                    {!readOnly && (
                      <button
                        onClick={() => removeCol(c)}
                        className="opacity-0 group-hover/col:opacity-100 text-steel/60 hover:text-red-500 text-[10px]"
                        title="Remove column"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: block.rows }).map((_, r) => (
              <tr key={r} className="group/row hover:bg-pebble/20">
                {Array.from({ length: block.cols }).map((_, c) => {
                  const idx = r * block.cols + c;
                  const raw = block.cells[idx] ?? "";
                  const isFormula = raw.trim().startsWith("=");
                  const isEditing =
                    !readOnly && editing && editing.r === r && editing.c === c;

                  let displayed: string = raw;
                  if (!isEditing && isFormula) {
                    try {
                      displayed = formatNumber(evaluateCell(`${colLetter(c)}${r + 1}`, cellMap));
                    } catch (e: unknown) {
                      const code = (e as { code?: string })?.code;
                      displayed = `#${code || "ERR"}!`;
                    }
                  }

                  return (
                    <td
                      key={c}
                      className={`border-b border-r border-pebble p-0 min-w-[100px] align-top ${
                        r === 0 ? "font-semibold" : ""
                      }`}
                      onClick={() => !readOnly && setEditing({ r, c })}
                    >
                      {isEditing ? (
                        <textarea
                          ref={(el) => { cellRefs.current[idx] = el; }}
                          autoFocus
                          value={raw}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onBlur={() => setEditing(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") { setEditing(null); return; }
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              navigate(r, c, "down");
                              return;
                            }
                            if (e.key === "Tab") {
                              e.preventDefault();
                              navigate(r, c, e.shiftKey ? "left" : "right");
                              return;
                            }
                            // Plain ArrowUp/Down only navigates when at
                            // the textarea edge — otherwise let the user
                            // move the caret within a multi-line cell.
                            const el = e.currentTarget;
                            if (e.key === "ArrowUp" && el.selectionStart === 0) {
                              e.preventDefault();
                              navigate(r, c, "up");
                            } else if (e.key === "ArrowDown" && el.selectionStart === raw.length) {
                              e.preventDefault();
                              navigate(r, c, "down");
                            }
                          }}
                          rows={1}
                          className="w-full px-2 py-1 bg-amber-50/60 resize-none focus:outline-none text-sm"
                        />
                      ) : (
                        <div
                          className={`px-2 py-1 cursor-text whitespace-pre-wrap ${
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
                {!readOnly && (
                  <td className="border-b border-pebble w-6 align-top">
                    <button
                      onClick={() => removeRow(r)}
                      className="opacity-0 group-hover/row:opacity-100 text-steel/60 hover:text-red-500 text-[10px] px-1 mt-1"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 mt-1.5 text-[11px]">
          <button onClick={addRow} className="text-steel hover:text-midnight">+ row</button>
          <button onClick={addCol} className="text-steel hover:text-midnight">+ column</button>
          <span className="ml-auto text-steel/60">
            Tab / Shift+Tab to move cells · Enter to next row ·{" "}
            <code className="bg-pebble/60 px-1 rounded">=A1+B1</code>,{" "}
            <code className="bg-pebble/60 px-1 rounded">=SUM(A1:A5)</code>,{" "}
            <code className="bg-pebble/60 px-1 rounded">=AVG(A1:A5)</code>
          </span>
        </div>
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
