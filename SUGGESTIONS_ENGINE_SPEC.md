# Suggestions Engine — Product & Technical Spec

## Cursor instructions: read this entire file before writing any code

---

## The strategic case

Today, Takeoff tells users **what's missing** — "you don't have auth" or "you
need error handling." That's useful but reactive. The user already knows they're
stuck.

The next leap is **proactive intelligence** — telling users things they
*didn't know to ask about*:

- "Your Express app has no rate limiting — here's a 5-minute fix"
- "You're using Supabase but not RLS — every table is publicly readable"
- "Apps like yours typically add Stripe billing before launch — here's the
  context file to build it"
- "Your React app re-renders the entire page on every state change — wrap
  these components in `React.memo`"
- "You have 12 TODO comments in production code — here are the 3 critical ones"

This transforms Takeoff from a diagnostic tool into **an AI product advisor**.
The moat: every repo we analyze makes the suggestions smarter because we learn
what patterns predict real problems.

---

## What we already have (don't rebuild)

| Existing capability | Where | Reuse strategy |
|---|---|---|
| Stack detection | `analyzer.js → detectStack()` | Input signal — what technology context to use |
| Gap detection | `analyzer.js → detectGaps()` | Input signal — but gaps are coarse (exists/not), suggestions need nuance |
| Feature map | `analyzer.js → detectFeatures()` | Input signal — what the app already does |
| File contents | `analyzer.js → fileContents` | Primary analysis material — up to 150 files read |
| Readiness scores | `readiness-scorer.js` | Prioritization signal — focus suggestions on weak categories |
| Plan generator | `plan-generator.js` | Template library — current plans become "infrastructure suggestions" |
| Context generator | `context-generator.js` | Generation engine — reuse the Claude integration + streaming |
| Features describer | `features-describer.js` | Plain-English framing — tone/style reference |
| PR review prompts | `prompts/repo-review.js` | Pattern — already has structured `recommendations` JSON shape |
| Build Story | `build_entries` table | Usage signal — what the user has actually worked on |
| Project events | `project_events` table | Behavioral signal — what steps they completed/skipped |

**Key insight:** The analyzer already reads the actual code. The suggestion
engine doesn't need new data collection — it needs a **smarter interpretation
layer** on top of the data we already collect.

---

## Suggestion taxonomy

Every suggestion belongs to exactly one type and one category.

### Types

| Type | Icon | What it means |
|------|------|---------------|
| `bug` | 🐛 | Something is broken or will break — security holes, crashes, data loss |
| `fix` | 🔧 | Code smell or anti-pattern that degrades quality — no immediate crash |
| `feature` | ✨ | Capability the app should add based on its purpose and stack |
| `idea` | 💡 | Strategic suggestion — growth, DX, architecture improvement |
| `perf` | ⚡ | Performance problem detectable from code patterns |

### Categories (aligned with readiness scorer)

`auth` · `database` · `deployment` · `testing` · `errorHandling` · `envConfig` ·
`frontend` · `backend` · `security` · `performance` · `dx` (developer experience)

### Priority

| Level | Meaning | Display |
|-------|---------|---------|
| `critical` | Will cause failures in production | Red badge, sorted first |
| `high` | Should fix before launch | Orange badge |
| `medium` | Improves quality significantly | Yellow badge |
| `low` | Nice to have, not blocking | Gray badge |

---

## Suggestion data shape

```typescript
interface Suggestion {
  id: string;                   // deterministic hash of type+category+title
  type: 'bug' | 'fix' | 'feature' | 'idea' | 'perf';
  category: string;             // from category list above
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;                // one-line summary, plain English
  description: string;          // 2-3 sentences explaining why this matters
  evidence: Evidence[];         // what in the code triggered this
  effort: 'quick' | 'medium' | 'large';  // rough implementation size
  contextFile?: string;         // generated .context.md content for this fix
  cursorPrompt?: string;        // copy-paste prompt for Cursor/Claude
  affectedFiles: string[];      // which files to change
  relatedDocs?: string;         // link to relevant docs (Next.js, Supabase, etc.)
  status: 'open' | 'dismissed' | 'done';
  source: 'static' | 'ai';     // how this suggestion was generated
}

interface Evidence {
  file: string;                 // file path in the repo
  line?: number;                // optional line number
  snippet?: string;             // relevant code snippet (truncated)
  reason: string;               // why this evidence matters
}
```

