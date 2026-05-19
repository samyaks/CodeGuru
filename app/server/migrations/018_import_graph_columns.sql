-- 018_import_graph_columns.sql
-- Capture per-file import-graph metrics so file-ranking can factor in
-- structural centrality, not just filename + depth heuristics.
-- Both columns default 0 so old rows stay valid.

ALTER TABLE analysis_files
  ADD COLUMN IF NOT EXISTS inbound_degree INTEGER NOT NULL DEFAULT 0;

ALTER TABLE analysis_files
  ADD COLUMN IF NOT EXISTS outbound_degree INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_analysis_files_inbound
  ON analysis_files (analysis_id, inbound_degree DESC);
