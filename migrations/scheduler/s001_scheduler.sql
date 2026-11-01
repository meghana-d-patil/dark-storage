CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('PUTAWAY','RELOCATE','RESERVE_ORDER','PICK_CONFIRM','EXCEPTION_RESOLVE')),
  priority        INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 4),   -- 1 LOW, 2 NORMAL, 3 HIGH, 4 URGENT
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_json      TEXT NOT NULL,
  payload_json    TEXT NOT NULL,
  resources_json  TEXT NOT NULL,                                       -- sorted JSON array of resource strings
  status          TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  http_status     INTEGER,
  result_json     TEXT,
  error_code      TEXT,
  error_message   TEXT,
  error_details_json TEXT,
  created_at      TEXT NOT NULL,
  started_at      TEXT,
  finished_at     TEXT
);
CREATE INDEX idx_tasks_status ON tasks(status, priority, created_at);

CREATE TABLE locks (
  resource      TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  fencing_token INTEGER NOT NULL,
  acquired_at   TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

CREATE TABLE lock_tokens (id INTEGER PRIMARY KEY CHECK (id = 1), next_token INTEGER NOT NULL);
INSERT INTO lock_tokens (id, next_token) VALUES (1, 1);

CREATE TABLE task_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL,
  at          TEXT NOT NULL,
  event       TEXT NOT NULL,   -- ENQUEUED, LOCKS_ACQUIRED, EXECUTING, RETRY_SCHEDULED, SUCCEEDED, FAILED, RECOVERED_AFTER_RESTART, LOCKS_RELEASED, LOCK_EXPIRED
  details_json TEXT
);
CREATE INDEX idx_task_events_task ON task_events(task_id);
