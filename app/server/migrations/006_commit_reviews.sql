-- Per-push / per-head-commit AI reviews linked to Takeoff deployments (projects).

CREATE TABLE IF NOT EXISTS commit_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  before_sha TEXT,
  ref TEXT,
  pusher_login TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  ai_report JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commit_reviews_project_sha
  ON commit_reviews(project_id, commit_sha);

CREATE INDEX IF NOT EXISTS idx_commit_reviews_project_created
  ON commit_reviews(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commit_reviews_status_updated
  ON commit_reviews(status, updated_at);
