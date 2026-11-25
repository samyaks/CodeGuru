-- 029_pr_checks.sql
-- One row per PR head commit checked by the Takeoff PR verdict (Milestone 4).
--
-- services/verdict/runner.js claims a row before it calls the model, so a
-- webhook delivered twice runs the (paid) check once; a failed or stale row can
-- be claimed again by a redelivery or by Re-run on the check. comment_id is the
-- single Takeoff comment on the PR, edited in place on every push.

CREATE TABLE IF NOT EXISTS pr_checks (
  repo_full_name TEXT NOT NULL,
  pr_number      INTEGER NOT NULL,
  head_sha       TEXT NOT NULL,
  project_id     TEXT REFERENCES deployments(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'running',  -- running | done | failed | superseded
  verdict        TEXT,                             -- matches | drifts | needs_decision
  result_json    JSONB,
  comment_id     BIGINT,
  check_run_id   BIGINT,
  model          TEXT,
  error          TEXT,
  attempts       INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  PRIMARY KEY (repo_full_name, pr_number, head_sha)
);

CREATE INDEX IF NOT EXISTS pr_checks_pr_idx ON pr_checks (repo_full_name, pr_number, updated_at DESC);
CREATE INDEX IF NOT EXISTS pr_checks_check_run_idx ON pr_checks (check_run_id) WHERE check_run_id IS NOT NULL;
