-- The reading experience: attestation, personal checklists, telemetry.

CREATE TABLE acknowledgment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  page_version_id uuid NOT NULL REFERENCES page_version(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  ip_hash         bytea,
  -- Re-acknowledgment is a NEW ROW against a new version, never an update.
  UNIQUE (user_id, page_version_id)
);
CREATE INDEX acknowledgment_user_idx ON acknowledgment (user_id);

CREATE OR REPLACE FUNCTION acknowledgment_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'acknowledgment is an attestation: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER acknowledgment_no_update
  BEFORE UPDATE ON acknowledgment
  FOR EACH ROW EXECUTE FUNCTION acknowledgment_is_immutable();

-- A fact about one person ticking one box, for their own tracking. Not a
-- progress rollup: no percentage is stored anywhere.
CREATE TABLE step_check (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  block_id   uuid NOT NULL REFERENCES block(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, block_id, step_index)
);

CREATE TABLE bookmark (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  node_id    uuid NOT NULL REFERENCES content_node(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id)
);

-- Every search is logged, including the ones that found nothing. The
-- zero-result list is the content-gap list.
CREATE TABLE search_event (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  query        text NOT NULL,
  result_count integer NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_event_zero_idx
  ON search_event (at DESC) WHERE result_count = 0;

CREATE TABLE page_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  node_id    uuid NOT NULL REFERENCES content_node(id) ON DELETE CASCADE,
  helpful    boolean NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issue_report (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  node_id       uuid REFERENCES content_node(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','resolved','dismissed')),
  -- Resolving or dismissing REQUIRES a reason, and it goes back to the reporter.
  outcome       text,
  resolved_by   uuid REFERENCES app_user(id),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT resolution_needs_a_reason CHECK (
    status = 'open' OR (outcome IS NOT NULL AND length(btrim(outcome)) > 0)
  )
);
CREATE INDEX issue_report_status_idx ON issue_report (status, created_at DESC);
