-- Focus mode: only replies, mentions and quotes are notifications now.
DELETE FROM notifications WHERE type NOT IN ('reply', 'mention', 'quote');
DELETE FROM settings WHERE key IN ('push_all', 'long_posts');

-- What a post answers, so a back-and-forth can be shown as one conversation.
-- NULL means we don't know yet; '' means it answers nothing.
ALTER TABLE x_posts ADD COLUMN reply_to TEXT;
CREATE INDEX idx_x_posts_reply_to ON x_posts(reply_to);

-- Liked from notime (or seen liked). The heart is how the owner marks a
-- reply as dealt with.
ALTER TABLE notifications ADD COLUMN liked INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_notifications_post ON notifications(post_id);

-- Direct messages, one row per message. partner_id is the other person in a
-- one-to-one conversation, which is the only kind the app shows.
CREATE TABLE dms (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  partner_id      TEXT NOT NULL,
  sender_id       TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  read            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_dms_partner ON dms(partner_id, created_at DESC);

-- The credit balance X reports, one reading per UTC day, so the app can show
-- what was really spent instead of an estimate.
CREATE TABLE balance (
  day   TEXT PRIMARY KEY,
  total REAL NOT NULL,
  at    TEXT NOT NULL DEFAULT (datetime('now'))
);
