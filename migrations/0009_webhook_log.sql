-- Every call X makes to the webhook, and every message the Messages refresh
-- found that the webhook never brought. When something goes missing, this
-- says whether X called and what happened. The last thousand rows are kept.
CREATE TABLE webhook_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind   TEXT NOT NULL,   -- delivery | bad_signature | crc | failed | missed
  types  TEXT,            -- the event types in a delivery
  note   TEXT
);
