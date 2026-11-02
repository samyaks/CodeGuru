# Intent loop V1 — build plan

Status: plan, 2026-11-01. Supersedes the "Minimal intent loop" line in `ROADMAP.md` → Now.
Source: the IDB Lean V1 draft (web intent surface over GitHub; one `current_micro_slice`
with `guardrails[]` and `acceptance_criteria[]`; `.intent/active.json` on the working
branch; "Copy prompt" hand-off to Cursor / Claude Code; verification after the build).

## Who this is for

The first customers have already built something: a repo they have been vibe-coding for
weeks, usually deployed, usually pushed straight to `main` from Cursor, usually with a
`.cursorrules` or `CLAUDE.md` someone generated for them. They are not starting from a
blank goal. Three things follow, and they shape every section below:

- The slice must say **what already exists** before it says what to build, so the agent
  extends instead of re-creating.
- Guardrails are mostly **"don't break what works"**, and the most valuable thing Takeoff
  can tell them after a push is "your agent touched something it was told to leave alone".
- They **don't branch and don't merge PRs**. Anything that depends on a PR being merged
  will not happen.

## Outcome

One outside builder, on their own repo, completes a slice end to end without help:

1. Opens the Build tab and sees one slice: what's already there, the objective, what not
   to break, acceptance criteria.
2. Clicks **Copy prompt**, pastes it into Cursor or Claude Code in their existing project,
   builds.
