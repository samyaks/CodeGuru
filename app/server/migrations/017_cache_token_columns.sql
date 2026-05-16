-- 017_cache_token_columns.sql
-- Capture Anthropic prompt-caching token buckets so cost reporting stays
-- accurate after Phase-1 prompt caching landed. Anthropic returns three
-- input-token buckets on every response when caching is enabled:
--   - input_tokens            (uncached input, billed 1.0x base)
--   - cache_creation_input_tokens (written to cache, billed 1.25x base)
--   - cache_read_input_tokens     (read from cache,    billed 0.1x base)
-- Without these columns, llm_input_tokens / llm_cost_usd silently drift.
-- All ALTERs are IF NOT EXISTS so this is re-runnable.

ALTER TABLE analysis_llm_calls
  ADD COLUMN IF NOT EXISTS cache_creation_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE analysis_llm_calls
  ADD COLUMN IF NOT EXISTS cache_read_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS llm_cache_creation_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS llm_cache_read_tokens INTEGER NOT NULL DEFAULT 0;
