-- 025_github_app_access.sql
-- Private-repo access through the Takeoff GitHub App.
--
-- github_repo_access: one row per repo a user can read through an app
-- installation, captured at install/authorize time from
-- GET /user/installations/:id/repositories (the intersection of what the
-- installation covers and what the user can see). A private-repo scan needs a
-- row here. Nothing secret is stored — installation tokens are minted on
-- demand from the app's private key.
--
-- deployments.github_installation_id: the installation a project reads
-- through, so re-analyze and background commit fetches can mint a token
-- without the user present. NULL means public repo (server token).

CREATE TABLE IF NOT EXISTS github_repo_access (
  user_id TEXT NOT NULL,
  installation_id BIGINT NOT NULL,
  repo_id BIGINT NOT NULL,
  repo_full_name TEXT NOT NULL,
  private BOOLEAN NOT NULL DEFAULT false,
  account_login TEXT,
  -- The GitHub account that authorized the listing, so a revoked
  -- authorization (github_app_authorization: revoked) drops its grants.
  github_user_id BIGINT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_github_repo_access_github_user
  ON github_repo_access (github_user_id);

CREATE INDEX IF NOT EXISTS idx_github_repo_access_user_repo
  ON github_repo_access (user_id, LOWER(repo_full_name));

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;

-- deployments.repo_private: whether the repo was private at the last scan.
-- The unauthenticated public story (/api/story/:slug) hides private repos.
-- NULL means scanned before this column existed.
ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS repo_private BOOLEAN;
