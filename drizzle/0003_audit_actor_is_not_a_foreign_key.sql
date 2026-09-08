-- The audit log is append-only, and `ON DELETE SET NULL` is an UPDATE.
--
-- With the foreign key in place, purging a user tried to null out the actor on
-- every event they ever caused — which the append-only trigger correctly
-- refused, making the purge impossible. That is the wrong trade: an audit row
-- must not be rewritten because the actor was later purged. The column keeps
-- the id and becomes a plain reference, so history survives the purge and the
-- admin UI resolves the name where it still can.
ALTER TABLE "audit_event" DROP CONSTRAINT IF EXISTS "audit_event_actor_user_id_user_id_fk";
