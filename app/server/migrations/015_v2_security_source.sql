-- 015_v2_security_source.sql
--
-- Phase 1 follow-up: extend the suggestions.source CHECK constraint
-- to allow 'security' as a value.
--
-- Background: 001_initial.sql created the constraint as
--   source TEXT NOT NULL CHECK (source IN ('static', 'ai'))
-- which made sense when suggestions came from only the static-rules
-- engine and the AI suggester. Phase 1's security pipeline writes
-- new rows with source='security' so they can be told apart in
-- read paths (gap-mapper.js already routes on this). Without this
-- migration every security finding fails to insert with
-- "violates check constraint suggestions_source_check".
--
-- Caught by app/server/scripts/__validate_security_phase1.js — the
-- 014 migration shipped without this expansion, so 14 days of
-- security analyses on existing projects would silently produce
-- 0 findings persisted (the orchestrator catches and logs but the
-- whole stage was a no-op). Re-running analysis post-migration
-- backfills automatically because the detectors are deterministic.
--
-- Idempotent: drops the existing constraint by name, then re-adds
-- with the new value list.

ALTER TABLE suggestions DROP CONSTRAINT IF EXISTS suggestions_source_check;
ALTER TABLE suggestions
  ADD CONSTRAINT suggestions_source_check
  CHECK (source IN ('static', 'ai', 'security'));
