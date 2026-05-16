import type { QueueTask, WRLink } from "@/components/war-room/types";

export interface PersonCounts {
  open: number;
  overdue: number;
  blocked: number;
  due_this_week: number;
  pending_decision: number;
  stale: number;
  awaiting_their_approval: number;
}

export interface SpotlightTask {
  id: string;
  title: string;
  status: string;
  column: string;
  days_overdue: number;
  initiative_name?: string | null;
  link?: WRLink;
}

export interface PersonInitiative {
  initiative_id: string;
  name: string;
  leads: boolean;
  completion_pct: number;
  open: number;
  overdue: number;
  blocked: number;
}

export interface PersonSummary {
  user_id: string;
  name: string;
  avatar_url?: string | null;
  role?: string | null;
  can_view_people_board: boolean;
  counts: PersonCounts;
  push_score: number;
  initiatives_led: number;
  programs_touched: number;
  last_active?: string | null;
  workload: {
    overdue: number;
    blocked: number;
    pending_decision: number;
    open: number;
    done: number;
  };
  spotlight: SpotlightTask[];
  initiatives: PersonInitiative[];
}

export interface BoardResp {
  generated_at: string;
  mode: "full" | "self";
  people: PersonSummary[];
  totals: PersonCounts & { people: number };
}

export interface NeedsPushItem {
  kind: "task" | "subtask" | "entity";
  id: string;
  title: string;
  reason: "overdue" | "blocked" | "pending_decision" | "reopened";
  task_id: string;
  link?: WRLink;
  days_overdue?: number;
  initiative_name?: string | null;
  program_name?: string | null;
}

export interface NeedsPushGroup {
  user_id: string | null;
  name: string;
  avatar_url?: string | null;
  count: number;
  items: NeedsPushItem[];
}

export interface FocusInitiative {
  initiative_id?: string | null;
  name: string;
  role_of_person: "owner" | "primary" | "contributor";
  completion_pct: number;
  counts: PersonCounts;
  tasks: QueueTask[];
}

export interface FocusProgram {
  program_id?: string | null;
  program_name: string;
  initiatives: FocusInitiative[];
}

export interface FocusResp {
  generated_at: string;
  person: {
    user_id: string;
    name: string;
    avatar_url?: string | null;
    role?: string | null;
    can_view_people_board: boolean;
  };
  counts: PersonCounts;
  push_score: number;
  columns: { key: string; label: string }[];
  programs: FocusProgram[];
  needs_push: NeedsPushGroup[];
}

export function relativeTime(iso?: string | null): string {
  if (!iso) return "no activity";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "no activity";
  const d = Math.floor((Date.now() - t) / 86400000);
  if (d <= 0) return "active today";
  if (d === 1) return "active 1d ago";
  if (d < 30) return `active ${d}d ago`;
  return `active ${Math.floor(d / 30)}mo ago`;
}

export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
