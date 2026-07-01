-- 020_claims.sql
-- Takeoff intent substrate (Phase 7). Introduces `claims`: a lightweight
-- coordination primitive so humans and agents can signal "I'm working on this
-- intent / area" and see each other's gaps. Deferred from Phase 1 because
-- nothing in Phases 1-6 consumes it — only the MCP tools (claim_intent,
-- get_my_gaps) do.
--
-- Design notes:
-- - A claim targets EITHER a single statement (statement_id) OR a whole
--   feature_area; both nullable so either shape is valid. Callers should set
--   exactly one, but the schema doesn't force it (an area-wide claim with a
--   null statement_id is the common agent case).
-- - `status` is active | released. We keep released rows (audit trail / activity
--   feed) rather than deleting — mirrors the "human decisions are precious"
--   ethos of intent_statements.
-- - Mirrors existing conventions: TEXT primary key, project_id -> deployments,
--   statement_id -> intent_statements (both ON DELETE CASCADE), TEXT + CHECK
--   for enums, TIMESTAMPTZ timestamps.

CREATE TABLE IF NOT EXISTS claims (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  statement_id  TEXT REFERENCES intent_statements(id) ON DELETE CASCADE,
  feature_area  TEXT,
  claimant_type TEXT NOT NULL
    CHECK (claimant_type IN ('human', 'agent')),
  claimant_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'released')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at   TIMESTAMPTZ
);

-- Hot path: "is this statement/area already actively claimed?" and
-- "what does this claimant currently hold?"
CREATE INDEX IF NOT EXISTS idx_claims_project_status
  ON claims(project_id, status);

CREATE INDEX IF NOT EXISTS idx_claims_claimant
  ON claims(project_id, claimant_id, status);

-- At most one ACTIVE claim per (project, statement) and per (project, area) so
-- claim_intent has a clean conflict signal. Partial unique indexes only bind
-- active rows, leaving released history unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_claims_active_statement
  ON claims(project_id, statement_id)
  WHERE status = 'active' AND statement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_claims_active_area
  ON claims(project_id, feature_area)
  WHERE status = 'active' AND feature_area IS NOT NULL AND statement_id IS NULL;
