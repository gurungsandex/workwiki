-- Blocks. `kind` selects a validator and a renderer in code; the typed payload
-- lives in `data`. Adding a kind adds a validator and a component, NOT a
-- migration — which is why there is no CHECK on kind.

CREATE TABLE snippet (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE block (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         uuid NOT NULL REFERENCES content_node(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  -- Optional slot for the standard page shape (summary, what it means, steps,
  -- attachments, links out, who to ask, review). Free blocks leave it null.
  slot            text,
  sort_key        text NOT NULL,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_block_id uuid REFERENCES block(id),
  source_file_id  uuid REFERENCES file_object(id),
  source_url      text,
  snippet_id      uuid REFERENCES snippet(id),
  -- Summary publication state. A drafted summary is invisible to employees
  -- until an admin publishes it, which stamps a byline.
  published_at    timestamptz,
  published_by    uuid REFERENCES app_user(id),
  byline_kind     text CHECK (byline_kind IN ('authored','confirmed_source')),
  drafted_by_platform boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,

  -- A summary cannot exist unattached: it must name what it summarises.
  CONSTRAINT summary_needs_a_source CHECK (
    kind <> 'summary'
    OR source_block_id IS NOT NULL
    OR source_file_id  IS NOT NULL
    OR source_url      IS NOT NULL
  ),
  -- A published summary must carry a byline.
  CONSTRAINT published_summary_needs_byline CHECK (
    kind <> 'summary' OR published_at IS NULL OR byline_kind IS NOT NULL
  )
);
CREATE INDEX block_node_idx ON block (node_id) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX block_slot_idx
  ON block (node_id, slot) WHERE slot IS NOT NULL AND archived_at IS NULL;

-- NOTE: there is deliberately no summary_stale column. Staleness is
-- `source.updated_at > summary.updated_at`, computed at read time.
