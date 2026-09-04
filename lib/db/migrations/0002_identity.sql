-- Identity, sessions and single-use tokens.
-- `user` is reserved in Postgres; the table is app_user.

CREATE TABLE app_user (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text,
  email_verified_at timestamptz,
  totp_secret_enc   bytea,
  status            text NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited','active','deactivated')),
  is_admin          boolean NOT NULL DEFAULT false,
  failed_attempts   integer NOT NULL DEFAULT 0,
  locked_until      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);

-- Sessions are rows, so "sign out everywhere" and the admin session list are
-- ordinary queries and revocation is a delete (spec §1, §11).
CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash          bytea NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  ip_hash             bytea,
  user_agent          text
);
CREATE INDEX session_user_idx ON session (user_id);
CREATE INDEX session_expiry_idx ON session (expires_at);

CREATE TABLE auth_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('email_verify','password_reset')),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_token_user_idx ON auth_token (user_id, kind);

CREATE TABLE invite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  bytea NOT NULL UNIQUE,
  email       citext,
  scope       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES app_user(id),
  expires_at  timestamptz NOT NULL,
  max_uses    integer NOT NULL DEFAULT 1,
  use_count   integer NOT NULL DEFAULT 0,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-account and per-IP throttling for login, reset and invite redemption.
CREATE TABLE auth_attempt (
  id         bigserial PRIMARY KEY,
  bucket     text NOT NULL,          -- 'ip:<hash>' or 'email:<citext>'
  purpose    text NOT NULL,          -- 'login' | 'reset' | 'invite'
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_attempt_bucket_idx ON auth_attempt (bucket, purpose, at DESC);
