-- 011_v2_shipped.sql
-- Phase 4: Shipped tab + verification engine.
--
-- Adds two tables:
--   shipped_items   — one row per matched commit / gap pair, with verification
--                     status. Powers the v2 Shipped tab UI.
--   webhook_events  — raw GitHub webhook payloads for replay/debugging. Same
--                     concept as a typical webhook archive.

CREATE TABLE IF NOT EXISTS shipped_items (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  gap_id              TEXT,
  commit_sha          TEXT NOT NULL,
  commit_message      TEXT,
  branch              TEXT,
  files_changed       JSONB,
  files_changed_count INTEGER NOT NULL DEFAULT 0,
  verification        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (verification IN ('pending', 'verified', 'partial')),
  verification_detail TEXT,
  partial_items       JSONB,
  match_confidence    NUMERIC,
  match_strategy      TEXT,
  shipped_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deployed_to         TEXT,
  deployed_at         TIMESTAMPTZ,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE,
  FOREIGN KEY (gap_id)     REFERENCES suggestions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_shipped_items_project
  ON shipped_items(project_id, shipped_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipped_items_commit
  ON shipped_items(project_id, commit_sha);

CREATE TABLE IF NOT EXISTS webhook_events (
  id            TEXT PRIMARY KEY,
  delivery_id   TEXT,
  event_type    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'github',
  project_id    TEXT,
  payload       JSONB NOT NULL,
  signature_ok  BOOLEAN,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_project
  ON webhook_events(project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_delivery
  ON webhook_events(delivery_id);
