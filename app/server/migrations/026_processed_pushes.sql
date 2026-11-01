-- 026_processed_pushes.sql
-- One row per (project, push): the first webhook delivery of a push claims it.
--
-- A push can arrive more than once — from a per-repo hook and from the Takeoff
-- GitHub App while both cover a repo, or from a manual redelivery. Commit
-- reviews and shipped items already dedupe on (project_id, commit_sha), but the
-- Shipped matcher/verifier runs (and its LLM call is paid for) before the
-- shipped_items row exists, and auto re-analyze is only debounced in memory.
-- routes/github-webhook.js inserts here first; only the delivery whose insert
-- lands runs them.
--
-- (ref, before_sha, after_sha) identifies one ref update, so the same sha
-- reaching main after a feature branch is still a new push.

CREATE TABLE IF NOT EXISTS processed_pushes (
  project_id   TEXT NOT NULL,
  ref          TEXT NOT NULL,
  before_sha   TEXT NOT NULL,
  after_sha    TEXT NOT NULL,
  delivery_id  TEXT,
  source       TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, ref, before_sha, after_sha),
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);
