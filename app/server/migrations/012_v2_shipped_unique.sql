-- 012_v2_shipped_unique.sql
-- Followup #4 from docs/v2-reference/followups.md (code-review C2):
-- prevent duplicate shipped_items rows when concurrent webhook deliveries
-- land for the same commit. The check-then-insert in shipped-runner is not
-- atomic, so this UNIQUE index is the durable guard.
--
-- The non-unique idx_shipped_items_commit from migration 011 is replaced by
-- this index (which serves the same lookup just as well, and adds the
-- uniqueness invariant).

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipped_items_project_commit_uniq
  ON shipped_items (project_id, commit_sha);

DROP INDEX IF EXISTS idx_shipped_items_commit;
