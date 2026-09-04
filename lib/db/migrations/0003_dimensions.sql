-- The dimension tables. These are ROWS, not enums.
-- No CHECK constraint, no TypeScript union and no migration ever names a real
-- company's department, role, employee type, location or employment status.
-- The single exception the spec permits is employee_type.kind, a soft hint used
-- only to pick sensible defaults in the rule builder.

CREATE TABLE jurisdiction (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level        text NOT NULL CHECK (level IN ('federal','state','other')),
  country_code text NOT NULL,
  region_code  text,
  name         text NOT NULL,
  sort_key     text NOT NULL DEFAULT 'm',
  origin       text NOT NULL DEFAULT 'custom'
                 CHECK (origin IN ('scaffold','custom','import')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);

CREATE TABLE department (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  sort_key    text NOT NULL DEFAULT 'm',
  origin      text NOT NULL DEFAULT 'custom'
                CHECK (origin IN ('scaffold','custom','import')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX department_slug_live_idx
  ON department (slug) WHERE archived_at IS NULL;

CREATE TABLE role (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES department(id),
  name          text NOT NULL,
  slug          text NOT NULL,
  sort_key      text NOT NULL DEFAULT 'm',
  origin        text NOT NULL DEFAULT 'custom'
                  CHECK (origin IN ('scaffold','custom','import')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE UNIQUE INDEX role_slug_live_idx ON role (slug) WHERE archived_at IS NULL;
CREATE INDEX role_department_idx ON role (department_id);

CREATE TABLE employee_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  -- The one soft hint the spec allows. Never branched on for access.
  kind        text NOT NULL DEFAULT 'other'
                CHECK (kind IN ('salaried','hourly','contingent','other')),
  sort_key    text NOT NULL DEFAULT 'm',
  origin      text NOT NULL DEFAULT 'custom'
                CHECK (origin IN ('scaffold','custom','import')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX employee_type_slug_live_idx
  ON employee_type (slug) WHERE archived_at IS NULL;

CREATE TABLE location (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL,
  jurisdiction_id uuid REFERENCES jurisdiction(id),
  -- Tenure unlocks at local midnight HERE, so a rule does not unlock a day
  -- early for a west-coast employee (spec §3). The spec's key-table listing
  -- omits this column; without it that sentence is unimplementable.
  timezone        text NOT NULL DEFAULT 'UTC',
  street          text,
  city            text,
  region          text,
  postal_code     text,
  sort_key        text NOT NULL DEFAULT 'm',
  origin          text NOT NULL DEFAULT 'custom'
                    CHECK (origin IN ('scaffold','custom','import')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE UNIQUE INDEX location_slug_live_idx
  ON location (slug) WHERE archived_at IS NULL;

-- Employment status is company vocabulary ("New hire", "Notice period", ...),
-- so it is a table, not a CHECK.
CREATE TABLE employment_status (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  sort_key    text NOT NULL DEFAULT 'm',
  origin      text NOT NULL DEFAULT 'custom'
                CHECK (origin IN ('scaffold','custom','import')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX employment_status_slug_live_idx
  ON employment_status (slug) WHERE archived_at IS NULL;

-- Optional admin-defined cohorts, backing Subject.groupIds in the evaluator.
CREATE TABLE employee_group (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL,
  sort_key    text NOT NULL DEFAULT 'm',
  origin      text NOT NULL DEFAULT 'custom'
                CHECK (origin IN ('scaffold','custom','import')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX employee_group_slug_live_idx
  ON employee_group (slug) WHERE archived_at IS NULL;

CREATE TABLE employee_profile (
  user_id                   uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  display_name              text NOT NULL,
  department_id             uuid REFERENCES department(id),
  role_id                   uuid REFERENCES role(id),
  employee_type_id          uuid REFERENCES employee_type(id),
  location_id               uuid REFERENCES location(id),
  employment_status_id      uuid REFERENCES employment_status(id),
  -- A remote employee's work state can differ from their site (spec §13 q3).
  work_state_jurisdiction_id uuid REFERENCES jurisdiction(id),
  hours_per_week            numeric(5,2),
  external_employee_id      text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  archived_at               timestamptz
);
-- NOTE: there is deliberately no hire_date column here. The hire date lives
-- once, in tenure_anchor with key 'hire_date', so the evaluator has exactly one
-- lookup path and there is no second copy to drift. See docs/DECISIONS.md.

CREATE TABLE employee_group_member (
  user_id  uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES employee_group(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE tenure_anchor (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  key     text NOT NULL,       -- 'hire_date', 'benefits_eligibility_date', ...
  date    date NOT NULL,
  source  text NOT NULL DEFAULT 'admin'
            CHECK (source IN ('profile','admin','import')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);
