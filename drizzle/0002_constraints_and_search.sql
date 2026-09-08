-- Constraints, indexes and grants the ORM cannot express.
--
-- Nothing here names a company's vocabulary. Every CHECK below constrains
-- *platform* vocabulary — a lifecycle state, a rule effect, a visibility —
-- which is fixed by this codebase. Department, role, employee type and
-- location remain rows an admin populates, with no CHECK anywhere.

-- One company, one instance row.
ALTER TABLE "instance" ADD CONSTRAINT "instance_singleton" CHECK ("id" = 1);
--> statement-breakpoint

-- Platform lifecycle vocabulary.
ALTER TABLE "user" ADD CONSTRAINT "user_status_known"
  CHECK ("status" IN ('invited', 'active', 'deactivated'));
--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_state_known"
  CHECK ("state" IN ('draft', 'published', 'archived'));
--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_state_known"
  CHECK ("state" IN ('draft', 'published', 'archived'));
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_state_known"
  CHECK ("state" IN ('draft', 'published', 'archived'));
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_kind_known"
  CHECK ("kind" IN ('page', 'statutory_posting'));
--> statement-breakpoint
ALTER TABLE "access_rule" ADD CONSTRAINT "access_rule_effect_known"
  CHECK ("effect" IN ('allow', 'deny'));
--> statement-breakpoint
ALTER TABLE "access_rule" ADD CONSTRAINT "access_rule_locked_visibility_known"
  CHECK ("visibility_when_locked" IN ('hidden', 'teaser', 'preview'));
--> statement-breakpoint
ALTER TABLE "access_rule" ADD CONSTRAINT "access_rule_target_known"
  CHECK ("target_type" IN ('section', 'topic', 'page'));
--> statement-breakpoint
ALTER TABLE "issue_report" ADD CONSTRAINT "issue_report_state_known"
  CHECK ("state" IN ('open', 'resolved', 'dismissed'));
--> statement-breakpoint

-- Resolving or dismissing a report requires a reason, and that reason goes
-- back to the reporter. The database refuses a closure without one.
ALTER TABLE "issue_report" ADD CONSTRAINT "issue_report_closure_has_reason"
  CHECK ("state" = 'open' OR ("outcome" IS NOT NULL AND length(btrim("outcome")) > 0));
--> statement-breakpoint

-- A summary block cannot exist unattached: it must point at the source it
-- summarises. Publishing one stamps a byline; a statutory posting is confirmed
-- rather than summarised, and carries the other byline kind.
ALTER TABLE "block" ADD CONSTRAINT "summary_block_has_source"
  CHECK (
    "kind" <> 'summary'
    OR "source_block_id" IS NOT NULL
    OR "source_file_id" IS NOT NULL
    OR "source_url" IS NOT NULL
  );
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "published_block_has_byline"
  CHECK ("published_at" IS NULL OR "byline_kind" IN ('summarised', 'confirmed'));
--> statement-breakpoint

-- Denies are rare and are evaluated first.
CREATE INDEX "access_rule_deny_idx" ON "access_rule" ("target_type", "target_id")
  WHERE "effect" = 'deny' AND "archived_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "access_rule_live_idx" ON "access_rule" ("target_type", "target_id")
  WHERE "archived_at" IS NULL;
--> statement-breakpoint

-- Search: ranking from ts_rank_cd over title + teaser + flattened block text,
-- typo tolerance from trigram similarity on the title. The access filter is a
-- predicate in the same query, never a second pass over the results.
ALTER TABLE "page" ADD COLUMN "search_text" text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX "page_search_idx" ON "page"
  USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("teaser", '') || ' ' || coalesce("search_text", '')));
--> statement-breakpoint
CREATE INDEX "page_title_trgm_idx" ON "page" USING GIN ("title" gin_trgm_ops);
--> statement-breakpoint

-- Foreign keys the generator could not order.
ALTER TABLE "org_node" ADD CONSTRAINT "org_node_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "org_node"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_source_block_fk"
  FOREIGN KEY ("source_block_id") REFERENCES "block"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_source_file_fk"
  FOREIGN KEY ("source_file_id") REFERENCES "file"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "instance" ADD CONSTRAINT "instance_logo_file_fk"
  FOREIGN KEY ("logo_file_id") REFERENCES "file"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_help_contact_fk"
  FOREIGN KEY ("help_contact_card_id") REFERENCES "contact_card"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_help_contact_fk"
  FOREIGN KEY ("help_contact_card_id") REFERENCES "contact_card"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_help_contact_fk"
  FOREIGN KEY ("help_contact_card_id") REFERENCES "contact_card"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- The audit log is append-only. This is enforced in the database, not by
-- convention: there is no update path and no delete path, for anyone.
CREATE OR REPLACE FUNCTION "audit_event_is_append_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only: % is not permitted', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "audit_event_no_update" BEFORE UPDATE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_is_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_event_no_delete" BEFORE DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_is_append_only"();
--> statement-breakpoint
CREATE TRIGGER "audit_event_no_truncate" BEFORE TRUNCATE ON "audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_event_is_append_only"();
--> statement-breakpoint

-- Re-acknowledgment is a new row against a new version, never an update.
CREATE OR REPLACE FUNCTION "acknowledgment_is_append_only"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'acknowledgment is append-only: % is not permitted', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "acknowledgment_no_update" BEFORE UPDATE ON "acknowledgment"
  FOR EACH ROW EXECUTE FUNCTION "acknowledgment_is_append_only"();
