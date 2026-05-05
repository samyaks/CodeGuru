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

**Status:** done (2026-05-04, commit on the post-deploy fix branch)
**Severity:** high
**From:** code review H1
**Files:** `app/server/services/v2/shipped-runner.js` ~24–55
**What:** Plan Phase 4 says "Match confidence < 0.7 must NOT auto-create
a ShippedItem." Implementation always inserted a row (with `gap_id: null`
when no match). Shipped tab filled with noise.
**Fix landed:** below threshold or no-match commits are now logged and
skipped — the `webhook_events` archive still has the raw payload for
debugging. See `services/v2/shipped-runner.js`.

---

## 2. Verifier fail-safe: unknown → `pending`, not `partial`

**Status:** done (2026-05-04)
**Severity:** high
**From:** code review H2
**Files:** `app/server/services/v2/gap-verifier.js` ~61–73
**What:** `parsed.verification === 'verified' ? 'verified' : 'partial'`
silently mapped any malformed Claude response (or a literal `"pending"`)
to `'partial'`. Hard contract is fail-safe `'pending'`.
**Fix landed:** explicit allowlist `v === 'verified' || v === 'partial' ? v : 'pending'`.
`services/v2/.context.md` note updated to "honored".

---

## 3. Filter shipped/rejected gaps from matcher candidate pool

**Status:** done (2026-05-04)
**Severity:** critical
**From:** code review C3
**Files:** `app/server/services/v2/shipped-runner.js` ~40–44
**What:** Candidate filter previously allowed `'shipped'` gaps to be
re-matched on subsequent pushes, causing duplicate `shipped_items` rows
and duplicate verifier runs.
**Fix landed:** matcher pool restricted to `untriaged` and `in_progress`
only.

---

## 4. Add `UNIQUE (project_id, commit_sha)` to `shipped_items`

**Status:** done (2026-05-04 — requires migration 012 to apply in prod)
**Severity:** critical
**From:** code review C2
**Files:** `app/server/migrations/012_v2_shipped_unique.sql`,
`app/server/lib/db.js#shippedItems.create`
**Fix landed:**
1. Migration 012 adds the `idx_shipped_items_project_commit_uniq` UNIQUE
   index and drops the now-redundant non-unique `idx_shipped_items_commit`.
2. `shippedItems.create` switched to `ON CONFLICT (project_id, commit_sha)
   DO NOTHING RETURNING *`.
3. `findByCommit` precheck retained as a fast-path / Anthropic-call short
   circuit, but correctness now lives in the index.

**Deploy note:** run migration 012 BEFORE deploying this code.

---

## 5. Reopen route returns the wrong gap id

**Status:** done (2026-05-04)
**Severity:** critical
**From:** code review C1
**Files:** `app/server/routes/v2/shipped.js` ~72–113,
`app/server/lib/db.js#suggestions.createV2Gap`
**Fix landed:** Added `suggestions.createV2Gap(row)` which hashes the id
(matching `createBatch`'s contract) and returns the inserted row. Reopen
now uses it and returns `inserted.id` to the caller. The redundant
`setV2Status(newId, ...)` follow-up call was removed.

---

## 6. Normalize `?status=` query param at the route boundary

**Status:** done (2026-05-04 — bundled with #1–#5/#7/#8 cleanup)
**Severity:** medium
**From:** code review M3
**Files:** `app/server/routes/v2/gaps.js`
**Fix landed:** `normalizeV2Status()` accepts kebab- or snake-case,
rejects unknown values with `AppError.badRequest`, and is the single
boundary the frontend filters flow through.

---

## 7. Require auth for v2 mutating endpoints

**Status:** done (2026-05-04)
**Severity:** high
**From:** code review H3
**Files:** `app/server/routes/v2/gaps.js`, `app/server/routes/v2/shipped.js`
**Fix landed:** Each route file defines a `requireUser` middleware that
returns 401 when `req.user` isn't populated by `optionalAuth`. Applied
per-route to all POSTs (`accept`, `reject`, `restore`, `refine`,
`mark-committed`, `reopen`). GET routes still allow unauthenticated
access to public projects.

---

## 8. Tighten `tryRefMatch` to avoid short-id false positives

**Status:** done (2026-05-04 — bundled with the H/C cleanup)
**Severity:** medium
**From:** code review M4
**Files:** `app/server/services/v2/gap-matcher.js`
**Fix landed:** Exact-id hits always win; otherwise `ref.length >= 7`
AND exactly one candidate via `startsWith` / `endsWith` is required.
`MIN_REF_LENGTH = 7` is documented in-file.

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
