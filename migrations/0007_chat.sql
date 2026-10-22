-- X Chat, the encrypted messages. The decrypted text goes into dms like any
-- other message; these tables hold what decrypting needs.

-- Each person's published chat keys, kept so every message does not cost a
-- lookup. Public by design.
CREATE TABLE chat_public_keys (
  user_id    TEXT PRIMARY KEY,
  records    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- The key-change events of each conversation, as X sends them. They carry
-- the conversation key encrypted to each participant, so they are useless
-- without the owner's private key.
CREATE TABLE chat_key_events (
  conversation_id TEXT NOT NULL,
  event           TEXT NOT NULL,
  PRIMARY KEY (conversation_id, event)
);
