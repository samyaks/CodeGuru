-- 005_product_map.sql — product map graph (Takeoff)
-- project_id references deployments (projects in this codebase)

CREATE TABLE IF NOT EXISTS product_maps (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  analysis_id   TEXT REFERENCES analyses(id) ON DELETE SET NULL,
  description   TEXT NOT NULL,
  domain        TEXT,
  scores        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS map_personas (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES product_maps(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  emoji         TEXT DEFAULT '👤',
  confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS map_jobs (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES product_maps(id) ON DELETE CASCADE,
  persona_id    TEXT NOT NULL REFERENCES map_personas(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  priority      TEXT NOT NULL DEFAULT 'medium',
  weight        INTEGER NOT NULL DEFAULT 2,
  confirmed     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS map_entities (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES product_maps(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  key           TEXT NOT NULL,
  label         TEXT,
  file_path     TEXT,
  status        TEXT NOT NULL DEFAULT 'detected',
  module        TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS map_edges (
  id            TEXT PRIMARY KEY,
  map_id        TEXT NOT NULL REFERENCES product_maps(id) ON DELETE CASCADE,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  type          TEXT NOT NULL,
  label         TEXT,
  confidence    REAL NOT NULL DEFAULT 0.8,
  method        TEXT NOT NULL DEFAULT 'ai',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_maps_project ON product_maps(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_map_edges_from ON map_edges(from_id);
CREATE INDEX IF NOT EXISTS idx_map_edges_to ON map_edges(to_id);
CREATE INDEX IF NOT EXISTS idx_map_entities_map ON map_entities(map_id, type);
CREATE INDEX IF NOT EXISTS idx_map_jobs_map ON map_jobs(map_id);
CREATE INDEX IF NOT EXISTS idx_map_personas_map ON map_personas(map_id);
