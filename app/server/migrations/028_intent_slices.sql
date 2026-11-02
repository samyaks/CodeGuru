-- 028_intent_slices.sql
-- Intent loop V1 (docs/specs/intent-driven-building.md). One row per slice:
-- what the builder should get working next, what already exists, what not
-- to touch, and the acceptance criteria the verifier checks on push.
--
-- Two tables:
--   * intent_slices — the slice. Columns mirror the Slice contract in
--     lib/slice-types.js; list/object fields are JSONB so the shape can
--     evolve without a migration. One open slice per project, enforced by a
--     partial unique index on status IN ('active', 'verifying').
--   * slice_events — the verification log (activated, synced, push_seen,
--     criterion_verdict, verified, ...). Kinds mirror SLICE_EVENT_KINDS.
--
-- Follows existing conventions (019/024): TEXT ids, project_id ->
-- deployments ON DELETE CASCADE, TEXT + CHECK for enums, TIMESTAMPTZ
-- timestamps, JSONB for structured sub-objects. Forward-only + idempotent.

CREATE TABLE IF NOT EXISTS intent_slices (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'verifying', 'verified', 'abandoned')),
  -- { kind: 'next_thing' | 'gap' | 'manual', id: string|null, text: string|null }
  source              JSONB NOT NULL DEFAULT '{}',
  title               TEXT NOT NULL,
  objective           TEXT NOT NULL,
  why                 TEXT,
  -- string[] — what already exists to build on
  existing            JSONB NOT NULL DEFAULT '[]',
  -- string[] — hard constraints
  guardrails          JSONB NOT NULL DEFAULT '[]',
  -- string[] — repo-relative globs the agent must not modify
  protected_paths     JSONB NOT NULL DEFAULT '[]',
  -- AcceptanceCriterion[] (see lib/slice-types.js)
  acceptance_criteria JSONB NOT NULL DEFAULT '[]',
  -- rendered by slice-prompt.js, cached
  prompt              TEXT NOT NULL DEFAULT '',
  -- the branch the builder pushes to
  branch              TEXT NOT NULL,
  -- { mode, commit_sha, pr_url, pr_number, rules_file, synced_at }
  sync                JSONB NOT NULL DEFAULT '{}',
  -- { tested: boolean, url: string|null }
  staging             JSONB NOT NULL DEFAULT '{}',
  -- { last_seen_at: string|null, guardrail_touched: string[] }
  pushes              JSONB NOT NULL DEFAULT '{}',
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open slice per project. slice-store.create checks first and treats a
-- 23505 from this index as the race fallback (409 CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_slices_one_open_per_project
  ON intent_slices (project_id)
  WHERE status IN ('active', 'verifying');

CREATE INDEX IF NOT EXISTS idx_intent_slices_project_created
  ON intent_slices (project_id, created_at);

CREATE TABLE IF NOT EXISTS slice_events (
  id          TEXT PRIMARY KEY,
  slice_id    TEXT NOT NULL REFERENCES intent_slices(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL
    CHECK (kind IN (
      'activated', 'prompt_copied', 'synced', 'push_seen', 'guardrail_touched',
      'criterion_verdict', 'criterion_override', 'verified', 'abandoned'
    )),
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slice_events_slice_created
  ON slice_events (slice_id, created_at);
