-- 007_commit_context.sql
-- Commit Context Capture: link auto-drafted Build Story entries to the commit
-- they came from, with an approval workflow ('pending' → 'approved' | 'dismissed').
-- Manual entries leave both columns NULL.

ALTER TABLE build_entries
  ADD COLUMN IF NOT EXISTS source_commit_sha TEXT;

ALTER TABLE build_entries
  ADD COLUMN IF NOT EXISTS approval_status TEXT
    CHECK (approval_status IN ('pending', 'approved', 'dismissed'));

-- Used to look up the pending draft for a given commit on the Build Story page.
CREATE INDEX IF NOT EXISTS idx_build_entries_source_commit
  ON build_entries(project_id, source_commit_sha)
  WHERE source_commit_sha IS NOT NULL;
