# v2 migration — open followups

Living TODO list for the v2 (Takeoff) migration. Numbered so the
`.context.md` files in this repo can reference items by id.

Source of items:
- 8 actionable items from `docs/v2-reference/code-review-2026-05-04.md`
- 3 deferred items from Phase 6b of the original migration plan
- 1 deferred prototype feature (inline jobs editor on Map tab)
- 1 branding decision

## Status legend

- **open** — not started
- **in-progress** — being actively worked
- **gated** — blocked on a calendar / monitoring window, not on engineering work
- **done** — landed; will be moved out of this file

---

## 1. Skip `shipped_items` insert below match-confidence threshold

**Status:** open
**Severity:** high
**From:** code review H1
**Files:** `app/server/services/v2/shipped-runner.js` ~48–63
**What:** Plan Phase 4 says "Match confidence < 0.7 must NOT auto-create
a ShippedItem." Implementation always inserts a row (with `gap_id: null`
when no match). Shipped tab fills with noise.
**Fix:** If `match` is null OR `match.confidence < MIN_CONFIDENCE`,
skip the insert. Optionally still archive the unmatched commit somewhere
non-user-visible (e.g. a log line) so we can debug "why didn't this
match" later.

---

## 2. Verifier fail-safe: unknown → `pending`, not `partial`

**Status:** open
**Severity:** high
**From:** code review H2
**Files:** `app/server/services/v2/gap-verifier.js` ~61–70
**What:** `parsed.verification === 'verified' ? 'verified' : 'partial'`
silently maps any malformed Claude response (or a literal `"pending"`)
to `'partial'`. Hard contract is fail-safe `'pending'`.
**Fix:** explicit allowlist:
```js
const v = parsed.verification;
const verification = v === 'verified' || v === 'partial' ? v : 'pending';
```
Update `services/v2/.context.md`'s "verifier MUST return 'pending' …"
note to "honored" once landed.

---

## 3. Filter shipped/rejected gaps from matcher candidate pool

**Status:** open
**Severity:** critical
**From:** code review C3
**Files:** `app/server/services/v2/shipped-runner.js` ~40–44
**What:** Candidate filter currently allows `'shipped'` gaps to be
re-matched on subsequent pushes, causing duplicate `shipped_items`
rows and duplicate verifier runs.
**Fix:** restrict to `untriaged` and `in_progress` only.

---

## 4. Add `UNIQUE (project_id, commit_sha)` to `shipped_items`

