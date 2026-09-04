-- Invite redemption.
--
-- 0002 created `invite` with revocation and a use counter but no record of WHO
-- redeemed it or WHEN. Both are needed: the audit trail should show how an
-- account came to exist, and a single-use link must be provably consumed rather
-- than merely counted.

ALTER TABLE invite
  ADD COLUMN redeemed_at timestamptz,
  ADD COLUMN redeemed_by uuid REFERENCES app_user(id);

CREATE INDEX invite_live_idx
  ON invite (email)
  WHERE revoked_at IS NULL AND redeemed_at IS NULL;
