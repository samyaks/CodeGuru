-- 008_commit_context_unique.sql
-- Replace the non-unique partial index from 007 with a UNIQUE partial index so
-- (project_id, source_commit_sha) is enforced at the DB level. Defends against
-- duplicate AI drafts if a commit_review is ever re-run after markCompleted.
--
-- Defensive dedupe runs first in case the previous (non-unique) index let stray
-- duplicates through during early testing — keep the most recent row per
-- (project_id, source_commit_sha) pair.

DELETE FROM build_entries
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY project_id, source_commit_sha
      ORDER BY created_at DESC, id DESC
    ) AS rn
    FROM build_entries
    WHERE source_commit_sha IS NOT NULL
  ) ranked
  WHERE rn > 1
);

DROP INDEX IF EXISTS idx_build_entries_source_commit;

CREATE UNIQUE INDEX IF NOT EXISTS idx_build_entries_source_commit_unique
  ON build_entries(project_id, source_commit_sha)
  WHERE source_commit_sha IS NOT NULL;
