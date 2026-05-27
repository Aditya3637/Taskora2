/**
 * Shared types for the notebook surface. Mirrors the backend Pydantic
 * shapes loosely — only the fields the FE actually reads are declared
 * so backend additions don't break the type-check.
 */

export type BlockKind =
  | "text"
  | "heading"
  | "bullet"
  | "numbered"
  | "todo"
  | "quote"
  | "code"
  | "callout"
  | "divider"
  | "table";

export interface TextBlock {
  id: string;
  type: "text";
  text: string;
}

export interface HeadingBlock {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
}

export interface BulletBlock {
  id: string;
  type: "bullet";
  text: string;
}

export interface NumberedBlock {
  id: string;
  type: "numbered";
  text: string;
}

export interface TodoBlock {
  id: string;
  type: "todo";
  text: string;
  checked: boolean;
}

export interface QuoteBlock {
  id: string;
  type: "quote";
  text: string;
}

export interface CodeBlock {
  id: string;
  type: "code";
  text: string;
  language?: string;
}

export interface CalloutBlock {
  id: string;
  type: "callout";
  text: string;
  emoji?: string;
}

export interface DividerBlock {
  id: string;
  type: "divider";
}

export interface TableBlock {
  id: string;
  type: "table";
  rows: number;
  cols: number;
  /** flat row-major cells: cells[r * cols + c] */
  cells: string[];
}

export type Block =
  | TextBlock
  | HeadingBlock
  | BulletBlock
  | NumberedBlock
  | TodoBlock
  | QuoteBlock
  | CodeBlock
  | CalloutBlock
  | DividerBlock
  | TableBlock;

/** Convenience: blocks that hold an editable text field. */
export type TextLikeBlock =
  | TextBlock
  | HeadingBlock
  | BulletBlock
  | NumberedBlock
  | TodoBlock
  | QuoteBlock
  | CodeBlock
  | CalloutBlock;

export function isTextLike(b: Block): b is TextLikeBlock {
  return (
    b.type === "text" ||
    b.type === "heading" ||
    b.type === "bullet" ||
    b.type === "numbered" ||
    b.type === "todo" ||
    b.type === "quote" ||
    b.type === "code" ||
    b.type === "callout"
  );
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  archived_at: string | null;
}

export interface Page {
  id: string;
  project_id: string | null;
  owner_id: string;
  title: string;
  body: Block[];
  updated_at: string;
  follower_role?: "viewer" | "editor";
  /** Optional emoji icon shown next to the title in editor + sidebar. */
  icon?: string | null;
}

export interface ChecklistItem {
  id: string;
  owner_id: string;
  content: string;
  due_date: string | null;
  status: "open" | "done";
  source_page_id: string | null;
  source_assignment_id: string | null;
  parent_item_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface Assignment {
  id: string;
  sender_id: string;
  recipient_id: string;
  source_page_id: string | null;
  source_block_id: string | null;
  content: string;
  status: "pending" | "accepted" | "declined" | "done";
  created_at: string;
  sender_name?: string;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
}

export interface Follower {
  user_id: string;
  role: "viewer" | "editor";
  name?: string;
  added_at: string;
}

export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh block of the given kind, with sensible defaults. */
export function freshBlock(kind: BlockKind): Block {
  const id = newBlockId();
  switch (kind) {
    case "heading": return { id, type: "heading", level: 1, text: "" };
    case "bullet":  return { id, type: "bullet", text: "" };
    case "numbered":return { id, type: "numbered", text: "" };
    case "todo":    return { id, type: "todo", text: "", checked: false };
    case "quote":   return { id, type: "quote", text: "" };
    case "code":    return { id, type: "code", text: "", language: "" };
    case "callout": return { id, type: "callout", text: "", emoji: "💡" };
    case "divider": return { id, type: "divider" };
    case "table":   return {
      id, type: "table", rows: 3, cols: 3,
      cells: Array(9).fill(""),
    };
    case "text":
    default:        return { id, type: "text", text: "" };
  }
}
