-- 004_schema_fixes.sql — features_summary JSONB→TEXT, tree-rollup defaults,
-- chunk UNIQUE constraint. Idempotent.
--
-- Fixes:
--   * R2-M1: analyses.features_summary and deployments.features_summary were
--     JSONB but the app writes a free-form markdown string; toJsonb wrapped it
--     as { raw: "..." } and the client (string-expecting) broke.
--   * R1-#2: tree rollup columns were nullable/no-default, inconsistent with
--     sibling NOT NULL DEFAULT 0 rollups.
--   * R1-#3 / R2-m5: analysis_file_chunks had no UNIQUE(file_id, ordinal), so
--     re-runs of chunk insertion could duplicate rows.

-- ── (a) features_summary: JSONB → TEXT ───────────────────────────────
--
-- The USING clause handles three legacy shapes:
--   * NULL
--   * bare JSON string (e.g. "\"markdown\"")
--   * { raw: "<markdown>" } wrapper written by the toJsonb shim
-- Anything else falls back to ::text which yields the serialized JSON.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'analyses'
      AND column_name = 'features_summary'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE analyses ALTER COLUMN features_summary TYPE TEXT USING
      CASE
        WHEN features_summary IS NULL THEN NULL
        WHEN jsonb_typeof(features_summary) = 'string' THEN features_summary #>> '{}'
        WHEN features_summary ? 'raw' THEN features_summary ->> 'raw'
        ELSE features_summary::text
      END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'deployments'
      AND column_name = 'features_summary'
      AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE deployments ALTER COLUMN features_summary TYPE TEXT USING
      CASE
        WHEN features_summary IS NULL THEN NULL
        WHEN jsonb_typeof(features_summary) = 'string' THEN features_summary #>> '{}'
        WHEN features_summary ? 'raw' THEN features_summary ->> 'raw'
        ELSE features_summary::text
      END;
  END IF;
END $$;

-- ── (b) tree rollup defaults + NOT NULL ──────────────────────────────
-- Backfill NULLs first so SET NOT NULL doesn't fail, then lock it down.
-- SET NOT NULL / SET DEFAULT on already-compliant columns is a no-op.

UPDATE analyses SET file_count = 0            WHERE file_count IS NULL;
UPDATE analyses SET tree_total_bytes = 0      WHERE tree_total_bytes IS NULL;
UPDATE analyses SET tree_estimated_tokens = 0 WHERE tree_estimated_tokens IS NULL;

ALTER TABLE analyses ALTER COLUMN file_count            SET NOT NULL;
ALTER TABLE analyses ALTER COLUMN file_count            SET DEFAULT 0;
ALTER TABLE analyses ALTER COLUMN tree_total_bytes      SET NOT NULL;
ALTER TABLE analyses ALTER COLUMN tree_total_bytes      SET DEFAULT 0;
ALTER TABLE analyses ALTER COLUMN tree_estimated_tokens SET NOT NULL;
ALTER TABLE analyses ALTER COLUMN tree_estimated_tokens SET DEFAULT 0;

-- ── (c) analysis_file_chunks UNIQUE (file_id, ordinal) ───────────────
-- Add the UNIQUE constraint first (this creates its own unique btree index),
-- then drop the pre-existing non-unique btree from 002 to avoid bloat.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'analysis_file_chunks_file_id_ordinal_key'
      AND conrelid = 'analysis_file_chunks'::regclass
  ) THEN
    ALTER TABLE analysis_file_chunks
      ADD CONSTRAINT analysis_file_chunks_file_id_ordinal_key UNIQUE (file_id, ordinal);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_analysis_file_chunks_file;
