-- Access rules. Denies are evaluated first and are rare, hence the partial index.

CREATE TABLE access_rule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type            text NOT NULL CHECK (target_type IN ('node','benefit','resource')),
  target_id              uuid NOT NULL,
  effect                 text NOT NULL CHECK (effect IN ('allow','deny')),
  -- Validated in code by lib/access/conditions.ts, never by a CHECK: the
  -- dimension values inside are a company's own vocabulary.
  conditions             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'preview' is deliberately not an option: a tenure-locked reader never
  -- receives a body. See docs/DECISIONS.md.
  visibility_when_locked text NOT NULL DEFAULT 'teaser'
                           CHECK (visibility_when_locked IN ('hidden','teaser')),
  priority               integer NOT NULL DEFAULT 0,
  created_by             uuid REFERENCES app_user(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  archived_at            timestamptz
);
CREATE INDEX access_rule_target_idx
  ON access_rule (target_type, target_id) WHERE archived_at IS NULL;
CREATE INDEX access_rule_deny_idx
  ON access_rule (target_type, target_id)
  WHERE effect = 'deny' AND archived_at IS NULL;
