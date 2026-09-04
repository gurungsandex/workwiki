-- The content tree.
--
-- ONE table, not three. The spec's ER diagram draws SECTION / TOPIC / PAGE as
-- separate entities, but its key-table listing gives all three an identical
-- column list including parent_id, which only means anything if they are one
-- table. One table makes the evaluator's ancestor chain a single recursive CTE
-- and makes access_rule (target_type, target_id) uniform across levels.
-- See docs/DECISIONS.md.

CREATE TABLE content_kind (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL,
  -- Required statutory postings are never summarised by the platform; the admin
  -- confirms the source instead, which stamps a different byline.
  never_summarised boolean NOT NULL DEFAULT false,
  sort_key         text NOT NULL DEFAULT 'm',
  origin           text NOT NULL DEFAULT 'scaffold'
                     CHECK (origin IN ('scaffold','custom','import')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);
CREATE UNIQUE INDEX content_kind_slug_live_idx
  ON content_kind (slug) WHERE archived_at IS NULL;

CREATE TABLE content_node (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level                text NOT NULL CHECK (level IN ('section','topic','page')),
  parent_id            uuid REFERENCES content_node(id),
  depth                integer NOT NULL DEFAULT 1 CHECK (depth BETWEEN 1 AND 3),
  title                text NOT NULL,
  slug                 text NOT NULL,
  -- Fractional index: drag-and-drop is a single-row update.
  sort_key             text NOT NULL,
  -- An AUTHORED state, set by an admin action. Not derived from anything.
  state                text NOT NULL DEFAULT 'draft'
                         CHECK (state IN ('draft','published','archived')),
  publish_at           timestamptz,
  unpublish_at         timestamptz,
  origin               text NOT NULL DEFAULT 'custom'
                         CHECK (origin IN ('scaffold','custom','import')),
  content_kind_id      uuid REFERENCES content_kind(id),
  help_contact_card_id uuid,
  teaser               text,          -- the one line a tenure-locked reader sees
  review_due_at        date,
  review_owner_user_id uuid REFERENCES app_user(id),
  created_by           uuid REFERENCES app_user(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz
);
CREATE UNIQUE INDEX content_node_slug_live_idx
  ON content_node (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
  WHERE archived_at IS NULL;
CREATE INDEX content_node_parent_idx ON content_node (parent_id);
CREATE INDEX content_node_state_idx  ON content_node (state) WHERE archived_at IS NULL;

-- Depth is capped by the DATABASE, not by application code. A fourth level is
-- rejected at insert; the editor's "split this content" message is a UI nicety
-- on top of a hard constraint.
CREATE OR REPLACE FUNCTION content_node_enforce_level() RETURNS trigger AS $$
DECLARE
  parent_level text;
  parent_depth integer;
BEGIN
  IF NEW.parent_id IS NULL THEN
    IF NEW.level <> 'section' THEN
      RAISE EXCEPTION 'a % must have a parent; only a section may be a root', NEW.level;
    END IF;
    NEW.depth := 1;
    RETURN NEW;
  END IF;

  SELECT level, depth INTO parent_level, parent_depth
    FROM content_node WHERE id = NEW.parent_id;

  IF parent_level IS NULL THEN
    RAISE EXCEPTION 'parent % does not exist', NEW.parent_id;
  END IF;

  IF NEW.id = NEW.parent_id THEN
    RAISE EXCEPTION 'a node cannot be its own parent';
  END IF;

  IF parent_level = 'section' AND NEW.level <> 'topic' THEN
    RAISE EXCEPTION 'a child of a section must be a topic, not a %', NEW.level;
  END IF;
  IF parent_level = 'topic' AND NEW.level <> 'page' THEN
    RAISE EXCEPTION 'a child of a topic must be a page, not a %', NEW.level;
  END IF;
  IF parent_level = 'page' THEN
    RAISE EXCEPTION 'a page cannot contain another node; depth is capped at three';
  END IF;

  NEW.depth := parent_depth + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_node_level_check
  BEFORE INSERT OR UPDATE OF parent_id, level ON content_node
  FOR EACH ROW EXECUTE FUNCTION content_node_enforce_level();
