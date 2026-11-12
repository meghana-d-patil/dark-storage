-- Migration 010: Rebuild users table with expanded roles and floor attributes
CREATE TABLE users_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name        TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','OPERATOR','PICKER','STAFF','DISPATCH','AUDITOR')),
  badge_id            TEXT,
  pin_hash            TEXT,
  zones               TEXT NOT NULL DEFAULT '[]',
  shift               TEXT NOT NULL DEFAULT 'MORNING' CHECK (shift IN ('MORNING','EVENING','NIGHT')),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  failed_pin_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO users_new (id, username, display_name, password_hash, role, active, created_at)
SELECT id, username, display_name, password_hash, role, active, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_badge ON users(badge_id) WHERE badge_id IS NOT NULL;
