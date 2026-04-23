-- 002_capture_layer.sql
-- Adds the analysis capture layer: 4 new tables for storing per-file content,
-- chunking, LLM call accounting, and timeline events, plus 11 rollup columns on
-- analyses for quick summary queries. All statements are idempotent.

CREATE TABLE IF NOT EXISTS analysis_files (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  path TEXT NOT NULL,
  sha TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  score INTEGER,
  depth INTEGER,
  tier TEXT NOT NULL DEFAULT 'tree'
    CHECK (tier IN ('tree', 'skeleton', 'full', 'chunked')),
  content TEXT,
  skeleton TEXT,
  content_tokens INTEGER,
  skeleton_tokens INTEGER,
  fetched_at TIMESTAMPTZ,
  skip_reason TEXT,
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE,
  UNIQUE (analysis_id, path)
);

CREATE INDEX IF NOT EXISTS idx_analysis_files_analysis ON analysis_files(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_files_tier ON analysis_files(analysis_id, tier);
CREATE INDEX IF NOT EXISTS idx_analysis_files_score ON analysis_files(analysis_id, score DESC);

CREATE TABLE IF NOT EXISTS analysis_file_chunks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (file_id) REFERENCES analysis_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_file_chunks_file ON analysis_file_chunks(file_id, ordinal);

CREATE TABLE IF NOT EXISTS analysis_llm_calls (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd DOUBLE PRECISION DEFAULT 0,
  duration_ms INTEGER,
  target_path TEXT,
  files_used JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_llm_calls_analysis ON analysis_llm_calls(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_llm_calls_phase ON analysis_llm_calls(analysis_id, phase);
CREATE INDEX IF NOT EXISTS idx_analysis_llm_calls_analysis_created ON analysis_llm_calls(analysis_id, created_at);

CREATE TABLE IF NOT EXISTS analysis_events (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT,
  path TEXT,
  bytes INTEGER,
  tokens INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analysis_events_analysis ON analysis_events(analysis_id, created_at);

-- Rollup columns on analyses. Added here (not 001) because they are part of the
-- capture layer's accounting surface. IF NOT EXISTS keeps this re-runnable.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS file_count INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS tree_total_bytes INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS tree_estimated_tokens INTEGER;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS tree_truncated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS ingested_file_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS ingested_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS ingested_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS llm_call_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS llm_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS llm_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS llm_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0;
