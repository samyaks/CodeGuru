-- 001_initial.sql
-- Port existing SQLite schema (pre-capture-layer) to Postgres.
-- Every pre-existing CREATE TABLE is folded together with the ALTER TABLE ADD COLUMN
-- migrations that accumulated in app/server/lib/db.js, so this file reproduces the
-- final combined state of the original app schema. The 4 capture tables and the
-- analyses rollup columns live in 002_capture_layer.sql.

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('pr', 'repo')),
  repo_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_number INTEGER,
  branch TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  ai_report JSONB,
  human_notes TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS review_files (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  diff TEXT,
  ai_comments JSONB,
  human_comments JSONB,
  severity TEXT CHECK (severity IN ('critical', 'warning', 'info', 'ok')),
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fix_prompts (
  id TEXT PRIMARY KEY,
  short_id TEXT NOT NULL UNIQUE,
  review_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  issue_category TEXT,
  issue_title TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  severity TEXT,
  code_snippet TEXT,
  reference_file_path TEXT,
  reference_snippet TEXT,
  related_files JSONB,
  full_prompt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fix_prompt_events (
  id TEXT PRIMARY KEY,
  fix_prompt_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('page_view', 'copy_prompt', 'deeplink_click', 'feedback_up', 'feedback_down')),
  deeplink_target TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (fix_prompt_id) REFERENCES fix_prompts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  analysis JSONB,
  context_files JSONB,
  completion_pct INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  user_id TEXT,
  features_summary JSONB
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  repo_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  framework TEXT,
  deploy_type TEXT,
  stack_info JSONB,
  build_plan JSONB,
  readiness_score INTEGER,
  readiness_categories JSONB,
  plan_steps JSONB,
  recommendation TEXT,
  description TEXT,
  analysis_data JSONB,
  features_summary JSONB,
  slug TEXT,
  social_summary TEXT,
  env_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggestions_count INTEGER DEFAULT 0,
  railway_project_id TEXT,
  railway_service_id TEXT,
  railway_environment_id TEXT,
  railway_deployment_id TEXT,
  railway_domain TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','analyzing','scored','planning','ready',
                      'deploying','building','live','failed','stopped')),
  live_url TEXT,
  error TEXT,
  build_logs TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deployed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deployments_slug ON deployments(slug);

CREATE TABLE IF NOT EXISTS build_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('prompt','note','decision','milestone','deploy_event','file')),
  title TEXT,
  content TEXT NOT NULL,
  metadata JSONB,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  service_type TEXT NOT NULL
    CHECK (service_type IN ('supabase', 'railway', 'vercel', 'github')),
  external_id TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  event TEXT NOT NULL,
  path TEXT,
  referrer TEXT,
  device TEXT,
  session_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events(project_id);
CREATE INDEX IF NOT EXISTS idx_project_events_event ON project_events(event);
CREATE INDEX IF NOT EXISTS idx_project_events_created ON project_events(created_at);
CREATE INDEX IF NOT EXISTS idx_project_events_session ON project_events(project_id, session_id);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'fix', 'feature', 'idea', 'perf')),
  category TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence JSONB,
  effort TEXT,
  context_file TEXT,
  cursor_prompt TEXT,
  affected_files JSONB,
  related_docs JSONB,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'done')),
  source TEXT NOT NULL CHECK (source IN ('static', 'ai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suggestions_project ON suggestions(project_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_priority ON suggestions(project_id, priority);