---

## Two-layer architecture: Static Rules + AI Analysis

### Layer 1: Static rule engine (fast, deterministic, free)

Pattern-matching rules that run against the already-collected analysis data.
No Claude call needed. These fire instantly during the existing analysis
pipeline.

**File:** `app/server/services/suggestion-rules.js`

```
INPUT: { stack, gaps, features, structure, fileContents, fileTree, buildPlan }
OUTPUT: Suggestion[]
```

#### Rule catalog (initial set — 40+ rules)

**Security (critical/high)**
- `no-rls`: Supabase detected + no RLS policies in schema → "Your database
  tables are publicly readable"
- `env-in-code`: Hardcoded API keys/secrets in source files (regex scan of
  fileContents for `sk-`, `ghp_`, `password =`, etc.)
- `no-cors`: Express app with no `cors()` middleware
- `no-helmet`: Express app with no `helmet()` or security headers
- `no-rate-limit`: Express app with no `express-rate-limit` in deps
- `no-csrf`: Form-heavy app with no CSRF protection
- `jwt-no-expiry`: JWT usage without expiration in token config
- `public-env-secrets`: `NEXT_PUBLIC_` prefix on secret-looking values

**Database (high)**
- `no-migrations`: Database detected but no migration files/tool
- `no-schema-validation`: No Zod/Joi/Yup in deps for input validation
- `raw-sql`: SQL strings in code without parameterized queries (SQLi risk)
- `no-connection-pooling`: Direct DB connections without pooling
- `missing-indexes`: Schema file exists but common query patterns lack indexes

**Auth (high)**
- `auth-no-middleware`: Auth library in deps but no middleware protecting routes
- `no-session-expiry`: Session/token config without timeout
- `password-no-hash`: Password handling without bcrypt/argon2

**Error handling (medium)**
- `no-global-handler`: Express/Next.js without global error handler
- `unhandled-promises`: async functions without try/catch in route handlers
- `console-log-errors`: `console.log(err)` instead of proper logging
- `empty-catch`: `catch (e) {}` or `catch (e) { /* ignore */ }`

**Performance (medium)**
- `no-image-optimization`: Next.js app using `<img>` instead of `next/image`
- `large-bundle-no-splitting`: React app without lazy/dynamic imports and 20+
  component files
- `no-caching-headers`: API routes without cache-control headers
- `n-plus-one`: ORM usage patterns suggesting N+1 queries
- `no-debounce-search`: Search input without debounce pattern

**Testing (medium)**
- `no-tests`: No test files or testing deps at all
- `test-deps-no-files`: Jest/Vitest in deps but zero test files
- `no-e2e`: Unit tests exist but no e2e (Playwright/Cypress)
- `api-no-tests`: API routes with zero test coverage

**Deployment (medium)**
- `no-health-check`: Server app without `/health` or `/healthz` endpoint
- `no-graceful-shutdown`: Node.js server without `SIGTERM` handling
- `no-env-validation`: Uses env vars but no validation on startup (Zod, envalid)
- `hardcoded-localhost`: `localhost:` or `127.0.0.1` in non-dev code
- `no-dockerfile`: Deploying to Railway/Docker without Dockerfile

**DX (low)**
- `no-linter`: No ESLint/Biome/Prettier config
- `no-typescript`: JavaScript project with 20+ files and no TS config
- `no-path-aliases`: Deep relative imports (`../../../`) without aliases
- `inconsistent-naming`: Mix of camelCase and snake_case in same directory
- `no-readme`: No README.md or empty README

