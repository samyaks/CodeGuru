-- 014_v2_security_fields.sql
-- Phase 1 of the Security feature: data-model scaffolding.
--
-- Design note: security is a TAG on a v2 Gap, not a fourth category. A gap
-- can be `broken` AND security-tagged, `missing_functionality` AND
-- security-tagged, etc. The category tells you what KIND of gap; the
-- security tag tells you whether it has security implications. Score and
-- UI lens are computed from that tag alone — see
-- `services/security/score.js` and the upcoming Phase 2 UI.
--
-- Columns added on `suggestions` (the v2 Gap row):
--   is_security             — denormalized lens flag, defaults FALSE so
--                             every existing row stays non-security.
--   security_severity       — null when is_security = FALSE; one of
--                             critical/high/medium/low otherwise.
--   cwe_id                  — Common Weakness Enumeration id where the
--                             detector knows it (e.g. 'CWE-89' for SQLi).
--                             Free-form text; we do not enumerate every
--                             CWE in a CHECK constraint.
--   security_detector       — name of the detector that flagged this row,
--                             for debugging false positives and for the
--                             "Detected by" tooltip in the Phase 2 UI.
--   security_fingerprint    — stable hash (file + line + detector) used
--                             to dedupe across analysis re-runs and to
--                             upgrade an existing non-security gap to
--                             security when the same finding overlaps it.
--                             Nullable: only security rows carry one.
--
-- Constraint: when is_security = TRUE, security_severity MUST be set.
-- The check is written so the inverse direction (severity without
-- is_security) also fails — keeping the two columns in sync at the DB
-- level so a careless caller cannot ship a half-tagged row.
--
-- Column added on `deployments` (the v2 Project row):
--   security_score          — cached 0–100 score so the project header
--                             and listings don't have to recompute on
--                             every read. Recomputed at the end of the
--                             takeoff pipeline.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS is_security BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS security_severity TEXT
    CHECK (security_severity IN ('critical', 'high', 'medium', 'low')),
  ADD COLUMN IF NOT EXISTS cwe_id TEXT,
  ADD COLUMN IF NOT EXISTS security_detector TEXT,
  ADD COLUMN IF NOT EXISTS security_fingerprint TEXT;

-- Two-way consistency: is_security ↔ security_severity. Wrapped in a
-- DO block so re-runs under FORCE_MIGRATE=1 don't error on duplicate
-- constraint name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suggestions_security_severity_consistency'
  ) THEN
    ALTER TABLE suggestions
      ADD CONSTRAINT suggestions_security_severity_consistency
      CHECK (
        (is_security = FALSE AND security_severity IS NULL)
        OR (is_security = TRUE  AND security_severity IS NOT NULL)
      );
  END IF;
END $$;

-- Hot path: GET /security-summary filters on `is_security = TRUE` for a
-- single project and orders by severity. Partial index keeps the index
-- small (security gaps are a minority of rows on most projects).
CREATE INDEX IF NOT EXISTS idx_suggestions_security
  ON suggestions (project_id, security_severity)
  WHERE is_security = TRUE;

-- Dedupe path: `services/security/persist.js#applySecurityFindings`
-- looks up `(project_id, security_fingerprint)` to decide whether a
-- finding is new, an exact re-detection (skip), or an upgrade target
-- on an overlapping non-security gap.
CREATE INDEX IF NOT EXISTS idx_suggestions_security_fingerprint
  ON suggestions (project_id, security_fingerprint)
  WHERE security_fingerprint IS NOT NULL;

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS security_score INTEGER
    CHECK (security_score IS NULL OR (security_score >= 0 AND security_score <= 100));
