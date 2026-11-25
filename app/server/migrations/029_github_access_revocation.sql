-- 029_github_access_revocation.sql
-- Follow-up to 025 (GitHub App access).
--
-- github_repo_access.github_user_id: the GitHub account that authorized the
-- listing, so a revoked authorization (github_app_authorization: revoked)
-- drops its grants.
--
-- deployments.repo_private: whether the repo was private at the last scan.
-- The unauthenticated public story (/api/story/:slug) hides private repos.
-- NULL means scanned before this column existed.

ALTER TABLE github_repo_access
  ADD COLUMN IF NOT EXISTS github_user_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_github_repo_access_github_user
  ON github_repo_access (github_user_id);

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS repo_private BOOLEAN;
