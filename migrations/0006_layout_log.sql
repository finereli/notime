-- What the phone reports when the whole app moves (the page itself scrolls,
-- or the visible area pans), so a layout bug that only happens on a real
-- phone leaves evidence. Trimmed to the latest 200.
CREATE TABLE layout_log (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   TEXT NOT NULL DEFAULT (datetime('now')),
  data TEXT NOT NULL
);
