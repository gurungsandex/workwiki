-- Company details and mail configuration. Both are singletons: one deployment,
-- one company. Every content field is nullable, because a blank field is HIDDEN
-- from employees rather than rendered as an empty card.

CREATE TABLE company_setting (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton             boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  legal_name            text,
  display_name          text,
  street                text,
  suite                 text,
  city                  text,
  region                text,
  postal_code           text,
  country_code          text,
  main_phone            text,
  enquiries_email       text,
  website               text,
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  timezone              text NOT NULL DEFAULT 'UTC',
  size_band             text,
  leave_year_start      date,
  logo_file_id          uuid,
  accent_hex            text,
  email_domain_allowlist text[] NOT NULL DEFAULT '{}',
  setup_completed_at    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- NOTE: no setup_step column. The setup checklist is derived from what exists
-- in the instance, never from a stored step number.

CREATE TABLE mail_setting (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton       boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  host            text,
  port            integer,
  secure          boolean NOT NULL DEFAULT true,
  username        text,
  password_enc    bytea,
  from_address    text,
  last_test_at    timestamptz,
  last_test_error text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
