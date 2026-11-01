CREATE TABLE putaways (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref             TEXT NOT NULL UNIQUE,
  receipt_line_id INTEGER NOT NULL REFERENCES receipt_lines(id),
  sku             TEXT NOT NULL COLLATE NOCASE REFERENCES products(sku),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  dest_bin        TEXT NOT NULL REFERENCES bins(code),
  selection_mode  TEXT NOT NULL CHECK (selection_mode IN ('RECOMMENDED','MANUAL')),
  recommended_bin TEXT REFERENCES bins(code),
  movement_ref    TEXT NOT NULL,
  performed_by    INTEGER NOT NULL REFERENCES users(id),
  task_id         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_putaways_line ON putaways(receipt_line_id);
