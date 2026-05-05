# Repo corrections for v2 migration agents

Read this file before any phase prompt. These facts override the source instructions wherever they conflict.

## Paths

- Frontend lives at `app/client/src/...` (Vite + React + TypeScript + Tailwind).
- Backend lives at `app/server/...` and is **CommonJS `.js`** (`require`/`module.exports`). Never write `.ts` files for backend services.
- v1 project page route is `/projects/:id` (plural). See `app/client/src/App.tsx`.
- v2 routes live under `/v2/projects/:id`. **Do not use `/takeoff/*`** — already taken by the v1 analysis-progress flow.
- The `archive/` directory is for retired-but-tracked code. Do NOT add to `.gitignore`. The scanner ignores it via runtime config.

## Data model

- The "Suggestions" data model is the `suggestions` table in `app/server/migrations/001_initial.sql` (line 168):
  - `id TEXT PRIMARY KEY`
  - `project_id TEXT NOT NULL` (FK to `deployments(id)`)
  - `type TEXT CHECK (type IN ('bug', 'fix', 'feature', 'idea', 'perf'))`
  - `priority TEXT`
- New v2 fields are added via `app/server/migrations/010_v2_gap_fields.sql`:
  - `category TEXT NOT NULL DEFAULT 'broken' CHECK (category IN ('broken','missing_functionality','missing_infrastructure'))`
  - `status TEXT NOT NULL DEFAULT 'untriaged' CHECK (status IN ('untriaged','in_progress','shipped','rejected'))`
  - `verification TEXT CHECK (verification IN ('pending','verified','partial'))`
  - `cursor_prompt TEXT` (cached generated prompt)
- Phase 4 adds `shipped_items` and `webhook_events` tables via `011_v2_shipped.sql`.

## Existing infrastructure to reuse

- `app/server/lib/anthropic-tracked.js` — wrapper around the Anthropic SDK with usage tracking. Use for ALL Claude calls.
- `app/server/routes/github-webhook.js` and `app/server/services/github-webhook-manager.js` — webhook signature validation already exists. Extend, don't rebuild.
- `app/server/services/suggestion-rules.js` — `runGapSuggestions` already groups findings by capability (auth/database/deployment/etc.). Phase 3 categorization should reuse these buckets.
- `app/server/lib/sse.js`, `app/server/lib/db.js`, `app/server/lib/migrate.js` — established helpers.
- `app/server/lib/async-handler.js` — wrap async route handlers with this.
- `app/server/lib/app-error.js` — throw `AppError` for typed errors.

## Branding

- Branding decision (Takeoff vs CodeGuru vs UpdateAI) is **deferred** until after Phase 5.
- Until then, keep the prototype's "Takeoff" copy verbatim where it appears in the prototype.
- Do NOT silently rebrand any user-facing string.

## Multi-agent decomposition

- Phases 0, 2, 5, 6a, 6b: single agent each.
- Phase 1: 1 lead + 2 component-batch sub-agents (simple components, complex components).
- Phase 3: 1 lead + 2 sub-agents (backend, frontend).
- Phase 4: 1 lead + 3 sub-agents (webhook, matcher, verifier).

## Path/language correction summary (against the source doc)

- `src/...` → `app/client/src/...`
- Backend `.ts` filenames → `.js`
- `/project/:id` → `/projects/:id`
- `.takeoffignore` → `.scanignore`
- Phase 0 archive list: only `code-visualizer-mvp/` (and possibly `cursor-extension/`); skip `_archived/*` (already gone).
- Phase 4 webhook: extend `app/server/routes/github-webhook.js`, do not rebuild.

## Open items (revisit after Phase 5)

- Branding: Takeoff vs CodeGuru vs UpdateAI.
- Whether `cursor-extension/` goes into `archive/`.
- Whether `/takeoff/*` workflow consolidates into v2.
