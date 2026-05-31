-- 038_program_followers.sql
-- Program-scoped followers: read-only viewers at the apex of the visibility
-- pyramid. Following a program grants read access to every initiative under
-- it (and via the existing task-cascade, every task/subtask under those).
-- Parallel to initiative_followers (033). Cannot create or edit anything.
-- Idempotent.

CREATE TABLE IF NOT EXISTS program_followers (
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (program_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_program_followers_user
  ON program_followers(user_id);
