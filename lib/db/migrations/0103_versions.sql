-- Immutable published versions. Acknowledgments point here, never at the live
-- page, so an attestation always names exactly what was read.

CREATE TABLE page_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        uuid NOT NULL REFERENCES content_node(id) ON DELETE CASCADE,
  version_no     integer NOT NULL,
  snapshot       jsonb NOT NULL,
  -- sha256 over the canonical JSON of `snapshot` (lib/content/canonical.ts).
  -- Derived, but from a moment that has passed: recomputing it later would be
  -- recomputing history. It is an artefact of the publish, not a rollup.
  content_hash   bytea NOT NULL,
  effective_date date,
  note           text,
  published_at   timestamptz NOT NULL DEFAULT now(),
  published_by   uuid REFERENCES app_user(id),
  UNIQUE (node_id, version_no)
);
CREATE INDEX page_version_node_idx ON page_version (node_id, version_no DESC);

CREATE OR REPLACE FUNCTION page_version_is_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'page_version is immutable: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_version_no_update
  BEFORE UPDATE ON page_version
  FOR EACH ROW EXECUTE FUNCTION page_version_is_immutable();
