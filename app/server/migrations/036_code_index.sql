-- 036_code_index.sql
-- Milestone 8, PR 2: Takeoff's stored copy of each project's default branch,
-- so Ask can answer code questions without reading the repo again.
--
-- One index per project (a project has one repo). The text is stored with
-- secrets already redacted; never-readable files (.env, keys, ...) and
-- files over 512 KB keep their path but no text (skipped_reason says why).
-- No model is used to build or update any of this.
--
-- status on the repo row:
--   building   a full build is running (lease_until says until when it may hold it)
--   ready      the index matches indexed_sha
--   behind     a push arrived that isn't applied yet
--   failed     the last build or update failed (error says why)
--   too_large  over the limits; Ask answers from the plan and single reads
--
-- Everything goes with the project (ON DELETE CASCADE), and the code
-- deletes the index when the GitHub App loses access to the repo.

CREATE TABLE IF NOT EXISTS code_index_repos (
  project_id      TEXT PRIMARY KEY REFERENCES deployments(id) ON DELETE CASCADE,
  repo            TEXT NOT NULL,           -- owner/repo, lower case
  branch          TEXT NOT NULL,
  indexed_sha     TEXT,
  status          TEXT NOT NULL DEFAULT 'building'
                    CHECK (status IN ('building', 'ready', 'behind', 'failed', 'too_large')),
  file_count      INTEGER NOT NULL DEFAULT 0,
  text_bytes      BIGINT NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  lease_until     TIMESTAMPTZ,
  lease_token     TEXT,                    -- which worker holds the lease
  last_full_at    TIMESTAMPTZ,
  last_update_at  TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS code_index_files (
  project_id      TEXT NOT NULL REFERENCES code_index_repos(project_id) ON DELETE CASCADE,
  path            TEXT NOT NULL,
  blob_sha        TEXT,
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  language        TEXT,
  content         TEXT,                    -- NULL when skipped_reason is set
  skipped_reason  TEXT,                    -- never_readable | too_large | binary | minified | private_key
  redactions      INTEGER NOT NULL DEFAULT 0,
  -- 'simple' keeps identifiers as written (no stemming). Punctuation is
  -- turned into spaces first, so pay.charge and src/pay.js are searchable by
  -- each part. Only the first 256 K characters are searched, which keeps
  -- every row under tsvector's size limit.
  tsv             TSVECTOR GENERATED ALWAYS AS (
                    to_tsvector('simple', regexp_replace(
                      path || ' ' || left(coalesce(content, ''), 262144), '[^[:alnum:]_]+', ' ', 'g'))
                  ) STORED,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, path)
);

CREATE INDEX IF NOT EXISTS idx_code_index_files_tsv
  ON code_index_files USING GIN (tsv);

CREATE TABLE IF NOT EXISTS code_index_symbols (
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  kind        TEXT NOT NULL,               -- function | class | route | type | const
  line        INTEGER NOT NULL,
  FOREIGN KEY (project_id, path) REFERENCES code_index_files(project_id, path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_code_index_symbols_lookup
  ON code_index_symbols (project_id, lower(symbol));
CREATE INDEX IF NOT EXISTS idx_code_index_symbols_path
  ON code_index_symbols (project_id, path);

-- What each file imports, as written (so edges can be re-resolved when
-- files are added or removed without reading every file again).
CREATE TABLE IF NOT EXISTS code_index_import_specs (
  project_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  specs       JSONB NOT NULL,
  PRIMARY KEY (project_id, path),
  FOREIGN KEY (project_id, path) REFERENCES code_index_files(project_id, path) ON DELETE CASCADE
);

-- Resolved edges inside the repo: from_path imports to_path.
CREATE TABLE IF NOT EXISTS code_index_imports (
  project_id  TEXT NOT NULL,
  from_path   TEXT NOT NULL,
  to_path     TEXT NOT NULL,
  PRIMARY KEY (project_id, from_path, to_path),
  FOREIGN KEY (project_id, from_path) REFERENCES code_index_files(project_id, path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_code_index_imports_to
  ON code_index_imports (project_id, to_path);
