import type { QueueTask } from "@/components/war-room/types";

export interface PersonCounts {
  open: number;
  overdue: number;
  blocked: number;
  due_this_week: number;
  pending_decision: number;
  stale: number;
  awaiting_their_approval: number;
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
}

export interface BoardResp {
  generated_at: string;
  people: PersonSummary[];
  totals: PersonCounts & { people: number };
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
}

export function initials(name: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