**Frontend (medium)**
- `no-loading-states`: API calls without loading/skeleton UI patterns
- `no-error-boundaries`: React app without ErrorBoundary components
- `no-meta-tags`: Next.js pages without metadata/head tags
- `no-responsive`: No responsive/mobile styles (no media queries, no Tailwind
  responsive prefixes in 90%+ of component files)

### Layer 2: AI analysis engine (deep, contextual, costs tokens)

Claude analyzes the codebase holistically — understanding business logic,
architectural patterns, and suggesting features based on what the app is
*trying to be*.

**File:** `app/server/services/suggestion-ai.js`

```
INPUT: { stack, gaps, features, fileContents, fileTree, staticSuggestions }
OUTPUT: Suggestion[]
```

**Claude prompt strategy:**

```
System: You are a senior staff engineer and product advisor reviewing a
codebase. You've already been given a list of static analysis findings.
Your job is to go deeper:

1. BUSINESS LOGIC SUGGESTIONS — Based on what this app does, what features
   are users going to expect? (e.g., a SaaS app without billing, a social
   app without notifications, an e-commerce app without search)

2. ARCHITECTURE SUGGESTIONS — Given the stack and codebase size, what
   architectural improvements would prevent problems at scale? (e.g.,
   extract shared logic into hooks, add API versioning, separate concerns)

3. BUG DETECTION — Read the actual code. Find logic errors, race conditions,
   incorrect API usage, missing edge cases. Cite specific files and lines.

4. STACK-SPECIFIC BEST PRACTICES — Based on the framework (Next.js, Express,
   etc.), what framework-specific patterns is the codebase violating?
   (e.g., not using Next.js App Router conventions, not using Supabase RLS)

Return structured JSON matching the Suggestion[] schema.

Important:
- Don't repeat suggestions already in the static list
- Every suggestion MUST cite specific files/lines as evidence
- Prioritize suggestions that prevent real user-facing problems
- Generate a Cursor-ready prompt for each suggestion so the user can
  fix it immediately
- Limit to 10-15 high-signal suggestions — quality over quantity
```

**User message includes:**
- Project name, description, detected stack
- Feature map with file counts
- Gap summary (which areas are missing)
- File tree (first 100 paths)
- Key file contents (up to 20 files, 2000 chars each — prioritize route
  handlers, auth code, database queries, config files)