3. Pushes to `main` like they always do. Takeoff checks the push against the protected
   paths, checks each acceptance criterion against the patch, and marks the slice
   **verified** (or shows which criteria are unmet and why, and anything the agent
   touched that it shouldn't have).
4. Clicks **Pick the next one**.

Done when that happens for one person we did not coach, recorded in the funnel.

## What V1 is and is not

In:
- A slice is derived from what already exists. Three entry points, in this order of
  prominence for owners: type what you want to get working (the deriver grounds it in the
  code that is already there), **Build this next** on any gap, or accept the Read's
  suggested next thing.
- Every slice carries `existing[]` (what's already there, build on it), `protected_paths[]`
  (don't touch), and one regression criterion by default ("<top working feature> still
  works").
- The prompt is a deterministic template over the slice (no second LLM call). It embeds
  the full `.intent/active.json` inline, so the loop works even if the repo write fails.
- Repo sync commits two non-code files to the project's default branch, acting as the
  user through their GitHub OAuth token: `.intent/active.json`, and a marker-delimited
  pointer block in whichever rules file their agent already reads (`.cursor/rules/`,
  `CLAUDE.md`, or `AGENTS.md`). Takeoff shows the diff before committing. Falls back to a
  PR only when branch protection rejects the commit. Optional: the loop is complete
  without it.
- Verification runs on push through the existing webhook path. First a deterministic
  check: did the push touch any `protected_paths` → `guardrail_touched` warning. Then per
  criterion: rule pre-check (did any relevant file change at all) → Claude classification
  on the commit patch → verdict `met | unmet | unknown` with one line of evidence. Owners
  can override a verdict by hand.
- Visitors see the slice read-only.

Out (deferred, named so nobody builds them by accident):
- Staging-URL verification. V1 has a manual "I tested this on staging" toggle with an
  optional URL; nothing fetches it.
- MCP transport. `intent/mcp-tools.js` stays logic-only.
- GitHub App as the write actor. The sync module takes a token; swapping the source of
  that token is PR #28's job.
- Multiple concurrent slices, team claims, Slack. Parked in PR #32 (`team-collaboration.md`).
- Replacing the per-gap "Get Cursor prompt". It stays; "Build this next" sits beside it.

## Shared contracts (Agent 0 writes these first; everyone else codes to them)

### Slice shape

```ts
// app/client/src/services/sliceApi.ts and app/server/lib/slice-types.js (JSDoc)
type SliceStatus = 'active' | 'verifying' | 'verified' | 'abandoned';
type CriterionStatus = 'pending' | 'met' | 'unmet' | 'unknown';

interface AcceptanceCriterion {
  id: string;                 // "ac-1"
  description: string;        // what a non-engineer checks
  expected_behavior: string;  // what they should see
  status: CriterionStatus;
  evidence: string | null;    // one line, from the verifier or the owner
  verified_by: 'verifier' | 'owner' | null;
  verified_at: string | null;
}

interface Slice {
  id: string;
  project_id: string;
  status: SliceStatus;
  source: { kind: 'next_thing' | 'gap' | 'manual'; id: string | null; text: string | null }; // text = what the owner typed
  title: string;              // editorial, from next-thing or gap title
  objective: string;          // one paragraph, plain English
  why: string | null;
  existing: string[];         // what's already there to build on: "components/Login.tsx — email form, no submit handler"
  guardrails: string[];       // hard constraints, each one sentence
  protected_paths: string[];  // globs the agent must not modify; checked deterministically on push
  acceptance_criteria: AcceptanceCriterion[]; // last one is the default regression criterion (kind: 'regression')
  prompt: string;             // rendered by slice-prompt.js, cached
  branch: string;             // the branch the builder pushes to; defaults to the repo's default branch
  sync: {
    mode: 'commit' | 'pr' | null;    // commit = direct to branch; pr = branch protection forced a PR
    commit_sha: string | null; pr_url: string | null; pr_number: number | null;
    rules_file: string | null;       // which file got the pointer block
    synced_at: string | null;
  };
  staging: { tested: boolean; url: string | null };
  pushes: { last_seen_at: string | null; guardrail_touched: string[] }; // files that violated protected_paths on the latest push
  activated_at: string;
  verified_at: string | null;
}
```

`AcceptanceCriterion` gains `kind: 'feature' | 'regression'`.

### `.intent/active.json` (what gets written to the repo)

```json
{
  "$schema": "https://takeoff.dev/schemas/active-intent-v1.json",
  "intent_id": "<slice.id>",
  "feature_title": "<slice.title>",
  "current_micro_slice": { "slice_id": "<slice.id>", "name": "<slice.title>", "objective": "<slice.objective>" },
  "existing": ["..."],
  "guardrails": ["..."],
  "protected_paths": ["app/checkout/**", "lib/payments.ts"],
  "acceptance_criteria": [{ "id": "ac-1", "kind": "feature", "description": "...", "expected_behavior": "..." }],
  "generated_by": "takeoff", "generated_at": "<iso>"
}
```

Statuses, evidence and sync metadata are deliberately not in the file; the repo holds the
spec, Takeoff holds the state.

### Rules-file pointer block (what gets written beside it)

Detection order, first match wins: `.cursor/rules/` exists → write
`.cursor/rules/takeoff-intent.mdc` (whole file, `alwaysApply: true`); `CLAUDE.md` exists
→ upsert block; `AGENTS.md` exists → upsert block; none → create `AGENTS.md` with the
block. Upserts replace only what sits between `<!-- takeoff:intent -->` and
`<!-- /takeoff:intent -->`; the rest of the file is never rewritten. Block content:

```
<!-- takeoff:intent -->
## Current intent (managed by Takeoff)
Before changing code, read `.intent/active.json`. Build only `current_micro_slice`.
Do not modify any path listed under `protected_paths`. Treat `guardrails` as hard rules.
<!-- /takeoff:intent -->
```

### API (`/api/v2/projects/:id/slice`, mounted with `optionalAuth`; writes need a user)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/` | — | `{ active: Slice \| null, recent: Slice[] }` (recent = last 5 verified/abandoned) |
| POST | `/activate` | `{ source: 'next_thing' } \| { source: 'gap', gapId } \| { source: 'manual', text }` | `Slice` (409 if one is already active) |
| GET | `/:sliceId/sync/preview` | — | `{ branch, files: [{ path, action: 'create' \| 'update', content }] }` — what sync would commit; the client shows this before the user confirms |
| POST | `/:sliceId/sync` | `{ branch? }` | `Slice` with `sync` filled (`mode: 'commit'`, or `'pr'` if protection forced it), or 424 `{ error, needsReconnect: true }` when the token lacks `repo` |
| POST | `/:sliceId/criteria/:critId` | `{ status: 'met' \| 'unmet' \| 'pending', note? }` | `Slice` |
| POST | `/:sliceId/staging` | `{ tested: boolean, url?: string }` | `Slice` |
| POST | `/:sliceId/check` | — | `Slice` after verifying against the latest commits on `branch` (manual fallback when the webhook is not connected) |
| POST | `/:sliceId/abandon` | `{ reason? }` | `Slice` |

Errors follow `AppError` (`{ error, code }`). Project access uses the existing
`checkProjectAccess` rule (ownerless projects editable by any signed-in user).

### Server module boundaries

| Module | Owner | Exports |
|---|---|---|
| `services/intent/slice-deriver.js` | A | `deriveSlice({ project, read, gap?, manualText?, stack, settledClaims, workingFeatures }) → { title, objective, why, existing, guardrails, protected_paths, acceptance_criteria }` |
| `services/intent/slice-prompt.js` | A | `renderPrompt(slice, { repoLabel, branch }) → string`, `renderActiveIntent(slice) → object`, `renderRulesBlock() → string` |
| `lib/slice-store.js` | B | `create / getActive / getById / listRecent / update / setCriterion / recordPush / appendEvent` (own SQL; no edits to `lib/db.js`) |
| `routes/v2/slice.js` | B | the router above |
| `services/intent/repo-sync.js` | C | `previewSync({ slice, project, userToken }) → { branch, files[] }`; `syncSliceToRepo({ slice, project, userToken }) → { mode, commitSha, prUrl, prNumber, rulesFile, branch }`; idempotent on re-run |
| `packages/github/index.js` additions | C | `getRef`, `createRef`, `getFile`, `putFile`, `createPull`, `findOpenPullByHead`, `getBranchProtection` — all take `userToken` |
| `services/intent/slice-verifier.js` | D | `checkProtectedPaths({ slice, commits }) → string[]` (pure); `verifySliceAgainstCommits({ slice, project, commits }) → { criteria, allMet, guardrailTouched }`; `onPush({ project, commits, branch })` hook |
| `services/v2/shipped-runner.js` (one call added) | D | calls `onPush` after existing gap processing |
| `app.js` (mount), migration `028_intent_slices.sql` | B | — |

### Data (migration 028, owner B)

`intent_slices` — one row per slice; columns mirror the Slice shape (`existing`,
`guardrails`, `protected_paths`, `acceptance_criteria`, `sync`, `staging`, `pushes` as
JSONB). Partial unique index: one row per project where `status IN ('active','verifying')`.

`slice_events` — `id, slice_id, kind, metadata, created_at`. Kinds: `activated`,
`prompt_copied`, `synced`, `push_seen`, `guardrail_touched`, `criterion_verdict`,
`criterion_override`, `verified`, `abandoned`. This is the verification log the Shipped
tab will read later.

Funnel events added to the closed list (`lib/telemetry.js` and `services/telemetry.ts`):
`slice_activated`, `slice_synced`, `slice_verified`, `slice_abandoned`. `prompt_copied`
gains `metadata.source = 'slice'`.

### Prompt template (owner A; the exact words matter, agents read them)

```
You are working in <owner/repo> on branch <branch>. This app already exists and parts of it work; extend it, do not rebuild it.

## Already there — build on it
<existing, one per line: path — what it does today>

## Build this
<objective>

## Do not touch
<protected_paths, one per line>

## Do not
<guardrails, one per line, as imperatives>

## Done means
<for each criterion: "- [ac-1] <description> — expected: <expected_behavior>">
<regression criterion last: "- [ac-N] <feature> still works — expected: <behavior>">

## Rules
- Touch only what the objective needs. No refactors outside it. Never modify a path under "Do not touch".
- Reuse what's under "Already there" instead of creating parallel versions.
- Show loading, error and success states for anything a user sees.
- Catch failures and show a readable message on screen.
- When finished, commit and push to <branch>. Takeoff will check each item under "Done means" against your changes and flag any file under "Do not touch" that changed.

## Machine-readable spec (.intent/active.json)
```json
<renderActiveIntent(slice)>
```
```

## Workstreams

Five agents work in parallel in separate worktrees after Agent 0 lands the contracts.
Each owns the files listed above and touches nothing else; shared files have one owner.
Every agent ships tests for its module and a short "how to exercise this by hand" note
in its PR body.

### Agent 0 — contracts (me, half a day, sequential)
- `docs/specs/intent-driven-building.md` (this file), `app/server/lib/slice-types.js` (JSDoc
  typedefs + `SLICE_STATUSES`, `CRITERION_STATUSES`), `app/client/src/services/sliceApi.ts`
  (types + fetch functions against the API table, returning the contract shapes), stub
  modules exporting the signatures above that throw `NotImplemented`, so every branch
  typechecks and tests can mock them.
- Reserve migration `028`. Add the four funnel events.
- Done when: `npm run typecheck` and `npm test` pass on `main` with the stubs.

### Agent A — derive the slice and render the prompt
- `slice-deriver.js`: reuse `next-thing.js`'s inputs (`pickNextCandidate`, settled
  claims, stack, open gaps, security findings) plus the Read's working features (the
  map's shipped/working areas with their files) so the deriver knows what not to break.
  One Claude call via `anthropic-tracked` returning
  `{ objective, existing[1..6], guardrails[3..6], protected_paths[0..8], acceptance_criteria[2..5] }`.
  - For `source: 'manual'`, the first job is grounding: find the files that already
    relate to what the owner typed and put them in `existing` with one line each on what
    they do today. The objective is phrased as finishing/fixing that, not starting it.
  - Guardrails must be specific to the stack ("Use the existing Supabase client in
    lib/db.ts; do not add a second ORM"), not generic ("write clean code").
  - `protected_paths` come from working features unrelated to the slice; never include
    files in `existing`. Globs, repo-relative.
  - Criteria must be checkable by a non-engineer clicking around. The deriver appends one
    `kind: 'regression'` criterion for the top working feature nearest the slice.
  - Reject and retry once if the parse fails; fall back to a rule-based slice from the
    gap's `affectedFiles` (empty `protected_paths`, regression criterion from the map) if
    it fails twice.
- `slice-prompt.js`: pure functions, the template above, `renderRulesBlock`, snapshot tests.
- Tests: fixture inputs for taxonomy and a tiny Express app; assert counts, specificity
  heuristics (each guardrail names a file, package or route; `existing` and
  `protected_paths` are disjoint; last criterion is `regression`), prompt snapshot.
- Hand test: `node -e` against a stored analysis id, once with a typed objective.

### Agent B — store, state machine, API
- Migration 028, `slice-store.js`, `routes/v2/slice.js`, mount in `app.js`.
- State machine: `active → verifying` on first `push_seen`; `verifying → verified` when
  every criterion is `met`; any state → `abandoned`. `activate` 409s when one is active.
  Owner overrides write `verified_by = 'owner'`.
- Calls A's `deriveSlice` / `renderPrompt` and C's `syncSliceToRepo` and D's
  `verifySliceAgainstCommits` through the stub signatures; tests mock them.
- Tests: validation, 409 on double activate, override, access rules (ownerless editable,
  owned 403), 424 path when sync throws `needsReconnect`.
- Hand test: curl sequence in the PR body.

### Agent C — write the spec to the repo
- `packages/github` additions with `userToken` (refs, contents, pulls, branch protection).
- `repo-sync.js`:
  - `previewSync`: read the tree of `slice.branch`, pick the rules file by the detection
    order above, compute the two files' new contents (`.intent/active.json`, rules file
    with the marker block upserted), return `{ branch, files }`. Pure given the tree; no
    writes.
  - `syncSliceToRepo`: commit both files to `slice.branch` directly (contents API, one
    commit per file is acceptable in V1; message "Takeoff: set active intent — <title>").
    If the branch is protected or the commit is rejected (409/422 from protection), fall
    back to branch `takeoff/intent-<sliceId8>` and open a PR titled "Intent: <slice.title>"
    with the criteria as a checklist; return `mode: 'pr'`. Idempotent: on re-run, update
    files in place (pass the current sha), reuse the open PR.
  - Never writes anywhere but the two files. Never rewrites content outside the markers.
  - Map GitHub 403/404 with missing `repo` scope to `{ needsReconnect: true }` so the
    client can send the user through `/auth/github/reconnect`.
- Tests: mocked `fetch`; assert detection order for all four rules-file cases, marker
  replacement leaving the rest byte-identical, direct-commit path, protection → PR
  fallback, idempotency.
- Hand test: against a scratch repo the agent creates under the tester's account, once
  with an existing `CLAUDE.md`, once with `.cursor/rules/`.

### Agent D — verify on push
- `slice-verifier.js`:
  - `checkProtectedPaths`: pure glob intersection of the push's changed files against
    `slice.protected_paths` (ignore `.intent/**` and the rules file). Runs before any LLM
    call; result stored in `pushes.guardrail_touched` and a `guardrail_touched` event.
    This never blocks verification; it is a warning the owner sees.
  - Per criterion: rule pre-check (did the push touch any file in `existing` or any file
    the deriver associated with the slice, or any file at all if none were associated) →
    if yes, Claude classification over the combined patch of the push (cap size; reuse
    `gap-verifier.js`'s prompt style) → `met | unmet | unknown` + one-line evidence.
  - `kind: 'regression'` criteria are judged the other way round: `met` by default when
    no file of the feature changed; `unknown` with the touched files as evidence when
    they did. The LLM is not asked to prove a negative.
  - Never flips `met` back to `unmet` on a later push without an owner override. Writes
    `criterion_verdict` events; sets slice `verifying` on first push, `verified` when all
    met; records `slice_verified` funnel event.
- `shipped-runner.processPush`: one added call to `onPush` after existing work, wrapped
  so a verifier failure never breaks gap processing. Only pushes to `slice.branch` count.
- Tests: fixtures with commits touching / not touching relevant files, touching a
  protected path, touching only the regression feature's files; mocked Claude.
- Hand test: replay a stored `webhook_events` payload.

### Agent E — the Build tab
- `SliceCard` replaces the "next thing + PromptFrame" block on Build:
  - **No slice, owner:** leads with an input, "What do you want to get working next?"
    (one line, submit activates a `manual` slice; while deriving, show "Finding what you
    already have for this…"). Below it, the Read's suggested next thing with **Make this
    the slice**. Every gap card gets **Build this next** (enabled only when no slice is
    active). A quiet line under the input: "Push your latest work first — we read what's
    on GitHub."
  - **No slice, visitor:** the next thing read-only (today's state, minus the Pro frame).
  - **Active:** title, objective, **Already there** list, **Don't touch** list,
    guardrails, criteria checklist (status pills; the regression one labelled "still
    works"), **Copy prompt** (primary), **Add to repo** (secondary; opens a preview of the
    two files from `sync/preview` with a confirm; after sync shows "Added to <branch>" or
    the PR link; shows the reconnect path on 424), "I tested it on staging" toggle + URL,
    **Check now**, **Abandon** (quiet).
  - **Verifying:** same, with "Pushed <relative time>" and per-criterion verdicts and
    evidence appearing as they land. If `pushes.guardrail_touched` is non-empty, a warning
    strip above the criteria: "Your agent changed `lib/auth.ts`, which this slice said to
    leave alone. Check that login still works." It stays until the next push clears it or
    the owner dismisses it.
  - **Verified:** green state, "Pick the next one" → clears to the no-slice state.
  - Visitors see all of the above read-only.
- Funnel: `slice_activated`, `prompt_copied` (`source: 'slice'`), `slice_synced`,
  `slice_verified`.
- Uses `sliceApi.ts` from Agent 0; develops against a local mock until B merges.
- The manuscript CSS (`read.css`) gets a `.slice` block; keep the Tailwind sections
  (`GapsSection`) on the stone system as they are.

### Integration (me, after all five are green)
Merge order A → B → C → D → E. Then on a real, already-built repo I own (one with an
existing `CLAUDE.md` and a live deploy): type an objective, check `existing` names the
right files, add to repo, copy the prompt into Cursor, let it build, push to `main`,
watch the webhook verify and confirm the protected-path check fires when I deliberately
edit a protected file. Fix what breaks, Bugbot, merge. Then update `ROADMAP.md` → Shipped
and move the external test to Now.

## Sequencing and estimate

| Day | Work |
|---|---|
| 1 (am) | Agent 0: contracts, stubs, migration number, funnel events → merged |
| 1 (pm) – 3 | Agents A–E in parallel, each on its own worktree and PR |
| 3 – 4 | Integration, end-to-end on a real repo, fixes |
| 5 | Dogfood a second repo; write the tester script for week 5 |

Sequential this is ~2.5 weeks; parallel it fits the two weeks the roadmap allots.

## Risks and the decision each needs

1. **Write actor.** Using the user's OAuth token means anyone who scans signed-in without
   the `repo` scope hits the reconnect flow on first sync. The GitHub App avoids that but
   is a draft. Recommendation: user token now (sync is optional; the prompt works without
   it), App later behind the same `syncSliceToRepo` signature.
2. **Writing to their default branch.** Earlier draft said PR-only. Reversed because the
   first customers never merge PRs, so a PR means the intent file never lands and their
   agent never sees it. Mitigations: only two non-code files, diff shown before commit,
   marker-scoped edits to the rules file, PR fallback when protection rejects. If this
   still feels wrong after the first external test, flip the default to PR; the module
   already supports both.
3. **Wrong rules file.** Writing `AGENTS.md` beside a `.cursorrules` the owner relies on
   gets ignored. Detection order covers `.cursor/rules/`, `CLAUDE.md`, `AGENTS.md`. Legacy
   `.cursorrules` is deliberately not edited (deprecated format); if it is the only one
   present we create `AGENTS.md`, which Cursor also reads.
4. **Verification false positives.** A criterion marked `met` that isn't erodes trust
   faster than `unknown`. Recommendation: the verifier returns `unknown` unless the patch
   clearly shows the behavior; `met` requires evidence that names a file and a line.
   Regression criteria are judged by file-touch, not by LLM.
5. **Bad `protected_paths`.** Too broad and every push warns; too narrow and the check is
   theatre. Deriver caps at 8 globs, drawn only from working features unrelated to the
   slice; the warning is advisory, never a block. Watch the `guardrail_touched` rate in
   the first external test.
6. **Stale read.** They have local work not yet on GitHub; the slice is grounded in an
   older tree. Copy tells them to push first; the deriver runs against the latest default
   branch at activation time, not the last scan.
7. **Slice from a thin project.** If the next thing can't be derived (no read yet), the
   Build tab must still offer the typed objective and "Build this next" on gaps.
8. **Cost.** One derivation call (~Sonnet, a few thousand tokens) per activation and one
   classification call per feature criterion per push. Cap pushes verified per slice per
   hour at 6; log cost under `analysis_llm_calls` phase `slice_*` so `report:funnel` shows
   it.
