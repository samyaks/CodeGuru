-- 021_intent_group_label.sql
-- Takeoff intent substrate — semantic grouping.
--
-- Problem: `feature_area` is derived deterministically from file paths by the
-- structure extractor. For deeply-nested repos every layout segment is generic,
-- so it falls back to the *filename*, turning individual components into their
-- own "area" (e.g. usermenu, readinessring, errorboundary). The Context tab then
-- shows dozens of one-file groups instead of a handful of product areas.
--
-- Fix: add `group_label` — a coarse, product-level grouping produced by a single
-- LLM pass over the statements after bootstrap (services/intent/grouping.js).
-- We keep `feature_area` untouched because bootstrap idempotency
-- (deleteCandidatesByArea) and reconciliation key on it; `group_label` is a
-- pure presentation layer the mapper groups by, falling back to feature_area
-- when it is null.
--
-- Forward-only + idempotent, matching the existing migration conventions.

ALTER TABLE intent_statements
  ADD COLUMN IF NOT EXISTS group_label TEXT;

CREATE INDEX IF NOT EXISTS idx_intent_statements_project_group
  ON intent_statements(project_id, group_label);
