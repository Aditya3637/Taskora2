-- 033_initiative_followers.sql
-- Initiative-scoped followers: read-only viewers who can see the entire
-- initiative tree (initiative -> tasks -> subtasks) but cannot create or edit
-- anything. Parallel to item_watchers but at initiative scope; item_watchers
-- stays as the task-tree mechanism. Idempotent.

CREATE TABLE IF NOT EXISTS initiative_followers (
  initiative_id UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (initiative_id, user_id)
);

-- "Which initiatives is this user following?" — drives visibility scoping.
CREATE INDEX IF NOT EXISTS idx_initiative_followers_user
  ON initiative_followers(user_id);
