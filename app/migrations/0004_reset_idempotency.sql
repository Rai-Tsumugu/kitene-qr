CREATE TABLE reset_keys (
  idempotency_key TEXT PRIMARY KEY CHECK(length(idempotency_key) BETWEEN 16 AND 120),
  invite_id TEXT NOT NULL REFERENCES invites(id),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint) = 64),
  response_json TEXT NOT NULL,
  host_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
