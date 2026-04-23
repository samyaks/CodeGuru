# Migrations

Plain SQL files applied in alphabetical order against the Supabase Postgres
instance pointed to by `DATABASE_URL_DIRECT`.

Run: `npm run migrate --prefix app`

Re-run an already-applied migration (for local dev): `npm run migrate:force --prefix app`.

## Requirements

- **`DATABASE_URL_DIRECT` is required** — it must point at the Supabase direct
  connection URL, i.e. port 5432 with hostname `db.<project_ref>.supabase.co`.
  Pooler URLs (`*.pooler.supabase.com`) will be rejected with a clear error
  because pgbouncer's transaction-pooling mode silently breaks
  `pg_advisory_lock`, which the runner uses to prevent concurrent migrations.
  There is no fallback to `DATABASE_URL` (which in this project's `.env.example`
  is deliberately a pooler URL for the running server).

- **Migrations MUST be idempotent.** All DDL should be wrapped in
  `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS`,
  or a PL/pgSQL `DO $$ ... END $$` block that guards against re-application
  (check `information_schema.columns` / `pg_constraint` / etc. before the
  ALTER). Each file runs inside its own transaction; a non-idempotent migration
  will fail loudly on re-run under `migrate:force` — and that's the only way
  we ever fix up a prod schema, so treat every migration as if it will run
  twice.

- **Filename convention:** `NNN_description.sql` with a 3-digit zero-padded
  prefix (e.g. `003_add_widgets.sql`). The runner sorts lexicographically, so
  zero-padding is what keeps `010` after `009`.

## Authoring

Write plain SQL — **no `BEGIN/COMMIT`**. The runner wraps each file in a
transaction and records it in the `schema_migrations` table. Prefer idempotent
DDL as described above. If you need DO blocks or Postgres-specific features
(`jsonb_typeof`, `pg_constraint` lookups, etc.), that's fine — we target
Postgres, not ANSI SQL.

## Applied migrations

- `001_initial.sql` — port of the original SQLite schema.
- `002_capture_layer.sql` — 4 capture tables + 11 rollup columns on `analyses`.
- `003_fk_indexes.sql` — indexes on FK / hot-path columns.
- `004_schema_fixes.sql` — `features_summary` JSONB→TEXT, tree-rollup defaults,
  chunk `UNIQUE(file_id, ordinal)` constraint.
