ALTER TABLE invites ADD COLUMN demo_key TEXT NOT NULL DEFAULT 'seed-demo';

CREATE UNIQUE INDEX one_live_demo
  ON invites(demo_key)
  WHERE state != 'expired';

CREATE TRIGGER invites_state_scope_insert
BEFORE INSERT ON invites
WHEN NOT (
  (NEW.state = 'open' AND NEW.selected_scope IS NULL) OR
  (NEW.state IN ('requested', 'confirmed') AND NEW.selected_scope IN ('entrance', 'reception', 'first10')) OR
  (NEW.state = 'declined' AND NEW.selected_scope = 'decline') OR
  NEW.state = 'expired'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_invite_state_scope');
END;

CREATE TRIGGER invites_state_scope_update
BEFORE UPDATE OF state, selected_scope ON invites
WHEN NOT (
  (NEW.state = 'open' AND NEW.selected_scope IS NULL) OR
  (NEW.state IN ('requested', 'confirmed') AND NEW.selected_scope IN ('entrance', 'reception', 'first10')) OR
  (NEW.state = 'declined' AND NEW.selected_scope = 'decline') OR
  NEW.state = 'expired'
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_invite_state_scope');
END;

CREATE TRIGGER sessions_role_invite_insert
BEFORE INSERT ON sessions
WHEN NOT (
  (NEW.role = 'admin' AND NEW.invite_id IS NULL) OR
  (NEW.role IN ('host', 'participant') AND NEW.invite_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_session_role_invite');
END;

CREATE TRIGGER sessions_role_invite_update
BEFORE UPDATE OF role, invite_id ON sessions
WHEN NOT (
  (NEW.role = 'admin' AND NEW.invite_id IS NULL) OR
  (NEW.role IN ('host', 'participant') AND NEW.invite_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_session_role_invite');
END;
