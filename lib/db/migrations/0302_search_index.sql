-- Full-text and fuzzy search. The access filter is a join in the SAME query,
-- never a second system to keep in sync.

-- Flattened, searchable text per node. Maintained on write by the content layer
-- in the same transaction as the block edit; it is a projection of block text,
-- not a status or a rollup.
CREATE TABLE node_search (
  node_id    uuid PRIMARY KEY REFERENCES content_node(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  document   tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(body,  '')), 'B')
              ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX node_search_document_idx ON node_search USING gin (document);
CREATE INDEX node_search_title_trgm_idx
  ON node_search USING gin (title gin_trgm_ops);
