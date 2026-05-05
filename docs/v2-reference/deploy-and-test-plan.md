# v2 migration — deploy & test plan

The migration was committed as 9 atomic commits so each one can be
checked out, tested in isolation, deployed, or reverted on its own.
This doc tells you what each commit changes, how to verify it, and the
safest cadence for getting it to production.

Read [`code-review-2026-05-04.md`](./code-review-2026-05-04.md) and
[`followups.md`](./followups.md) before deploying — they list known
issues you want fixed before flipping the cutover commit live.

## The 9 commits

| # | SHA | Phase | What lands |
|---|-----|-------|------------|
| 1 | `437ae32` | −1 | reference materials (`docs/v2-reference/{instructions, prototype, corrections}.md`) — pure docs |
| 2 | `2d5d51e` | 0 | move `code-visualizer-mvp/` → `archive/`, scanner skips `archive/`, **migration `010_v2_gap_fields.sql`** added (not yet read) |
| 3 | `afa1718` | 1 | `/v2/style-guide` route, 10 v2 components, design tokens, `flags.ts` (default **OFF**) |
| 4 | `1176cd7` | 2 | `/v2/projects/:id` shell with placeholder tabs |
| 5 | `bc43ee1` | 3 | **first real v2 feature**: Gaps tab + backend mapper / prompt-gen / routes |
| 6 | `e7f7b81` | 4 | Shipped tab + matcher + verifier + webhook integration + **migration `011_v2_shipped.sql`** |
| 7 | `67f8b33` | 5 | Map + Context tabs; v1 `ProductMap` / `ProductMapOnboarding` deleted, `/projects/:id/map*` 301s into `/v2/...#map` |
| 8 | `64c307f` | 6a | **user-visible cutover**: `/projects/:id` defaults to v2; `?v1=true` is the per-user fallback |
| 9 | (this) | docs | `.context.md` files, code review, followups, this plan |

## Migrations are NOT auto-applied

`app/server/lib/migrate.js` is a standalone script. Before deploying the
commits below, run it explicitly against the target database:

```bash
DATABASE_URL_DIRECT=<session-pooler-or-direct-url> \
  node app/server/lib/migrate.js
```

| Migration | Required before deploying | Why |
|-----------|---------------------------|-----|
| `010_v2_gap_fields.sql` | commit 5 (`bc43ee1`) | Adds `v2_status`, `v2_category`, etc. to `suggestions`. The Gaps API selects these columns. |
| `011_v2_shipped.sql` | commit 6 (`e7f7b81`) | Creates `shipped_items` and `webhook_events`. Webhook handler writes both on every push. |

If a migration fails partway, the corresponding code-deploy will throw
on first request. v1 surface is unaffected because v1 doesn't read the
new columns or tables.

## Local smoke test per commit

Per-commit smoke tests for `git bisect` or step-by-step validation. Run
each from a clean working tree:

```bash
git checkout <sha>
cd app/client && npm install && npm run build
cd ../server && npm install
node -e "require('./app.js')" &  # or: node app.js
sleep 2 && curl -s http://localhost:3001/health
kill %1 2>/dev/null
```

Then verify the user-visible behavior:

| At commit | Smoke check | Expected |
|-----------|-------------|----------|
| 1 (`437ae32`) | `git diff --stat HEAD~1` | only files under `docs/v2-reference/` |
| 2 (`2d5d51e`) | `node app/server/scripts/audit-self.js` | does not traverse `archive/`; same module count as before move |
| 3 (`afa1718`) | open `/v2/style-guide` in dev server | renders Card, Badge, GapCard, ShippedItem, ChatDrawer with sample data; `/projects/:id` still v1 |
| 4 (`1176cd7`) | open `/v2/projects/<existing-id>` | shell + 4 placeholder tabs; sidebar shows real Stack + Personas; `/projects/:id` still v1 |
| 5 (`bc43ee1`) | run `010` migration; visit `/v2/projects/<id>#gaps` | gap cards render from real data; accept generates a Cursor prompt; refine creates a copy |
| 6 (`e7f7b81`) | run `011` migration; push a test commit to a connected repo | `webhook_events` row appears; if a gap matches, `shipped_items` row + Shipped tab populates |
| 7 (`67f8b33`) | visit `/projects/<id>/map` (old wizard URL) | 301-redirects to `/v2/projects/<id>#map`; Map + Context tabs render |
| 8 (`64c307f`) | visit `/projects/<id>` (no query) | renders v2; `?v1=true` renders v1; `?v2=true` persists v2 in localStorage |
| 9 | `cat .context.md` | repo root context with v2 migration in `## decisions` and `## ai-log` |

