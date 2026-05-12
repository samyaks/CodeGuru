-- 016_v2_security_shares.sql
-- Phase 3 slice (b): public share links for the dedicated Security Report.
--
-- Scope: a project owner can mint a short-slug URL that anyone (no login)
-- can use to view a read-only copy of the project's security report. The
-- owner can list active links, revoke any of them, and optionally create
-- a "redacted" link that hides the repo URL/owner so they can share with
-- a wider audience without doxxing the project.
--
-- Schema notes:
--   slug         — 12-char URL-safe id (lowercase + digits). Doubles as
--                  the primary key so /security-shared/:slug is a single
--                  point lookup. 36^12 ≈ 4.7×10^18 keyspace; even at
--                  thousands of links we will not collide in practice,
--                  and the writer retries on the (extremely unlikely)
--                  PK violation.
--   project_id   — TEXT to match the rest of the v2 schema. ON DELETE
--                  CASCADE so deleting a project cleans up its share
--                  links — no dangling public URLs.
--   created_by   — user id (TEXT, nullable). Public projects have no
--                  user_id, so a Supabase-disabled deployment can still
--                  create shares (caller is `null`). The owner check
--                  for the revoke endpoint falls back to the project's
--                  user_id when this is null.
--   redact_repo  — when TRUE the public endpoint omits owner/repo/repo_url
--                  and replaces project name with "Project · {short hash}".
--                  Detectors and severities still surface — only the
--                  identity is redacted.
--   expires_at   — NULL means "no expiry". We don't auto-create expiring
--                  links yet, but the column is here so the route can
--                  start returning 410 when (one day) we do.
--   revoked_at   — NULL means active. Hard deletion is intentionally
--                  avoided so a revoked link can never be re-issued
--                  (slugs are unique by primary key) — anyone holding
--                  the URL gets a 410 forever.
--
-- Lookup paths:
--   1. GET /api/v2/security-shared/:slug — primary key lookup. We
--      additionally filter `revoked_at IS NULL AND (expires_at IS NULL
--      OR expires_at > now())` at query time; no index needed on those
--      because the PK is already a unique point lookup.
--   2. GET /api/v2/projects/:id/security-shares (modal "active links"
--      list) — partial index on `(project_id, created_at DESC)` where
--      revoked_at IS NULL keeps the modal query off a full table scan
--      even if the project has hundreds of historical shares.

CREATE TABLE IF NOT EXISTS v2_security_shares (
  slug         TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  created_by   TEXT,
  redact_repo  BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v2_security_shares_project_active
  ON v2_security_shares (project_id, created_at DESC)
  WHERE revoked_at IS NULL;
