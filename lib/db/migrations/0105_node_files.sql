-- Files attached to a node. The original upload is immutable and stays
-- downloadable through the access-checked route.

CREATE TABLE node_file (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        uuid NOT NULL REFERENCES content_node(id) ON DELETE CASCADE,
  file_object_id uuid NOT NULL REFERENCES file_object(id),
  sort_key       text NOT NULL DEFAULT 'm',
  caption        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz,
  UNIQUE (node_id, file_object_id)
);
CREATE INDEX node_file_node_idx ON node_file (node_id) WHERE archived_at IS NULL;
