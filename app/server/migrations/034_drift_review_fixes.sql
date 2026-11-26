-- 034_drift_review_fixes.sql
-- Fixes from a second review of Milestone 5.
--
-- 1. Checks and decisions are keyed by the lower-case repo name. GitHub names
--    are case-insensitive, and a webhook can spell a repo differently from the
--    URL a project was set up with, so the two never found each other.
--    Rows that only differ by case are folded into one (the newest is kept).
-- 2. drift_decisions.confirmed_by_name: who confirmed a recommendation, so
--    the PR check can say so.
-- 3. An index for the accepted-intent lookup across a repo's projects.

DELETE FROM pr_checks p
 USING (
   SELECT ctid, ROW_NUMBER() OVER (
            PARTITION BY LOWER(repo_full_name), pr_number, head_sha
            ORDER BY (repo_full_name = LOWER(repo_full_name)) DESC, updated_at DESC
          ) AS rn
     FROM pr_checks
 ) d
 WHERE p.ctid = d.ctid AND d.rn > 1;

UPDATE pr_checks SET repo_full_name = LOWER(repo_full_name)
 WHERE repo_full_name <> LOWER(repo_full_name);

-- At most one decision runs per PR, whatever the spelling.
UPDATE drift_decisions SET state = 'failed', error = 'interrupted', updated_at = now()
 WHERE id IN (
   SELECT id FROM (
     SELECT id, ROW_NUMBER() OVER (
              PARTITION BY LOWER(repo_full_name), pr_number ORDER BY updated_at DESC
            ) AS rn
       FROM drift_decisions WHERE state = 'working'
   ) w WHERE w.rn > 1
 );

UPDATE drift_decisions SET repo_full_name = LOWER(repo_full_name)
 WHERE repo_full_name <> LOWER(repo_full_name);

ALTER TABLE drift_decisions ADD COLUMN IF NOT EXISTS confirmed_by_name TEXT;

CREATE INDEX IF NOT EXISTS pr_checks_installation_idx ON pr_checks (repo_full_name, installation_id, pr_number);