- Static suggestions already found (so Claude doesn't duplicate)

---

## Pipeline integration

### Where it runs in the Takeoff flow

```
POST /api/takeoff
  ↓
  analyzeRepo()           ← existing
  ↓
  describeFeatures()      ← existing
  ↓
  detectBuildPlan()       ← existing
  ↓
  scoreReadiness()        ← existing
  ↓
  runStaticSuggestions()  ← NEW (fast, synchronous, no API call)
  ↓
  generatePlan()          ← existing (can consume suggestions for richer steps)
  ↓
  status: 'ready'
  ↓
  runAISuggestions()      ← NEW (async, streams via SSE, non-blocking)
  ↓
  status: 'suggestions-ready'   ← NEW status
```

**Why this order:**
- Static rules run instantly — user sees suggestions as soon as analysis completes
- AI suggestions stream in after — the page progressively enriches
- If Claude fails or times out, static suggestions still show. Graceful degradation.
- Plan generator can reference static suggestions to create more targeted steps

### SSE events

```
{ type: 'suggestions-static', suggestions: Suggestion[] }   // instant
{ type: 'suggestions-ai-start' }                            // Claude thinking
{ type: 'suggestions-ai-stream', partial: string }          // streaming
{ type: 'suggestions-ai-complete', suggestions: Suggestion[] }  // done
```

---

## Database changes

### New table: `suggestions`

```sql
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- bug, fix, feature, idea, perf
  category TEXT NOT NULL,
  priority TEXT NOT NULL,       -- critical, high, medium, low
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT,                -- JSON array
  effort TEXT,                  -- quick, medium, large
  context_file TEXT,            -- generated .context.md
  cursor_prompt TEXT,
  affected_files TEXT,          -- JSON array
  related_docs TEXT,
  status TEXT DEFAULT 'open',   -- open, dismissed, done
  source TEXT NOT NULL,         -- static, ai
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX idx_suggestions_project ON suggestions(project_id);
CREATE INDEX idx_suggestions_priority ON suggestions(project_id, priority);
```

### `deployments` table additions

Add column: `suggestions_count INTEGER DEFAULT 0` — denormalized count for
dashboard display without joining.

---

## API endpoints

### `GET /api/takeoff/:id/suggestions`

Returns all suggestions for a project, sorted by priority then type.

```json
{
  "suggestions": [...],
  "summary": {
    "total": 23,
    "byType": { "bug": 3, "fix": 8, "feature": 7, "idea": 3, "perf": 2 },
    "byPriority": { "critical": 2, "high": 7, "medium": 10, "low": 4 },
    "topCategory": "security"
  }
}
```

### `PATCH /api/takeoff/:id/suggestions/:suggestionId`

Update status: `{ "status": "dismissed" }` or `{ "status": "done" }`

### `POST /api/takeoff/:id/suggestions/:suggestionId/context`

Generate a full `.context.md` file for a specific suggestion (on-demand,
since generating context for all 20+ suggestions upfront is wasteful).

Returns streamed context file content via SSE.

### `POST /api/takeoff/:id/suggestions/refresh`

Re-run suggestion engine (e.g., after user has made changes and wants
fresh analysis). Clears existing suggestions and regenerates.

---

## Frontend

### New page: `SuggestionsView.tsx`

**URL:** `/takeoff/:id/suggestions`

**Accessible from:** ReadinessReport (new tab), ProductionPlan (sidebar link),
ProjectView (new tab alongside Build Story / Analytics)

**Layout:**

```
┌─────────────────────────────────────────────────────┐
│  Suggestions for myapp                    23 found  │
│                                                     │
│  [All] [Bugs 3] [Fixes 8] [Features 7] [Ideas 3]  │
│                                                     │
│  ┌─ 🐛 CRITICAL ─────────────────────────────────┐ │
│  │ No Row Level Security on Supabase tables       │ │
│  │ Your database tables are publicly readable.    │ │
│  │ Anyone with your Supabase URL can read, write, │ │
│  │ and delete all data.                           │ │
│  │                                                │ │
│  │ Evidence:                                      │ │
│  │   prisma/schema.prisma — no RLS policies       │ │
│  │   src/lib/supabase.ts — anon key exposed       │ │
│  │                                                │ │
│  │ Effort: ⏱ Quick fix (15 min)                   │ │
│  │                                                │ │
│  │ [Copy Cursor Prompt] [Generate Fix] [Dismiss]  │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ 🔧 HIGH ─────────────────────────────────────┐ │
│  │ Express routes missing input validation        │ │
│  │ ...                                            │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  ┌─ ✨ MEDIUM ────────────────────────────────────┐ │
│  │ Add Stripe billing — SaaS apps need payments   │ │
│  │ Your app has user auth and a dashboard, which   │ │
│  │ suggests a SaaS model. Users will expect...    │ │
│  │ ...                                            │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Interactions:**

- **Filter tabs** — filter by type, updates count badges
- **Priority sections** — critical at top, collapsible
- **"Copy Cursor Prompt"** — copies a ready-to-paste prompt to clipboard
- **"Generate Fix"** — calls the context endpoint, shows streaming .context.md
  in an expandable panel below the suggestion
- **"Dismiss"** — marks as dismissed, moves to bottom/hidden
- **"Mark Done"** — user confirms they've implemented it
- **Progress bar** — shows suggestions addressed vs total (gamification)

### Integration with existing pages

**ReadinessReport.tsx** — add a new tab: "Suggestions (23)" alongside
"What It Does", "Readiness", and "Codebase Details". Shows top 5 critical/high
suggestions with a "View all →" link.

**ProductionPlan.tsx** — each plan step can reference related suggestions.
If the "Add authentication" step is shown, link to the 3 auth-related
suggestions underneath it.

**Dashboard/ProjectView** — show suggestion count badge on each project card.
"12 suggestions · 3 critical" as a quick health indicator.

---

## Usage analytics integration (Phase 2)

Once we have enough users, the suggestion engine gets dramatically smarter:

### Cross-repo pattern learning

```
When 80% of Next.js + Supabase apps in our system have added:
  - RLS policies
  - Email verification
  - Password reset flow
  - Rate limiting on auth endpoints

And this app hasn't → suggest these with HIGH confidence

Framing: "Most apps like yours have already added [X]"
```

### Completion-based suggestions

```
When users who had readiness score 45 improved to 85, track what they built:
  - 90% added auth middleware
  - 85% added input validation
  - 70% added error boundaries

For a new user at score 45 → suggest these in priority order

Framing: "Builders who shipped similar apps focused on [X] first"
```

### Time-series suggestions

```
If the user re-analyzes after 2 weeks and hasn't touched auth:
  → Re-surface auth suggestions with higher priority
  → "You've been building for 2 weeks but auth is still missing —
     this will block every user-facing feature"
```

### Implementation

**File:** `app/server/services/suggestion-analytics.js`

```js
// Aggregates anonymized patterns across all analyzed repos
async function getStackPatterns(stack) {
  // Query: for repos with this stack combination,
  // what suggestions were most commonly marked 'done'?
  // What capabilities do 80%+ of similar repos have?
}

async function getCompletionPaths(currentScore, stack) {
  // Query: for repos that went from score ~X to 85+,
  // what did they build and in what order?
}
```

This requires:
- Anonymized aggregation of `suggestions` table across projects
- New table: `suggestion_outcomes` tracking which suggestions led to
  score improvements on re-analysis
- Careful privacy: never expose one user's code patterns to another

---

## Build order

### Session 1: Static rule engine (2-3 hours)

1. Create `app/server/services/suggestion-rules.js`
   - Implement the rule framework: each rule is a function that takes analysis
     data and returns `Suggestion[]` or `null`
   - Start with 10 highest-signal rules:
     - `no-rls`, `env-in-code`, `no-rate-limit`, `no-helmet`
     - `no-input-validation`, `no-error-handler`, `no-tests`
     - `hardcoded-localhost`, `no-env-validation`, `no-health-check`
   - Each rule: regex/heuristic scan of `fileContents` and `stack`/`gaps`

2. Wire into `takeoff.js` pipeline after `scoreReadiness()`
   - Run rules, store results in `suggestions` table
   - Broadcast via SSE: `suggestions-static`

3. Add `GET /api/takeoff/:id/suggestions` endpoint
4. Add `PATCH /api/takeoff/:id/suggestions/:id` for status updates
5. Test: analyze a real repo, verify suggestions appear

### Session 2: Frontend — SuggestionsView (2-3 hours)

1. Create `app/client/src/pages/SuggestionsView.tsx`
   - Type filter tabs with count badges
   - Priority-grouped suggestion cards
   - Copy Cursor Prompt button
   - Dismiss / Mark Done actions
   - Progress bar

2. Add route to `App.tsx`: `/takeoff/:id/suggestions`
3. Add "Suggestions" tab to `ReadinessReport.tsx`
4. Add suggestion count to project cards in Dashboard
5. Test: full flow — analyze → see suggestions → copy prompt → dismiss

### Session 3: AI suggestion layer (2-3 hours)

1. Create `app/server/services/suggestion-ai.js`
   - Claude integration with the deep analysis prompt
   - Structured JSON output parsing
   - Deduplication against static suggestions

2. Wire into pipeline as async post-`ready` step
   - SSE streaming for AI suggestions
   - Graceful degradation if Claude fails

3. Add "Generate Fix" button flow
   - `POST /api/takeoff/:id/suggestions/:id/context`
   - Streams .context.md generation for a specific suggestion
   - Expandable panel in SuggestionsView

4. Test: verify AI suggestions are non-overlapping and cite real files

### Session 4: Remaining rules + polish (2 hours)

1. Implement remaining 30+ static rules from the catalog
2. Add suggestion count to SSE `complete` event payload
3. Add suggestions to the shareable story page
4. Add `POST /api/takeoff/:id/suggestions/refresh` endpoint
5. Polish: loading states, empty states, error handling

### Session 5: Plan integration + analytics groundwork (2 hours)

1. Modify `plan-generator.js` to reference related suggestions in each step
2. Add `relatedSuggestions` field to plan steps
3. Create `suggestion_outcomes` table for future analytics
4. Add anonymized telemetry: which suggestions get dismissed vs done
5. Prepare the `suggestion-analytics.js` skeleton for Phase 2

---

## Files to create

```
app/server/services/suggestion-rules.js     ← static rule engine
app/server/services/suggestion-ai.js        ← Claude-powered deep analysis
app/server/services/suggestion-analytics.js ← Phase 2: cross-repo patterns
app/server/routes/suggestions.js            ← API endpoints
app/client/src/pages/SuggestionsView.tsx    ← main suggestions UI
```

## Files to modify

```
app/server/routes/takeoff.js    ← wire suggestion engine into pipeline
app/server/lib/db.js            ← add suggestions table
app/client/src/App.tsx          ← add suggestions route
app/client/src/pages/ReadinessReport.tsx  ← add suggestions tab
app/client/src/pages/ProductionPlan.tsx   ← link suggestions to steps
app/client/src/pages/ProjectView.tsx      ← add suggestions tab
app/client/src/services/api.ts  ← add suggestion API types + calls
```

---

## Success metrics

| Metric | Target | Why it matters |
|--------|--------|----------------|
| Suggestions per repo | 10-25 | Enough to be useful, not overwhelming |
| Critical/high accuracy | >90% | False alarms for critical = lost trust |
| "Copy Prompt" click rate | >30% | Users find suggestions actionable |
| "Dismiss" rate for critical | <10% | Critical suggestions are real |
| Score improvement on re-analyze | +15 avg | Suggestions actually helped |
| Suggestion → Done conversion | >20% | Users implement what we suggest |

---

## What this is NOT

- **Not a linter.** ESLint exists. We don't re-flag semicolons or unused vars.
  We flag architectural and product-level problems.
- **Not a security scanner.** Snyk/Dependabot exist. We flag the *obvious*
  security mistakes that vibe coders make (no RLS, hardcoded keys, no rate
  limiting) — not CVEs in transitive deps.
- **Not a code review.** The existing PR review feature covers that. This is
  a *project-level* analysis, not a diff-level one.
- **Not prescriptive about implementation.** We say "you need rate limiting"
  and provide a Cursor prompt to add it — we don't force a specific library.

---

## Competitive positioning

| Competitor | What they do | Our advantage |
|-----------|-------------|---------------|
| SonarQube | Static analysis for code quality | We understand product context, not just code quality |
| CodeClimate | Maintainability scoring | We suggest features and business logic, not just refactors |
| GitHub Copilot | Code completion | We analyze the whole repo, not the current file |
| Dependabot | Dependency updates | We focus on architecture and missing capabilities |
| **Takeoff** | **Whole-repo AI advisor** | **Product + code + deployment intelligence in one** |

The unique value: we're the only tool that says "your SaaS app needs billing"
because we understand what the app *is*, not just what the code *does*.
