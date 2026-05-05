# v2 migration code review — 2026-05-04

Reviewer: staff-engineer agent (`explore` subagent), Claude Opus 4.7.
Reviewed against:
- `/Users/samyak/.cursor/plans/v2_migration_multi-agent_plan_e86bfcc2.plan.md`
- `docs/v2-reference/cursor-migration-instructions.md`
- `docs/v2-reference/takeoff-prototype.jsx`

The reviewer was given the diff scope, plan, and prototype, and asked
to find concrete bugs (not "consider"-style suggestions). The actionable
items are tracked in `docs/v2-reference/followups.md`. This file is the
permanent record of the review itself.

## Critical bugs

### C1. Reopen returns a non-existent gap id
**File:** `app/server/routes/v2/shipped.js` ~72–97
**What goes wrong:** `suggestions.createBatch` re-hashes the id as
`sha256(project_id + ':' + row.id).slice(0, 16)` (`lib/db.js` ~793–795).
The route returns `newGapId: newId` (the *pre-hash* token) and calls
`setV2Status(newId, ...)` which targets no row. Client uses the wrong
id → 404s; status update silently no-ops.
**Fix:** use the value returned from `createBatch` (or expose the scoped
id from the helper, or compute the same hash in the route) for both
the response and the follow-up `setV2Status`.

### C2. No `(project_id, commit_sha)` uniqueness on `shipped_items`
**File:** `app/server/services/v2/shipped-runner.js` ~29–62;
`011_v2_shipped.sql`; `lib/db.js#shippedItems.create` ~1344–1352
**What goes wrong:** `findByCommit` then `create` is not transactional.
The `shipped_items` table has no unique constraint on
`(project_id, commit_sha)`. Each `create` uses a new random UUID, so
`ON CONFLICT (id)` never dedupes. Concurrent webhook deliveries (or
GitHub retries) → duplicate rows + duplicate verifier runs + duplicate
gap status updates.
**Fix:** add `UNIQUE (project_id, commit_sha)` to the table and switch
`shippedItems.create` to `INSERT ... ON CONFLICT (project_id, commit_sha) DO NOTHING RETURNING *`.

### C3. Shipped gaps stay in the matcher candidate pool
**File:** `app/server/services/v2/shipped-runner.js` ~40–44
**What goes wrong:** Candidate filter includes `v2_status === 'shipped'`.
A new push can re-match an already-shipped gap, call `verifyGap` again,
write a second `shipped_items` row, and re-update `v2_status`.
**Fix:** restrict matcher candidates to `untriaged` and `in_progress`
only. (C2's uniqueness constraint still wanted as a backstop.)

## High-severity findings

### H1. Sub-threshold matches still create rows
**File:** `app/server/services/v2/shipped-runner.js` ~48–63;
**Plan reference:** v2 plan, Phase 4 — "Match confidence < 0.7 must
NOT auto-create a ShippedItem."
**What goes wrong:** Implementation always inserts a `shipped_items`
row for every processed commit, including those with no match or
confidence below `MIN_CONFIDENCE` (gap_id null). Shipped tab fills
with noise; contract diverges from the written plan.
**Fix:** skip the insert below threshold (or hide null-gap rows from
the UI behind a flag).

### H2. Verifier maps unknown → `partial`, not `pending`
**File:** `app/server/services/v2/gap-verifier.js` ~61–70
**What goes wrong:** `parsed.verification === 'verified' ? 'verified' : 'partial'`
silently turns any malformed Claude response (or a literal `"pending"`)
into `'partial'`. The hard contract says "fail-safe to `pending`."
**Fix:** explicit allowlist — only `'verified'` and `'partial'` accepted;
everything else → `'pending'`.

### H3. Public projects are write-open
**File:** `app/server/app.js` ~140–141; `routes/v2/gaps.js` (all POSTs);
`routes/v2/shipped.js` (reopen); `lib/helpers.js` ~7–11
**What goes wrong:** v2 mutating endpoints are mounted with
`optionalAuth`. For projects with `user_id IS NULL` (public),
unauthenticated users can `accept` / `refine` / `mark-committed`,
which triggers Anthropic calls. v1 `/api/projects/:id` writes share
the same pattern, but the v2 surface is worse because `refine` calls
Claude on every request.
**Fix:** require `req.user` for all v2 mutating routes. Reads can stay
optional-auth.

## Medium-severity findings

### M1. Keyword matcher fires when `commit.files` is empty
**File:** `app/server/services/v2/gap-matcher.js` ~67–80
**What goes wrong:** When a commit's file list is empty (rare but
possible — e.g. merge commits), `hasFileTouch` is `false` and the
guard is skipped, so the matcher can fire on title keywords alone.
False positives.
**Fix:** when `gapFiles.length > 0` and `commit.files.length === 0`,
skip the keyword tier entirely.

