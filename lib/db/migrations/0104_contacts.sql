-- Contact cards are stored once and embedded BY REFERENCE, so a changed number
-- changes everywhere.

CREATE TABLE contact_card (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  title              text,
  email              citext,
  phone              text,
  extension          text,
  about              text,
  response_time_note text,
  -- Per-field: 'all' | 'managers' | 'admins'. Enforced in the serialiser, which
  -- is the single place responses are built, so no route can leak a mobile
  -- number by forgetting a filter.
  field_visibility   jsonb NOT NULL DEFAULT '{}'::jsonb,
  department_id      uuid REFERENCES department(id),
  location_id        uuid REFERENCES location(id),
  is_default_hr      boolean NOT NULL DEFAULT false,
  origin             text NOT NULL DEFAULT 'custom'
                       CHECK (origin IN ('scaffold','custom','import')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz
);
CREATE UNIQUE INDEX contact_card_one_default_hr
  ON contact_card ((true)) WHERE is_default_hr AND archived_at IS NULL;

CREATE TABLE contact_binding (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     uuid NOT NULL REFERENCES contact_card(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('node','department','location')),
  target_id   uuid NOT NULL,
  purpose     text NOT NULL,
  sort_key    text NOT NULL DEFAULT 'm',
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (card_id, target_type, target_id, purpose)
);
CREATE INDEX contact_binding_target_idx ON contact_binding (target_type, target_id);

ALTER TABLE content_node
  ADD CONSTRAINT content_node_help_contact_fk
  FOREIGN KEY (help_contact_card_id) REFERENCES contact_card(id);
