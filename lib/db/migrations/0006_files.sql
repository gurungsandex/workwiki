-- Object-store metadata. Files are never public: every fetch proxies an
-- access-checked route that issues a short-lived signed URL (spec §1, §9).

CREATE TABLE file_object (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key       text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  -- Sniffed from content, never trusted from the extension (spec §11).
  mime_type         text NOT NULL,
  byte_size         bigint NOT NULL,
  checksum_sha256   bytea NOT NULL,
  -- Enforced at upload time for image types rather than requested later.
  alt_text          text,
  scan_status       text NOT NULL DEFAULT 'pending'
                      CHECK (scan_status IN ('pending','clean','infected','skipped')),
  uploaded_by       uuid REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);

ALTER TABLE company_setting
  ADD CONSTRAINT company_setting_logo_fk
  FOREIGN KEY (logo_file_id) REFERENCES file_object(id);
