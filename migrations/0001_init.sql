-- One row: the owner's X account and its OAuth tokens. The tokens never
-- leave the server.
CREATE TABLE account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  x_user_id     TEXT NOT NULL,
  username      TEXT NOT NULL,
  name          TEXT,
  avatar        TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  needs_login   INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- pwa-kit sessions, minus the user column: there is only one user.
CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  verifier   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type: reply | mention | quote | repost | like | follow
CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  actor_id        TEXT NOT NULL,
  post_id         TEXT,
  target_post_id  TEXT,
  text            TEXT,
  created_at      TEXT NOT NULL,
  read            INTEGER NOT NULL DEFAULT 0,
  replied_post_id TEXT,
  raw             TEXT
);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- Reads from X cost money, so whatever we learn about a user or a post we keep.
CREATE TABLE x_users (
  id       TEXT PRIMARY KEY,
  username TEXT,
  name     TEXT,
  avatar   TEXT
);
CREATE TABLE x_posts (
  id         TEXT PRIMARY KEY,
  author_id  TEXT,
  text       TEXT,
  created_at TEXT
);

CREATE TABLE events_seen (
  uuid TEXT PRIMARY KEY,
  at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE push_subs (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Billable X calls per UTC day, for the spend estimate in settings.
CREATE TABLE usage (
  day  TEXT NOT NULL,
  kind TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