## Production deploy cadence

Deploying every commit is fine but expensive. These are the meaningful
checkpoints. **Default OFF** means the v2 flag is `false` in
production, so users only see v2 if they opt in via `?v2=true`.

### Checkpoint A — after commit 5 (`bc43ee1`)

First deploy that puts real v2 in production. Flag is still default OFF,
so live users see no change.

1. Run migration `010_v2_gap_fields.sql`.
2. Deploy commits 1–5.
3. Verify `/api/health` and existing v1 traffic unchanged.
4. Append `?v2=true` to a project URL, navigate to the Gaps tab, run
   one accept and one reject end-to-end. Confirm a Cursor prompt is
   generated.
5. Inspect `suggestions` rows: `v2_status`, `verification`,
   `cursor_prompt` columns are populated as expected.
6. Roll back: `git revert bc43ee1` (commits 4 and 5 are independent of
   each other, but commit 5 depends on commit 4 for the Project shell).

### Checkpoint B — after commit 7 (`67f8b33`)

Adds the webhook write path and v2's last two tabs. Flag still default
OFF; only the `/projects/:id/map*` redirects are user-visible.

1. Run migration `011_v2_shipped.sql`.
2. Deploy commits 6–7.
3. Confirm GitHub webhook delivery still returns 202 fast (the new
   `shipped-runner` work is dispatched via `setImmediate`).
4. Push a small commit to a connected repo with a recognizable gap
   reference (e.g. `fix(GAP-abc): something`) and watch:
   - `webhook_events` archive row exists
   - `shipped_items` row exists with `match_strategy = 'ref'`
   - source `suggestions.v2_status = 'shipped'` (snake_case in DB)
5. Hit `/v2/projects/<id>#shipped` and confirm the item renders.
6. Visit `/projects/<id>/map` — confirm 301 to `/v2/projects/<id>#map`.
7. Roll back: `git revert 67f8b33 e7f7b81`. The webhook handler keeps
   working (v1 `commitReviews` path is independent).

### Checkpoint C — after commit 8 (`64c307f`) — the user-visible cutover

Flips `USE_V2_PROJECT` default to `true`. Existing project URLs now
render v2.

1. Pre-flight: visit a few project URLs with `?v2=true` on the
   pre-cutover deploy and confirm everything works for at least an hour.
2. Deploy commit 8.
3. Smoke: visit `/projects/<id>` (no query) — should be v2. Append
   `?v1=true` — should be v1. Reload — should be v1 (opt-out persists
   for the load).
4. Watch logs for ~30 min: any 5xx spikes on `/api/v2/...` endpoints,
   any client errors visible to your error tracker.
5. Roll back paths, in order of safety:
   - **Per user**: append `?v1=true` to any project URL.
   - **Per deployment**: `git revert 64c307f` (just the flag flip).
     v2 routes still exist; v1 default is restored.
   - **Wider**: `git revert 64c307f 67f8b33 e7f7b81 bc43ee1 1176cd7` to
     remove the `/v2/...` routes and webhook write path entirely.

### Checkpoint D — after commit 9

Pure docs. No deploy needed unless you want the docs in your prod tree.

## Bisect recipe

If a regression appears, the per-commit slicing means you can `bisect`
to a single phase. Example for "Gaps tab broken":

```bash
git bisect start
git bisect bad HEAD            # current main is bad
git bisect good 7808f85        # last commit before phase -1
# git will check out one commit at a time;
# at each, run `npm run build && npm test` (or your reproducer)
# and tell git: git bisect good   OR   git bisect bad
git bisect reset
```

You should land on commit 5 (`bc43ee1`) or 6 (`e7f7b81`) for any
Gaps-related regression.

## Don't deploy commits 1–4 standalone

They're individually safe but useless on their own — commit 4
(`/v2/projects/:id`) renders only placeholders, and commit 3
(`/v2/style-guide`) is internal QA. Deploy them as part of
Checkpoint A.

## Known issues to fix before commit 8 goes live

See [`followups.md`](./followups.md). The blockers tagged **high
severity** (#1 sub-confidence inserts, #2 verifier fail-safe contract,
#7 unauthenticated mutations on public projects) should land before
the cutover deploy if you can swing it.
