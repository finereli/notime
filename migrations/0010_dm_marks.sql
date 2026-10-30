-- Conversations the owner marked unread: a note to answer later, so having
-- read a message does not mean having to answer it now. A mark stays until
-- the owner replies (here or on X) or takes it off; opening the
-- conversation leaves it alone.
CREATE TABLE dm_marks (
  partner_id TEXT PRIMARY KEY,
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
