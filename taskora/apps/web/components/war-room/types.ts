export type WRLink = {
  type: "task" | "subtask" | "initiative" | "program";
  task_id?: string | null;
  subtask_id?: string | null;
  initiative_id?: string | null;
  program_id?: string | null;
};

export interface QueueTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date?: string;
  description?: string;
  blocker_reason?: string;
  created_at?: string;
  age_label?: string;
  is_overdue?: boolean;
  initiative_name?: string;
  program_name?: string;
  primary_stakeholder_name?: string;
  days_overdue?: number;
  approval_state?: string;
  open_subtasks?: number;
  done_subtasks?: number;
  total_subtasks?: number;
  pending_approvers?: string[];
  last_comment?: { snippet: string; at?: string; author_name?: string } | null;
  link?: WRLink;
  // Set by the People focus endpoint:
  column?: string;
  role_of_person?: "primary" | "approver" | "contributor";
  task_entities?: {
    entity_id: string;
    entity_name?: string;
    per_entity_status?: string;
    per_entity_end_date?: string;
    updated_at?: string;
  }[];
}

export function wrLinkHref(link?: WRLink): string | null {
  if (!link) return null;
  if (link.type === "program" && link.program_id) return `/programs?program=${link.program_id}`;
  if (link.type === "initiative" && link.initiative_id) return `/tasks?initiative=${link.initiative_id}`;
  if ((link.type === "task" || link.type === "subtask") && link.task_id) {
    const q = new URLSearchParams({ task: link.task_id });
    if (link.subtask_id) q.set("subtask", link.subtask_id);
    return `/tasks?${q.toString()}`;
  }
  return null;
}
