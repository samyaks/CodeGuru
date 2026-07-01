-- 022_intent_features.sql
-- Takeoff intent substrate — feature / job-to-be-done roll-up layer.
--
-- Adds a synthesized "feature" object on top of the granular intent_statements
-- so the Context tab reads like a plan (Persona -> Job-to-be-done -> Feature ->
-- statement) instead of a flat list. Features are a DERIVED view — regenerated
-- on every analysis by services/intent/features.js — so persona/job are stored
-- inline (denormalized) rather than as separate relational tables. The human
-- source of truth stays at the statement level.
--
-- Join key: a feature's `label` equals the statement `group_label` set by the
-- same synthesis pass, so no change to intent_statements is needed. `job_id` is
-- populated only when a feature was mapped to an existing product-map job
-- (map_jobs.id); otherwise the persona/job were auto-derived from the code.
--
-- Mirrors existing conventions (see 019_intent_substrate.sql): TEXT primary key,
-- project_id -> deployments ON DELETE CASCADE, TEXT + CHECK for enums,
-- TIMESTAMPTZ timestamps. Forward-only + idempotent.

CREATE TABLE IF NOT EXISTS intent_features (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  -- Matches intent_statements.group_label for this project.
  label         TEXT NOT NULL,
  summary       TEXT,
  persona_name  TEXT,
  persona_emoji TEXT,
  job_title     TEXT,
  priority      TEXT
    CHECK (priority IN ('high', 'medium', 'low')),
  -- Non-null only when reused from the project's product map (map_jobs.id).
  job_id        TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ,
  UNIQUE (project_id, label)
);

CREATE INDEX IF NOT EXISTS idx_intent_features_project
  ON intent_features(project_id);
