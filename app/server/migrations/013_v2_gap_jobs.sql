-- 013_v2_gap_jobs.sql
-- Phase 7 (post-migration polish): link v2 gaps to product-map jobs/personas.
--
-- Why a JSONB column instead of a join table?
--   - The link is dependent on the *current* product map. When the user
--     edits personas/jobs, links may need re-computing — but old gap rows
--     should keep working without referential integrity blocking deletes.
--   - The link payload is a small array per gap (typically 1-3 jobs); a
--     join table would 3x the row count for the same data.
--   - JSONB matches the rest of the v2 model (entities, edges, scores all
--     live in JSONB on `product_maps`).
--
-- Shape of v2_job_links:
--   [
--     {
--       "jobId": "uuid",
--       "personaId": "uuid",
--       "confidence": 0.0..1.0,
--       "reason": "short explanation",
--       "method": "claude" | "heuristic" | "synthetic"
--     }
--   ]
--
-- `null` means "not yet linked"; `[]` means "linked, no jobs apply".
-- The gap-job-linker service treats `null` as a backfill target;
-- `[]` is final until the next regenerate.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS v2_job_links JSONB;

-- Lets us efficiently find rows that still need linking.
CREATE INDEX IF NOT EXISTS idx_suggestions_v2_job_links_null
  ON suggestions (project_id)
  WHERE v2_job_links IS NULL;
