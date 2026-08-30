PRAGMA foreign_keys = ON;

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  invite_token_hash TEXT NOT NULL UNIQUE,
  event_title TEXT NOT NULL CHECK(length(event_title) BETWEEN 1 AND 80),
  event_starts_at TEXT NOT NULL,
  meeting_time_label TEXT NOT NULL CHECK(length(meeting_time_label) BETWEEN 1 AND 40),
  meeting_place_label TEXT NOT NULL CHECK(length(meeting_place_label) BETWEEN 1 AND 80),
  signal_label TEXT NOT NULL CHECK(length(signal_label) BETWEEN 1 AND 40),
  state TEXT NOT NULL CHECK(state IN ('open', 'requested', 'confirmed', 'declined', 'expired')),
  selected_scope TEXT CHECK(selected_scope IN ('entrance', 'reception', 'first10', 'decline')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  invite_id TEXT REFERENCES invites(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('admin', 'host', 'participant')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX sessions_invite_role_idx ON sessions(invite_id, role);

CREATE TABLE interactions (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('host', 'participant')),
  action TEXT NOT NULL CHECK(action IN ('respond', 'confirm')),
  selected_scope TEXT CHECK(selected_scope IN ('entrance', 'reception', 'first10', 'decline')),
  expected_revision INTEGER NOT NULL,
  resulting_state TEXT NOT NULL CHECK(resulting_state IN ('requested', 'confirmed', 'declined')),
  resulting_revision INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 120),
  request_fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(invite_id, actor_role, idempotency_key)
);

CREATE INDEX interactions_invite_created_idx ON interactions(invite_id, created_at);

CREATE TABLE rate_buckets (
  scope_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(scope_key, window_start)
);

CREATE TRIGGER interactions_validate_respond
BEFORE INSERT ON interactions
WHEN NEW.action = 'respond' AND NOT EXISTS (
  SELECT 1 FROM invites
  WHERE id = NEW.invite_id
    AND state = 'open'
    AND revision = NEW.expected_revision
    AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    AND NEW.actor_role = 'participant'
    AND NEW.selected_scope IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'stale_transition');
END;

CREATE TRIGGER interactions_validate_confirm
BEFORE INSERT ON interactions
WHEN NEW.action = 'confirm' AND NOT EXISTS (
  SELECT 1 FROM invites
  WHERE id = NEW.invite_id
    AND state = 'requested'
    AND revision = NEW.expected_revision
    AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    AND NEW.actor_role = 'host'
    AND NEW.selected_scope IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'stale_transition');
END;

CREATE TRIGGER interactions_apply_transition
AFTER INSERT ON interactions
BEGIN
  UPDATE invites
  SET
    state = NEW.resulting_state,
    selected_scope = CASE
      WHEN NEW.action = 'respond' THEN NEW.selected_scope
      ELSE selected_scope
    END,
    revision = NEW.resulting_revision,
    updated_at = NEW.created_at
  WHERE id = NEW.invite_id
    AND revision = NEW.expected_revision;
END;
