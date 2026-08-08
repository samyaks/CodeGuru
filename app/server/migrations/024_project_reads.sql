-- 024_project_reads.sql
-- "The Read" — after analysis the app drafts a prose read of the project:
-- exactly three claims (objective / audience / core_job), each with
-- confidence + file evidence, plus one derived "next thing to build"
-- (title / why / builder prompt). Users settle claims by correcting them;
-- a settled claim is a human decision and survives re-analysis.
--
-- Two tables:
--   * project_reads — one row per project: the derived next-thing plus the
--     Pro-stub unlock flag gating the builder prompt.
--   * read_claims — the three slotted claims. UNIQUE (project_id, slot)
--     makes the slot the identity, so re-drafting is an upsert; settled
--     rows are left untouched by the pipeline (see db.js readClaims).
--
-- Follows existing conventions (019/023): TEXT ids, project_id ->
-- deployments ON DELETE CASCADE, TEXT + CHECK for enums, TIMESTAMPTZ
-- timestamps, JSONB for re-derivable evidence. Forward-only + idempotent.

CREATE TABLE IF NOT EXISTS project_reads (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL UNIQUE REFERENCES deployments(id) ON DELETE CASCADE,
  next_title    TEXT,
  next_why      TEXT,
  next_prompt   TEXT,
  next_category TEXT,
  read_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  drafted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS read_claims (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  slot        TEXT NOT NULL
    CHECK (slot IN ('objective', 'audience', 'core_job')),
  text        TEXT NOT NULL,
  confidence  REAL,
  status      TEXT NOT NULL DEFAULT 'drafted'
    CHECK (status IN ('drafted', 'settled')),
  source      TEXT NOT NULL DEFAULT 'inferred'
    CHECK (source IN ('inferred', 'human')),
  -- [{ filePath: string, symbol: string|null, note: string }]
  evidence    JSONB NOT NULL DEFAULT '[]',
  -- null | { question, options: [{ id, label, detail, claimText }] }
  alternative JSONB,
  settled_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ,
  UNIQUE (project_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_read_claims_project ON read_claims(project_id);