**Status:** open
**Severity:** critical
**From:** code review C2
**Files:** new migration `012_*.sql`; `app/server/lib/db.js#shippedItems.create`
**What:** Concurrent webhook deliveries → duplicate rows. The
check-then-insert in `shipped-runner.js` isn't atomic, and
`ON CONFLICT (id)` doesn't help because each insert generates a fresh
UUID.
**Fix:**
1. New migration `012_v2_shipped_unique.sql`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_shipped_items_project_commit_uniq
     ON shipped_items (project_id, commit_sha);
   ```
2. Switch `shippedItems.create` to
   `INSERT … ON CONFLICT (project_id, commit_sha) DO NOTHING RETURNING *`.
3. Drop the redundant `findByCommit` precheck (or keep it as a fast-path,
   but no longer rely on it for correctness).

---

## 5. Reopen route returns the wrong gap id

**Status:** open
**Severity:** critical
**From:** code review C1
**Files:** `app/server/routes/v2/shipped.js` ~72–97
**What:** `suggestions.createBatch` re-hashes ids; the route returns
the pre-hash token and calls `setV2Status(newId, ...)` which targets
no row.
**Fix:** Either expose the scoped id from `createBatch` (return the
inserted rows from `lib/db.js`), or move reopen off `createBatch` and
write a dedicated `suggestions.createV2Gap(row)` that uses the row's
literal id and returns the inserted shape.

---

## 6. Normalize `?status=` query param at the route boundary

**Status:** open
**Severity:** medium
**From:** code review M3
**Files:** `app/server/routes/v2/gaps.js` ~44
**What:** Frontend uses kebab-case (`'in-progress'`); DB stores snake.
Currently `?status=in-progress` returns nothing.
**Fix:**
```js
const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
const v2Status = raw ? raw.replace(/-/g, '_') : undefined;
```
Plus reject unknown values with `AppError.badRequest`.

---

## 7. Require auth for v2 mutating endpoints

**Status:** open
**Severity:** high
**From:** code review H3
**Files:** `app/server/app.js` ~140–141
**What:** `optionalAuth` + `checkProjectAccess` lets unauthenticated
users mutate state on public projects. Includes triggering Anthropic
calls via `accept` / `refine` — easy abuse vector.
**Fix:** Split the mount: `GET` routes can stay on `optionalAuth`,
mutating routes (POSTs) need `requireAuth`. Either two separate
`router.use` calls in `gaps.js` / `shipped.js`, or two mount lines in
`app.js`.

---

## 8. Tighten `tryRefMatch` to avoid short-id false positives

**Status:** open
**Severity:** medium
**From:** code review M4
**Files:** `app/server/services/v2/gap-matcher.js` ~41–46
**What:** `endsWith` / `startsWith` on a 16-char gap id will collide
on short references (e.g. a 3-char "fix" appearing in a commit message).
**Fix:** require `ref.length >= 7` AND that the candidate set has
exactly one match. Reject otherwise.

---

## 9. Phase 6b: delete v1 `ProjectView` + helpers

**Status:** gated (1 week minimum after v2 went live in production)
**Severity:** n/a (cleanup)
**From:** plan Phase 6b
**Files:** `app/client/src/pages/ProjectView.tsx`,
`app/client/src/pages/ProjectRouter.tsx`,
`app/client/src/config/flags.ts`,
v1-only suggestion / readiness panels not used by v2.
**What:** Once v2 has been the default for ≥1 week with no rollback,
delete the v1 path: `ProjectView.tsx`, the v1↔v2 router, the flag, and
the `?v1=true` escape hatch. Audit imports first to make sure nothing
else uses `ProjectView` or any v1-only sub-component.
**Acceptance:** `audit-self` reports ≤231 files, all imports resolve,
no `ProjectView` symbols remain.

---

## 10. Phase 6b: promote `components/v2/` → `components/`

**Status:** gated (same window as #9)
**Severity:** n/a (cleanup)
**From:** plan Phase 6b
**Files:** `app/client/src/components/v2/*` → `app/client/src/components/*`;
`app/client/src/pages/v2/*` → `app/client/src/pages/*` (with collision
handling on `Project.tsx`).
**What:** Rename v2 directories to canonical paths. This is a rename +
import rewrite; do it as a single commit so git follows the moves.
Keep `pages/v2/StyleGuide.tsx` deleted as part of this commit (it was
QA-only).

---

## 11. Phase 6b: remove `USE_V2_PROJECT` flag

**Status:** gated (same window as #9 / #10)
**Severity:** n/a (cleanup)
**From:** plan Phase 6b
**Files:** `app/client/src/config/flags.ts`
**What:** Once v1 is gone there's nothing for the flag to gate. Delete
`USE_V2_PROJECT` and `isV2EnabledForLocation`. Update
`pages/v2/.context.md`'s constraints section to remove the flag-aware
guidance.

---

## 12. Inline jobs editor on Map tab

**Status:** open (deferred from Phase 5)
**Severity:** medium
**From:** prototype `view === 'map'` block
**Files:** `app/client/src/pages/v2/MapSection.tsx`
**What:** The "Edit jobs" / "+ Add persona" affordances are currently
inert placeholders — the v1 wizard route was killed in Phase 5 with no
replacement. Need an inline drawer/modal that:
- lets you edit the jobs list for a persona without leaving the page,
- lets you add a new persona (name + emoji + initial jobs),
- writes back to `/api/product-map/:projectId` (or a new endpoint).
**Acceptance:** users can do everything the old `ProductMapOnboarding`
wizard supported without leaving `/v2/projects/:id#map`.

---

## 13. Branding decision: Takeoff vs CodeGuru vs UpdateAI

**Status:** open (deferred from Phase 5)
**Severity:** low
**From:** plan "Open items left to revisit"
**Files:** prototype copy is currently preserved verbatim across all v2
files; rebrand would touch `pages/v2/Project.tsx` header,
`pages/v2/StyleGuide.tsx`, the `package.json` workspace name, possibly
`/index.html` title, `cursor-extension/`'s manifest.
**What:** Pick a name. Rebrand. Update `.context.md` files at the root
and inside `app/client/src/components/v2/` to reflect.
**Acceptance:** `grep -ri 'Takeoff\|CodeGuru\|UpdateAI'` returns only
the chosen name (and historical references in `docs/v2-reference/`).

---

## Notes for whoever picks this up

- Items **1–8** are pure code work. Most should land as one PR each;
  #4 needs the migration to deploy before the helper change.
- Items **9–11** are calendar-gated. Don't start them before the
  ≥1-week monitoring window completes.
- Item **12** is a real product feature, not cleanup. Allocate it like
  one.
- Item **13** is a meeting, not a coding task — route through @samyak.
