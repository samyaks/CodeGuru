-- 023_job_invariants.sql
-- Takeoff intent substrate — jobs become the confirmation unit, invariants the
-- detection unit beneath them.
--
-- This migration reshapes the intent layer so that:
--   * jobs (map_jobs, already confirmable) are what a human confirms;
--   * intent_statements become "invariants" that hang UNDER jobs via a new
--     many-to-many join (statement_jobs), or stand alone as cross-cutting
--     "global guarantees" (scope='global');
--   * confirming a job can cascade-confirm its invariants (confirmed_via='job').
--
-- The prior derived feature roll-up (022_intent_features) is retired — jobs now
-- play that role directly. The existing ~430 line-level statements are the wrong
-- altitude and are archived (not deleted) so history is preserved; a fresh set
-- is generated under confirmed jobs by services/intent/generate-invariants.js.
--
-- Follows existing conventions (see 019_intent_substrate.sql): TEXT ids,
-- project_id -> deployments ON DELETE CASCADE, TEXT + CHECK for enums,
-- TIMESTAMPTZ timestamps. Forward-only + idempotent.

-- 1. Invariant altitude/provenance columns on intent_statements.
ALTER TABLE intent_statements
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'job';
ALTER TABLE intent_statements
  ADD COLUMN IF NOT EXISTS confirmed_via TEXT;
ALTER TABLE intent_statements
  ADD COLUMN IF NOT EXISTS confidence REAL;
ALTER TABLE intent_statements
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

-- CHECK constraints added separately + guarded so re-runs don't error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intent_statements_scope_check'
  ) THEN
    ALTER TABLE intent_statements
      ADD CONSTRAINT intent_statements_scope_check
      CHECK (scope IN ('job', 'global'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'intent_statements_confirmed_via_check'
  ) THEN
    ALTER TABLE intent_statements
      ADD CONSTRAINT intent_statements_confirmed_via_check
      CHECK (confirmed_via IN ('direct', 'job'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_intent_statements_project_scope
  ON intent_statements(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_intent_statements_project_archived
  ON intent_statements(project_id, archived);

-- 2. Many-to-many: an invariant can serve several jobs (a shared model, a
--    cross-job constraint). A multi-job invariant is also the future
--    boundary/collision signal for the collaboration layer.
CREATE TABLE IF NOT EXISTS statement_jobs (
  id           TEXT PRIMARY KEY,
  statement_id TEXT NOT NULL REFERENCES intent_statements(id) ON DELETE CASCADE,
  job_id       TEXT NOT NULL REFERENCES map_jobs(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (statement_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_statement_jobs_job ON statement_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_statement_jobs_statement ON statement_jobs(statement_id);

-- 3. Retire the derived feature roll-up — jobs now own that role.
DROP TABLE IF EXISTS intent_features;

-- 4. Archive the existing wrong-altitude statements (keep history; regenerated
--    under confirmed jobs). Idempotent: only flips currently-live rows.
UPDATE intent_statements SET archived = TRUE WHERE archived = FALSE;
