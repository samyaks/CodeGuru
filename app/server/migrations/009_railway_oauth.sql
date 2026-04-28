-- 009_railway_oauth.sql
-- Add Railway OAuth state columns to the analyses table so each analysis can
-- be associated with a connected Railway account/project for live deployment
-- status. Tokens are scoped per-analysis (no CodeGuru login required).

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS railway_access_token TEXT,
  ADD COLUMN IF NOT EXISTS railway_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS railway_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS railway_project_id TEXT,
  ADD COLUMN IF NOT EXISTS railway_service_id TEXT,
  ADD COLUMN IF NOT EXISTS railway_environment_id TEXT;
