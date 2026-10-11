-- Likes on the owner's posts and new followers, one row per person per post
-- (post_id is '' for a follow). Shown as one cumulative line per post and
-- one for followers, never one line per like.
CREATE TABLE activity (
  kind     TEXT NOT NULL,
  post_id  TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  at       TEXT NOT NULL,
  PRIMARY KEY (kind, post_id, actor_id)
);
CREATE INDEX idx_activity_at ON activity(at DESC);
