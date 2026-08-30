ALTER TABLE invites ADD COLUMN manage_token_hash TEXT;
ALTER TABLE invites ADD COLUMN created_via TEXT NOT NULL DEFAULT 'admin_demo' CHECK(created_via IN ('admin_demo', 'self_serve'));

DROP INDEX one_live_demo;

CREATE UNIQUE INDEX one_live_demo
  ON invites(demo_key)
  WHERE created_via = 'admin_demo' AND state != 'expired';

CREATE TABLE invite_creation_keys (
  idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key) BETWEEN 16 AND 120),
  invite_id TEXT NOT NULL REFERENCES invites(id),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint) = 64),
  response_json TEXT NOT NULL,
  host_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
