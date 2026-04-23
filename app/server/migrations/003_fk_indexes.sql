-- 003_fk_indexes.sql — indexes on FK/hot-path columns.
-- Safe to run on populated tables; CREATE INDEX IF NOT EXISTS is idempotent.
-- Addresses R1 Major: hot-path DAO reads filtered by FK columns with no index
-- caused sequential scans as rows grow.

CREATE INDEX IF NOT EXISTS idx_review_files_review_id
  ON review_files(review_id);

CREATE INDEX IF NOT EXISTS idx_fix_prompts_review_id
  ON fix_prompts(review_id);

CREATE INDEX IF NOT EXISTS idx_fix_prompt_events_fix_prompt_id
  ON fix_prompt_events(fix_prompt_id);

-- Compound: most reads list a project's entries newest-first.
CREATE INDEX IF NOT EXISTS idx_build_entries_project_id
  ON build_entries(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_services_project_id
  ON project_services(project_id);

-- Compound: user dashboards list "my deployments" newest-first.
CREATE INDEX IF NOT EXISTS idx_deployments_user_id
  ON deployments(user_id, created_at DESC);

-- Compound: user dashboards list "my analyses" newest-first.
CREATE INDEX IF NOT EXISTS idx_analyses_user_id
  ON analyses(user_id, created_at DESC);

-- skipped: already indexed in 001 as idx_project_events_project on project_events(project_id)
-- (a separate idx_project_events_created also exists; planner can combine them).

-- skipped: already indexed in 001 as idx_suggestions_project on suggestions(project_id)
-- (the FK column is project_id, not deployment_id; schema references deployments(id)
-- through project_id).
