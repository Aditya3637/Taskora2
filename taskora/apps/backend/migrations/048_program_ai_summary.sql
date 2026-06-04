-- 048_program_ai_summary.sql
-- D4: AI-generated program summary. The program level has NO manual work doc
-- (047 constrains workspace_docs to initiatives); this generated narrative IS
-- the program-level synthesis, rolled up FROM the initiative work docs + the
-- live rollup/risk numbers. One row per generation (a small history); the UI
-- reads the latest. Purely additive, no cron/email side effects (unlike 045).
--
-- Backend-only: RLS enabled with NO policies, so only the service-role client
-- the backend uses can touch it — same pattern as 046/047/automation.
create table if not exists public.program_ai_summaries (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references public.programs(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete cascade,
  body         text not null,                 -- the generated narrative (markdown)
  model        text,                          -- model id used to generate it
  health       text,                          -- composite_health at generation time
  inputs       jsonb,                         -- snapshot of the signals fed in (audit)
  generated_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now()
);
create index if not exists idx_prog_ai_summary
  on public.program_ai_summaries (program_id, generated_at desc);

alter table public.program_ai_summaries enable row level security;
