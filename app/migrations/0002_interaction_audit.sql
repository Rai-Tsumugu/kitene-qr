PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS interactions_validate_transition;
DROP TRIGGER IF EXISTS interactions_validate_respond;
DROP TRIGGER IF EXISTS interactions_validate_confirm;
DROP TRIGGER IF EXISTS interactions_apply_transition;

CREATE TABLE interactions_v2 (
  id TEXT PRIMARY KEY,
  invite_id TEXT NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL CHECK(actor_role IN ('admin', 'host', 'participant', 'system')),
  action TEXT NOT NULL CHECK(action IN ('reset', 'respond', 'decline', 'confirm', 'expire')),
  selected_scope TEXT CHECK(selected_scope IN ('entrance', 'reception', 'first10', 'decline')),
  expected_revision INTEGER NOT NULL,
  resulting_state TEXT NOT NULL CHECK(resulting_state IN ('open', 'requested', 'confirmed', 'declined', 'expired')),
  resulting_revision INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 120),
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint) = 64),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(invite_id, actor_role, idempotency_key)
);

INSERT INTO interactions_v2
SELECT id, invite_id, actor_role, action, selected_scope, expected_revision,
  resulting_state, resulting_revision, idempotency_key, request_fingerprint,
  response_json, created_at
FROM interactions;

DROP TABLE interactions;
ALTER TABLE interactions_v2 RENAME TO interactions;

CREATE INDEX interactions_invite_created_idx ON interactions(invite_id, created_at);

CREATE TRIGGER interactions_validate_respond
BEFORE INSERT ON interactions
WHEN NEW.action IN ('respond', 'decline') AND NOT EXISTS (
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
WHEN NEW.action IN ('respond', 'decline', 'confirm')
BEGIN
  UPDATE invites
  SET
    state = NEW.resulting_state,
    selected_scope = CASE
      WHEN NEW.action IN ('respond', 'decline') THEN NEW.selected_scope
      ELSE selected_scope
    END,
    revision = NEW.resulting_revision,
    updated_at = NEW.created_at
  WHERE id = NEW.invite_id
    AND revision = NEW.expected_revision;
END;

CREATE TRIGGER interactions_immutable_update
BEFORE UPDATE ON interactions
BEGIN
  SELECT RAISE(ABORT, 'interactions_are_immutable');
END;

CREATE TRIGGER interactions_immutable_delete
BEFORE DELETE ON interactions
BEGIN
  SELECT RAISE(ABORT, 'interactions_are_immutable');
END;

PRAGMA foreign_keys = ON;
