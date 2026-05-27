/**
 * Shared types for the notebook surface. Mirrors the backend Pydantic
 * shapes loosely — only the fields the FE actually reads are declared
 * so backend additions don't break the type-check.
 */

export type BlockType = "text" | "table";

export interface TextBlock {
  id: string;
  type: "text";
  text: string;
}

export interface TableBlock {
  id: string;
  type: "table";
  rows: number;
  cols: number;
  /** flat row-major cells: cells[r * cols + c] */
  cells: string[];
}

export type Block = TextBlock | TableBlock;

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
  follower_role?: "viewer" | "editor";  // present on shared-with-me responses
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
  sender_name?: string;  // populated on inbox list
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

/** Helper to make stable-ish block ids on the client. */
export function newBlockId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}`;
}
