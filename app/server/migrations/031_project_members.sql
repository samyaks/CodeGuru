-- 031_project_members.sql
-- Takeoff Milestone 2: projects, members, invites.
--
-- A project (deployments row) has its owner (deployments.user_id) plus the
-- members in project_members. Every member sees everything; role labels
-- (creator, builder) only set defaults and never gate access.
--
-- project_invites: one row per invite, by email or GitHub login. Only a
-- SHA-256 of the invite token is stored; the token itself is in the link.
--
-- recommendations: a committing action (one that writes to the repo) taken
-- by a member without GitHub write access. A member with write access
-- confirms it, which runs the action.
--
-- user_github_links: the GitHub account a Takeoff user connected through the
-- Takeoff App, used to check their write access before a committing action.

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  labels TEXT[] NOT NULL DEFAULT '{}',
  invited_by TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CHECK (labels <@ ARRAY['creator', 'builder']::TEXT[])
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);

CREATE TABLE IF NOT EXISTS project_invites (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  email TEXT,
  github_login TEXT,
  github_user_id BIGINT,                         -- the account behind github_login when invited (logins can be renamed and reused)
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  invited_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by TEXT,
  revoked_at TIMESTAMPTZ,
  last_link_sent_at TIMESTAMPTZ,
  CHECK ((email IS NULL) <> (github_login IS NULL))
);

-- For databases that ran an earlier draft of this migration.
ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS github_user_id BIGINT;
ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS invited_by_name TEXT;
ALTER TABLE project_invites ADD COLUMN IF NOT EXISTS last_link_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_project_invites_project ON project_invites (project_id, created_at DESC);
-- One open invite per address per project.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invites_open_email
  ON project_invites (project_id, LOWER(email))
  WHERE email IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_invites_open_github
  ON project_invites (project_id, LOWER(github_login))
  WHERE github_login IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirming', 'confirmed', 'dismissed', 'failed')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  result JSONB,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_recommendations_project_pending
  ON recommendations (project_id, created_at DESC) WHERE status IN ('pending', 'confirming');

CREATE TABLE IF NOT EXISTS user_github_links (
  user_id TEXT PRIMARY KEY,
  github_user_id BIGINT NOT NULL,
  github_login TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_github_links_github_user ON user_github_links (github_user_id);
