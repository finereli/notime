-- OAuth for MCP clients (agents). notime is its own authorization server:
-- clients register themselves, the owner approves by signing in with X, and
-- the client gets a short access token and a rotating refresh token. Tokens
-- are stored as SHA-256 hashes, never as themselves.
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,
  name          TEXT,
  redirect_uris TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- An authorize request waiting for the owner to sign in with X.
CREATE TABLE mcp_pending (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  state          TEXT,
  code_challenge TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- kind: code (10 minutes, one use), access (1 hour), refresh (90 days, rotated).
CREATE TABLE mcp_tokens (
  hash           TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT,
  code_challenge TEXT,
  expires_at     INTEGER NOT NULL,
  last_used      TEXT
);
CREATE INDEX idx_mcp_tokens_client ON mcp_tokens(client_id);

-- Which X sign-in is really an MCP approval.
ALTER TABLE oauth_states ADD COLUMN mcp TEXT;
