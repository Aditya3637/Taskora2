/**
 * blocksToProseMirror — convert a legacy flat notebook `Block[]` body into the
 * TipTap/ProseMirror JSON the shared RichDocEditor uses (Notebook convergence
 * N-2). Pure function; runs once per page on first open (migrate-on-open). The
 * original `body` is kept server-side as a backup, so this is reversible.
 *
 * Consecutive bullet/numbered/to-do blocks are grouped into a single list.
 * Inline `**bold**` / `*italic*` / `_italic_` (the notebook's markdown markers)
 * become real marks. @person and [[page]] text is preserved verbatim (those
 * features are rebuilt on the new editor in a later phase).
 */
import type { Block } from "./types";

type PMNode = { type: string; attrs?: Record<string, unknown>; content?: PMNode[]; text?: string; marks?: { type: string }[] };

const INLINE_RE = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;

/** Parse inline markdown into text nodes; undefined when empty (= empty para). */
function inline(text: string): PMNode[] | undefined {
  if (!text) return undefined;
  const nodes: PMNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) nodes.push({ type: "text", text: text.slice(last, m.index) });
    const bold = m[2];
    const italic = m[3] ?? m[4];
    if (bold != null) nodes.push({ type: "text", text: bold, marks: [{ type: "bold" }] });
    else nodes.push({ type: "text", text: italic, marks: [{ type: "italic" }] });
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes.length ? nodes : undefined;
}

function para(text: string): PMNode {
  const content = inline(text);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
}

function cell(text: string, header: boolean): PMNode {
  return { type: header ? "tableHeader" : "tableCell", content: [para(text)] };
}

function tableNode(b: Extract<Block, { type: "table" }>): PMNode {
  const rows: PMNode[] = [];
  for (let r = 0; r < b.rows; r++) {
    const cells: PMNode[] = [];
    for (let c = 0; c < b.cols; c++) {
      cells.push(cell(b.cells[r * b.cols + c] || "", r === 0));
    }
    rows.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content: rows };
}

export function blocksToProseMirror(blocks: Block[]): PMNode {
  const content: PMNode[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];

    // Group a run of same-kind list blocks into one list node.
    if (b.type === "bullet" || b.type === "numbered" || b.type === "todo") {
      const kind = b.type;
      const items: PMNode[] = [];
      while (i < blocks.length && blocks[i].type === kind) {
        const cur = blocks[i] as Extract<Block, { type: "bullet" | "numbered" | "todo" }>;
        const p = para((cur as any).text || "");
        if (kind === "todo") {
          items.push({ type: "taskItem", attrs: { checked: !!(cur as any).checked }, content: [p] });
        } else {
          items.push({ type: "listItem", content: [p] });
        }
        i++;
      }
      const listType = kind === "bullet" ? "bulletList" : kind === "numbered" ? "orderedList" : "taskList";
      content.push({ type: listType, content: items });
      continue;
    }

    switch (b.type) {
      case "heading": {
        const c = inline(b.text || "");
        content.push({ type: "heading", attrs: { level: b.level || 1 }, ...(c ? { content: c } : {}) });
        break;
      }
      case "quote":
        content.push({ type: "blockquote", content: [para(b.text || "")] });
        break;
      case "code":
        content.push({ type: "codeBlock", ...(b.text ? { content: [{ type: "text", text: b.text }] } : {}) });
        break;
      case "callout":
        content.push({ type: "callout", content: [para(b.text || "")] });
        break;
      case "divider":
        content.push({ type: "horizontalRule" });
        break;
      case "table":
        content.push(tableNode(b));
        break;
      case "image":
        content.push(
          b.src
            ? { type: "image", attrs: { src: b.src, alt: b.alt || b.caption || null, title: b.caption || null } }
            : para(""),
        );
        break;
      case "text":
      default:
        content.push(para((b as any).text || ""));
        break;
    }
    i++;
  }

  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}
