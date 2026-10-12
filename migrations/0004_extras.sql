-- What X says about a post beyond its text: where each t.co link really
-- goes, the images, and the post it quotes. JSON; NULL until X has told us.
ALTER TABLE x_posts ADD COLUMN extra TEXT;
ALTER TABLE dms ADD COLUMN extra TEXT;

-- Likes are counted from each recent post's own numbers, read now and then,
-- instead of one billed event per like. changed_at moves when the count
-- grows, which is what lifts the post's line to the top.
CREATE TABLE post_stats (
  post_id    TEXT PRIMARY KEY,
  likes      INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT NOT NULL
);
DELETE FROM activity WHERE kind = 'like';
