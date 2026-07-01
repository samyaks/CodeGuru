-- 019_intent_substrate.sql
-- Takeoff intent substrate (Phase 1). Introduces intent_statements: the
-- first-class "what this app is meant to do" object. Gaps, satisfaction, and
-- (later) agent claims are computed as views over these statements.
--
-- Design notes:
-- - One table for now. Code links live inline as a JSONB array
--   (`links: [{ file_path, symbol, link_status }]`) rather than a separate
--   table — links are re-derived deterministically from the structure
--   extractor on every analysis, so they're a disposable cache, not
--   precious relational data. If per-file querying later needs it, they can
--   be split into intent_code_links without a painful data backfill.
-- - The satisfaction baseline (code_hash / satisfied / last_checked_at) is
--   folded in here rather than a 1:1 satisfaction_cache table.
-- - `status = rejected` is kept (never hard-deleted): a rejection is a human
--   decision. Bootstrap suppresses re-proposing rejected statements and they
--   can be restored later.
-- - Mirrors existing conventions: TEXT primary key, project_id -> deployments,
--   TEXT + CHECK for enums, TIMESTAMPTZ timestamps. No behavior change: this
--   phase is schema only.

CREATE TABLE IF NOT EXISTS intent_statements (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  kind         TEXT NOT NULL
    CHECK (kind IN ('behavior', 'constraint', 'non_goal')),
  status       TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'confirmed', 'rejected')),
  source       TEXT NOT NULL DEFAULT 'inferred'
    CHECK (source IN ('inferred', 'human')),
  feature_area TEXT,
  -- [{ file_path: string, symbol: string|null, link_status: 'healthy'|'needs_relink'|'broken' }]
  links        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Satisfaction baseline (populated on confirm in Phase 4, refreshed in Phase 6)
  code_hash       TEXT,
  satisfied       BOOLEAN,
  last_checked_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_intent_statements_project_area
  ON intent_statements(project_id, feature_area);

CREATE INDEX IF NOT EXISTS idx_intent_statements_project_status
  ON intent_statements(project_id, status);
