-- Migration 011: system_config and job_runs tables with REF-6 defaults

CREATE TABLE IF NOT EXISTS system_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  value_type  TEXT NOT NULL CHECK(value_type IN ('int','float','string','bool')),
  min_val     REAL,
  max_val     REAL,
  grp         TEXT NOT NULL CHECK(grp IN ('WEIGHT','THRESHOLD')),
  description TEXT,
  updated_by  TEXT,
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  status      TEXT NOT NULL CHECK(status IN ('OK','ERROR')),
  detail      TEXT
);

-- Seed REF-6 default configuration keys
INSERT OR IGNORE INTO system_config (key, value, value_type, min_val, max_val, grp, description) VALUES
  ('lease.mission_seconds', '60', 'int', 10, 3600, 'THRESHOLD', 'Picker mission lock lease duration in seconds'),
  ('lease.floor_task_seconds', '120', 'int', 10, 3600, 'THRESHOLD', 'Floor task claim lease duration in seconds'),
  ('exception.recount_sla_min', '15', 'int', 1, 1440, 'THRESHOLD', 'SLA minutes for counting an exception-frozen bin'),
  ('exception.escalate_min', '15', 'int', 1, 1440, 'THRESHOLD', 'Minutes before unresolved exception escalates to Admin'),
  ('exception.rate_flag_per_100_picks', '5', 'int', 1, 100, 'THRESHOLD', 'Flag picker if exception count per 100 picks exceeds this'),
  ('adjust.admin_threshold_inr', '5000', 'float', 0, 1000000, 'THRESHOLD', 'Adjustment value in INR requiring Admin second approval'),
  ('count.recount_variance_pct', '10', 'float', 0, 100, 'THRESHOLD', 'Variance percentage triggering second blind count'),
  ('count.require_second_counter', 'true', 'bool', 0, 1, 'THRESHOLD', 'Require second counter to differ from first counter'),
  ('cycle.days.A', '7', 'int', 1, 365, 'THRESHOLD', 'Cycle count frequency in days for class A items'),
  ('cycle.days.B', '30', 'int', 1, 365, 'THRESHOLD', 'Cycle count frequency in days for class B items'),
  ('cycle.days.C', '90', 'int', 1, 365, 'THRESHOLD', 'Cycle count frequency in days for class C items'),
  ('pack.weight_tolerance_pct', '8', 'float', 0, 50, 'THRESHOLD', 'Acceptable weight deviation percentage during packing'),
  ('pack.bag_tare_g', '40', 'int', 0, 500, 'THRESHOLD', 'Packaging bag tare weight in grams'),
  ('dispatch.otp_max_attempts', '3', 'int', 1, 10, 'THRESHOLD', 'Maximum OTP entry attempts before lockout'),
  ('inbound.min_shelf_life_pct', '50', 'float', 0, 100, 'THRESHOLD', 'Minimum remaining shelf life percentage on receipt'),
  ('fefo.min_days_to_expiry_at_pick', '1', 'int', 0, 365, 'THRESHOLD', 'Minimum days before expiry for pickable lot'),
  ('expiry.markdown_days', '7', 'int', 0, 180, 'THRESHOLD', 'Days before expiry to flag lot for quarantine/markdown'),
  ('pick.strategy', 'SINGLE', 'string', NULL, NULL, 'THRESHOLD', 'Picking strategy: SINGLE or BATCH'),
  ('pick.batch_size', '3', 'int', 1, 20, 'THRESHOLD', 'Maximum orders in a batch pick mission'),
  ('sla.promise_minutes', '10', 'int', 1, 1440, 'THRESHOLD', 'Target dark-store delivery promise in minutes'),
  ('sla.pick_seconds_per_line', '45', 'int', 5, 600, 'THRESHOLD', 'Target picking seconds per order line'),
  ('reslot.benefit_effort_ratio', '2.0', 'float', 0.1, 100.0, 'THRESHOLD', 'Minimum benefit-to-effort ratio to accept reslotting'),
  ('device.binding_required', 'false', 'bool', 0, 1, 'THRESHOLD', 'Enforce mobile device hardware id binding'),
  ('session.idle_minutes', '10', 'int', 1, 240, 'THRESHOLD', 'Floor device session idle timeout in minutes'),
  ('alloc.w.velocity', '30', 'float', 0, 100, 'WEIGHT', 'Placement weight for SKU velocity ABC class'),
  ('alloc.w.zone', '20', 'float', 0, 100, 'WEIGHT', 'Placement weight for temperature zone matching'),
  ('alloc.w.capacity', '15', 'float', 0, 100, 'WEIGHT', 'Placement weight for bin fill capacity'),
  ('alloc.w.distance', '15', 'float', 0, 100, 'WEIGHT', 'Placement weight for travel distance from dock'),
  ('alloc.w.weight_level', '10', 'float', 0, 100, 'WEIGHT', 'Placement weight for heavy items at bottom shelves'),
  ('alloc.w.compat', '10', 'float', 0, 100, 'WEIGHT', 'Placement weight for product compatibility');
