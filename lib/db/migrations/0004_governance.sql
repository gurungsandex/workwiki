-- Admin scope and the append-only audit log.

CREATE TABLE admin_scope (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  capability text NOT NULL,
  scope_type text NOT NULL DEFAULT 'global'
               CHECK (scope_type IN ('global','department')),
  scope_id   uuid,
  granted_by uuid REFERENCES app_user(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (scope_type = 'global' OR scope_id IS NOT NULL)
);
CREATE INDEX admin_scope_user_idx ON admin_scope (user_id) WHERE revoked_at IS NULL;

-- Append-only. No update path, no delete path — enforced by grants below and by
-- a trigger, so neither an ORM bug nor a hand-written query can rewrite history.
CREATE TABLE audit_event (
  id            bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app_user(id),
  actor_label   text,
  action        text NOT NULL,
  area          text NOT NULL
                  CHECK (area IN ('Content','Documents','People','Access','Setup')),
  target_type   text,
  target_id     uuid,
  before        jsonb,
  after         jsonb,
  ip_hash       bytea,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_at_idx   ON audit_event (at DESC);
CREATE INDEX audit_event_area_idx ON audit_event (area, at DESC);

CREATE OR REPLACE FUNCTION audit_event_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_is_append_only();
