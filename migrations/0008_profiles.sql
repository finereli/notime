-- What a profile screen shows beyond the name and face in x_users, and
-- whether the owner follows the person. Kept so a second look is free.
CREATE TABLE profiles (
  user_id     TEXT PRIMARY KEY,
  description TEXT,
  location    TEXT,
  url         TEXT,
  followers   INTEGER,
  following   INTEGER,
  posts       INTEGER,
  i_follow    INTEGER,
  follows_me  INTEGER,
  fetched_at  INTEGER NOT NULL,
  timeline_at INTEGER
);
