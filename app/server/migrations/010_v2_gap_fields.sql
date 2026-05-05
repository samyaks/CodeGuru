-- 010_v2_gap_fields.sql
-- v2 migration prep (Phase 0): add Gap fields alongside the existing
-- Suggestions schema. We keep v1 columns (`category`, `status`, `cursor_prompt`)
-- intact so /api/suggestions endpoints continue to work, and add v2-prefixed
-- columns the new /api/v2 endpoints will populate. v1 and v2 coexist until
-- Phase 6b cuts over.

ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS v2_category TEXT
    CHECK (v2_category IN ('broken', 'missing_functionality', 'missing_infrastructure')),
  ADD COLUMN IF NOT EXISTS v2_status TEXT
    DEFAULT 'untriaged'
    CHECK (v2_status IN ('untriaged', 'in_progress', 'shipped', 'rejected')),
  ADD COLUMN IF NOT EXISTS verification TEXT
    CHECK (verification IN ('pending', 'verified', 'partial')),
  ADD COLUMN IF NOT EXISTS v2_refined_from_id TEXT,
  ADD COLUMN IF NOT EXISTS v2_rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS v2_committed_at TIMESTAMPTZ;

-- Backfill v2_category for existing rows. Mapping:
-- - severity high + tag in ('security','bug','deployment') → 'broken'
-- - severity high|medium tied to a persona job             → 'missing_functionality'
-- - infra-style (no fitness check yet, leave null)         → null (set by Phase 3)
-- For Phase 0 we just default everything to 'broken' so the column is non-null
-- once Phase 3 enforces NOT NULL. Rows can be reclassified at any time.
UPDATE suggestions
   SET v2_category = COALESCE(v2_category, 'broken'),
       v2_status   = COALESCE(v2_status,   'untriaged');

CREATE INDEX IF NOT EXISTS idx_suggestions_v2_status   ON suggestions(project_id, v2_status);
CREATE INDEX IF NOT EXISTS idx_suggestions_v2_category ON suggestions(project_id, v2_category);