### M2. Pending verifications still flip gap to `shipped`
**File:** `app/server/services/v2/shipped-runner.js` ~92–107
**What goes wrong:** When the verifier returns `pending`, the runner
still sets the source suggestion's `v2_status` to `'shipped'` with
`verification: 'pending'`. UI shows the gap as done while verification
hasn't finished.
**Fix:** keep `v2_status = 'in_progress'` until verification resolves
to `verified` or `partial`.

### M3. `?status=in-progress` query param returns empty
**File:** `routes/v2/gaps.js` ~44; `lib/db.js#findV2GapsByProjectId`
**What goes wrong:** Frontend uses kebab-case (`'in-progress'`); DB
stores snake (`'in_progress'`). The route passes `req.query.status`
straight through to a `WHERE v2_status = $x` clause. Calling with the
kebab form returns nothing.
**Fix:** normalize at the route boundary (`'in-progress' → 'in_progress'`)
or document that the query param is snake-only.

### M4. `tryRefMatch` allows short-ref false positives
**File:** `app/server/services/v2/gap-matcher.js` ~41–46
**What goes wrong:** `g.id.endsWith(ref) || g.id.startsWith(ref)` will
match a 3-character commit-message reference against any 16-char id
that happens to start or end with those chars.
**Fix:** require full id match, or enforce `ref.length >= 7` and
uniqueness in the candidate set.

### M5. `shipped.js` reopen does an O(n) scan
**File:** `routes/v2/shipped.js` ~57–60
**What goes wrong:** `listByProjectId` then `find(r => r.id === itemId)`.
For projects with hundreds of shipped items this is wasteful.
**Fix:** add `shippedItems.findById(id, projectId)` to `lib/db.js` and
use it.

## Low-severity findings

### L1. `webhook_events.delivery_id` is non-unique
**File:** `011_v2_shipped.sql`
**What goes wrong:** GitHub redelivers webhooks. Without a unique
constraint we get duplicate archive rows. Acceptable for raw audit,
but means we can't safely use the table as a "process-once" queue.
**Fix:** `CREATE UNIQUE INDEX ... ON webhook_events(delivery_id) WHERE delivery_id IS NOT NULL`.

### L2. `010_v2_gap_fields.sql` has no `NOT NULL` on `v2_status`
The CHECK only fires when the column is non-null. The Phase 0 backfill
sets values, but future inserts that bypass the default could leave
nulls.
**Fix:** add `NOT NULL` after the backfill verifies. (Default is
already `'untriaged'` so this should be safe.)

### L3. Empty Claude prompt still progresses gap to `in_progress`
**File:** `routes/v2/gaps.js#accept`
**What goes wrong:** If `generateCursorPrompt` returns an empty string,
the catch is a no-op and `setV2Status` runs anyway. User sees the
"Cursor prompt" panel with nothing in it.
**Fix:** if prompt is empty, either retry or fail the accept with a
specific error.

### L4. `replaceGap` doesn't move buckets on `rawCategory` change
**File:** `app/client/src/pages/v2/GapsSection.tsx` ~60–70
**What goes wrong:** Refining a gap server-side could in principle
recategorize it. The client only updates the gap in-place in whichever
bucket already held it, so the UI buckets can drift until reload.
**Fix:** rare; on refine, either reload the list or move the item by
`rawCategory`.

### L5. Async actions leak through unmount
**File:** `app/client/src/pages/v2/GapsSection.tsx`,
`app/client/src/pages/v2/ShippedSection.tsx`
**What goes wrong:** `setToast` / `replaceGap` / `setData` run after
await without an abort signal. Navigating away mid-action triggers
React's "set state on unmounted component" warning.
**Fix:** `useRef` cancelled flag, or AbortController.

## Nits

- `app/client/src/services/v2Api.ts` ~76 — mid-file `import type`.
  Valid TS, may trip `eslint import/first`. Move to top.
- `gap-matcher.js` stopword list mostly redundant because
  `tokenize` drops `length < 4` already.
- `App.tsx` line ~55 comment claims "writes need auth"; with
  `optionalAuth` + `checkProjectAccess` that's only true for non-null
  `user_id`.

## Findings the reviewer flagged that we accept as-is

- **Phase 6b "marked completed"** — destructive cleanup is intentionally
  deferred per the plan; the executable parts (audit-self update + run)
  are done. Documented in `followups.md` as a phase-gated item, not a
  bug.
- **`ProjectRouter` toggle remounts the subtree** — accepted; v1 is
  the escape hatch, not a daily-driver, so losing tab state on toggle
  is fine.
- **Hash-tab double-render** — `setTab` writes the hash *and* calls
  `setActiveTab`; `hashchange` fires `setActiveTab` again with the
  same value. Extra render, not a desync. Acceptable.
- **`PLACEHOLDERS` map in `Project.tsx`** — kept deliberately as a
  guard for future tab additions; documented in
  `app/client/src/pages/v2/.context.md`.

## What was NOT reviewed

- Migration runtime safety against the actual production DB schema
  (we only inspected the SQL).
- Any tests — the v2 surface has none.
- Production load behavior of the `setImmediate(processPushV2)` fan-out.
