-- 033_drift_decisions.sql
-- Milestone 5: decisions on PRs that drift from takeoff.yaml.
--
-- A reviewer either accepts the drift (Takeoff commits the takeoff.yaml
-- change to the PR's branch, and the check runs again) or sends it back with
-- a note (posted on the PR, and readable by `takeoff notes` for the branch).
-- A member without write access leaves a recommendation instead; the
-- decision waits until someone with write access confirms it.
--
-- yaml_sha256/base_yaml_sha256: the takeoff.yaml text an accept committed,
-- and the base branch's at that time. While the PR still has exactly that
-- file on both sides, the PR check trusts the accepted intent.

CREATE TABLE IF NOT EXISTS drift_decisions (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  repo_full_name    TEXT NOT NULL,
  pr_number         INTEGER NOT NULL,
  head_sha          TEXT NOT NULL,           -- the checked commit the decision is about
  branch            TEXT,                    -- the PR's head branch
  type              TEXT NOT NULL CHECK (type IN ('accepted', 'sent_back')),
  state             TEXT NOT NULL DEFAULT 'working'
                      CHECK (state IN ('working', 'done', 'waiting_for_write', 'failed', 'dismissed')),
  note              TEXT,
  edits             JSONB,
  agreement_id      TEXT,
  actor_user_id     TEXT NOT NULL,
  actor_name        TEXT,
  confirmed_by      TEXT,
  recommendation_id TEXT,
  commit_sha        TEXT,
  commit_url        TEXT,
  yaml_sha256       TEXT,
  base_yaml_sha256  TEXT,
  comment_id        BIGINT,
  comment_url       TEXT,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS drift_decisions_pr_idx ON drift_decisions (repo_full_name, pr_number, created_at DESC);
CREATE INDEX IF NOT EXISTS drift_decisions_project_idx ON drift_decisions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drift_decisions_accepted_idx ON drift_decisions (repo_full_name, pr_number, yaml_sha256)
  WHERE type = 'accepted' AND state = 'done';
-- One decision runs at a time per PR.
CREATE UNIQUE INDEX IF NOT EXISTS drift_decisions_one_working ON drift_decisions (repo_full_name, pr_number)
  WHERE state = 'working';

-- Closed PRs leave the "needs review" list (set from pull_request webhooks).
ALTER TABLE pr_checks ADD COLUMN IF NOT EXISTS pr_closed_at TIMESTAMPTZ;
