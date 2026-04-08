# BUILD_LOG.md — Session Prompts & Changes

## ai-log

### 2026-04-08 · cursor (session 1) — Code Review + Phase 2 + Auth + Error Handling

---

#### Prompt 1: Code Review
```
You are the code reviewer for all the updates made by other agents,
perform a code review as the best software engineer in the world.
```
**What happened:** Full codebase audit. Identified 18 issues across Critical/High/Medium/Low:
- Critical: DeployProgress re-triggers deploy on refresh, ReadinessReport calls navigate() during render
- High: No authorization on takeoff endpoints, deploy routes dead code without Supabase, SSE events lost between POST and stream connect
- Medium: Pervasive `any` types, lazy requires, empty catch blocks, duplicated JSON parsing, no EventSource cleanup
- Low: DB file naming, CORS callback error

**Files analyzed:** All route files, all frontend pages, app.js, db.js, useSSE.ts, api.ts, sse/index.js

---

#### Prompt 2: Fix All Issues
```
Start 2 other agents who are the other top software engineers
in the world and instruct them well to fix all the issues.
```
**What happened:** Two parallel agents executed all 18 fixes:

*Agent 1 (Backend):*
- `app/server/routes/takeoff.js` — Added `checkProjectAccess()`, `parseJsonFields()` utility, SSE event replay via `getRecentEvents()`
- `app/server/routes/deploy.js` — Top-level `require('@codeguru/railway')`, pass `userId` param to `runDeploy`
- `app/server/app.js` — Deploy routes return 503 without Supabase, CORS `callback(null, false)`
- `packages/sse/index.js` — Event buffering with `eventBuffers` Map, `BUFFER_TTL_MS`, `getRecentEvents()`
- `app/server/lib/db.js` — Renamed DB to `takeoff.db`, fixed `buildEntries.create` metadata

*Agent 2 (Frontend):*
- `app/client/src/pages/DeployProgress.tsx` — Check project status before triggering deploy
- `app/client/src/pages/ReadinessReport.tsx` — Move navigate() into useEffect
- `app/client/src/pages/ProductionPlan.tsx` — Rollback optimistic UI on API failure
- `app/client/src/pages/AnalysisProgress.tsx` — `ProgressMessage` interface, remove `as any`
- `app/client/src/hooks/useSSE.ts` — Auto-close EventSource on terminal events
- `app/client/src/services/api.ts` — TypeScript interfaces for all API types

---

#### Prompt 3: Build Phase 2
```
What's the next phase? → Yes (proceed with Phase 2)
```
**What happened:** Two parallel agents built Phase 2 (Dashboard + BuildStory + Polish):

*Agent 1 (Backend):*
- `app/server/routes/projects.js` — GET/DELETE user projects, `projectSummary()`, rate limiting
- `app/server/routes/build-story.js` — CRUD for build entries, `POST /generate-context` via Claude API

*Agent 2 (Frontend):*
- `app/client/src/pages/Dashboard.tsx` — Redesigned with Projects/Analyses/Reviews tabs, ProjectCard grid
- `app/client/src/pages/ProjectView.tsx` — Project detail with Overview/Build Story/Settings tabs
- `app/client/src/pages/BuildStory.tsx` — Timeline UI, inline entry form, .context.md generation
- `app/client/src/App.tsx` — New routes for `/projects/:id` and `/projects/:id/story`
- `app/client/src/services/api.ts` — New functions: fetchProjects, fetchProjectDetail, CRUD for build entries

---

#### Prompt 4: Local Testing Setup
```
We need to test this manually or deploy ASAP.
Yes, what API keys are needed?
```
**What happened:**
- Started Express server on port 3001, Vite on port 3000
- Resolved port conflicts (killed stale Node processes)
- Fixed `dotenv` path — `app.js` was loading from project root instead of `app/.env`
- Changed to: `require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') })`
- Confirmed all keys loaded: Anthropic, GitHub, Supabase

---

#### Prompt 5: Fix GitHub OAuth
```
Auth with GitHub not working maybe because it needs to reset user sessions?
```
**What happened:** Diagnosed that GitHub OAuth wasn't configured in Supabase dashboard. Guided user through:
1. Creating GitHub OAuth App with callback URL `https://jwiclkqbrmptgdongkgr.supabase.co/auth/v1/callback`
2. Enabling GitHub provider in Supabase dashboard with Client ID + Secret
3. Adding `http://localhost:3000/auth/callback` to Supabase redirect URLs

---

#### Prompt 6: Fix OAuth Callback Flow
```
Now: {"error":"Missing authorization code"}
(URL shows hash fragment with access_token)
```
**What happened:** Supabase uses implicit OAuth flow (tokens in URL hash fragment), but Express can't see hash fragments. Fixed by:
- Created `app/client/src/pages/AuthCallback.tsx` — React page that extracts tokens from `#access_token=...` hash, sends to backend
- Added `POST /auth/token` endpoint in `app.js` — validates token with Supabase, sets httpOnly cookies
- Added Vite proxy bypass for `/auth/callback` so React handles it instead of proxying to Express
- Updated `app/client/vite.config.ts` with `bypass()` function on `/auth` proxy
- Added `/auth/clear` endpoint for cookie cleanup
- Changed `afterLogin` redirect to `/dashboard`

---

#### Prompt 7: GitHub Repo Picker
```
I need to be able to select from my repos if I'm logged in through my GitHub account.
```
**What happened:**
- `app/client/src/pages/AuthCallback.tsx` — Now captures `provider_token` from OAuth hash
- `app/server/app.js` `POST /auth/token` — Stores `gh-provider-token` cookie
- `app/server/routes/github.js` — New `GET /my-repos` endpoint using user's GitHub provider token
- `app/client/src/services/api.ts` — New `GitHubRepo` interface, `fetchMyRepos()` function
- `app/client/src/pages/Landing.tsx` — Full rewrite with two modes:
  - "My Repos" tab: searchable dropdown of user's repos (private included, with lock icon, language, stars, recency)
  - "Paste URL" tab: original URL input for any public repo
  - Shows re-login prompt if provider token is expired

---

#### Prompt 8: Global Error Handling
```
Execute Global error handling strategy. Catches unhandled errors,
returns structured responses, and prevents crashes.
```
**What happened:** Two parallel agents:

*Agent 1 (Backend):*
- `app/server/lib/app-error.js` — Enhanced with `isOperational`, added `unauthorized`, `forbidden`, `conflict` helpers
- `app/server/lib/async-handler.js` — Created `asyncHandler` wrapper (catches async errors → `next(err)`)
- `app/server/app.js` — Enhanced centralized error middleware: AppError, SyntaxError (400), JWT errors (401), production message hiding
- Added `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers
- Retrofitted 8 route files: `takeoff.js`, `deploy.js`, `projects.js`, `build-story.js`, `github.js`, `analyze.js`, `reviews.js`, `fix-prompts.js`
  - All use `asyncHandler()` wrapper — no more manual try/catch in routes
  - Validation errors throw `AppError.badRequest()`, not found throws `AppError.notFound()`
  - Background functions (`runTakeoff`, `runDeploy`) kept their try/catch (run outside request cycle)

*Agent 2 (Frontend):*
- `app/client/src/lib/api-error.ts` — `ApiError` class + `handleApiResponse<T>()` helper
- `app/client/src/components/ErrorBoundary.tsx` — Redesigned with nightsky theme, AlertTriangle icon, friendly message (no raw error exposed), "Try again" stays on page, "Go home" secondary
- `app/client/src/services/api.ts` — All mutating API calls use `handleApiResponse`

---

## Files Changed (41 total)

### New files (21)
| File | Purpose |
|------|---------|
| `TAKEOFF_PLAN.md` | Full transformation plan |
| `context_tech_arch.md` | Technical architecture doc |
| `app/server/routes/takeoff.js` | Takeoff pipeline: analyze → score → plan |
| `app/server/routes/deploy.js` | Railway deployment flow |
| `app/server/routes/projects.js` | User project management |
| `app/server/routes/build-story.js` | Build journal CRUD + .context.md generation |
| `app/server/lib/async-handler.js` | Express async error wrapper |
| `app/server/services/build-detector.js` | Framework → build plan mapping |
| `app/server/services/plan-generator.js` | Claude-powered step-by-step plans |
| `app/server/services/readiness-scorer.js` | Production readiness scoring |
| `app/server/scripts/test-deploy.js` | Deploy testing utility |
| `packages/railway/index.js` | Railway GraphQL API client |
| `packages/railway/package.json` | Railway package manifest |
| `app/client/src/lib/api-error.ts` | Frontend ApiError + handleApiResponse |
| `app/client/src/pages/AnalysisProgress.tsx` | SSE-driven analysis progress |
| `app/client/src/pages/AuthCallback.tsx` | OAuth implicit flow handler |
| `app/client/src/pages/BuildStory.tsx` | Build journal timeline |
| `app/client/src/pages/DeployProgress.tsx` | Deployment progress tracking |
| `app/client/src/pages/ProductionPlan.tsx` | Interactive step-by-step plan |
| `app/client/src/pages/ProjectView.tsx` | Project detail + tabs |
| `app/client/src/pages/ReadinessReport.tsx` | Readiness score + recommendations |

### Modified files (20)
| File | Changes |
|------|---------|
| `app/server/app.js` | dotenv path fix, auth token endpoints, error middleware, process handlers |
| `app/server/lib/app-error.js` | isOperational, new static helpers |
| `app/server/lib/db.js` | Renamed to takeoff.db, new tables |
| `app/server/routes/analyze.js` | asyncHandler retrofit |
| `app/server/routes/fix-prompts.js` | asyncHandler retrofit |
| `app/server/routes/github.js` | asyncHandler + `/my-repos` endpoint |
| `app/server/routes/reviews.js` | asyncHandler retrofit |
| `packages/sse/index.js` | Event buffering + getRecentEvents |
| `app/client/src/App.tsx` | New routes + AuthCallback |
| `app/client/src/components/ErrorBoundary.tsx` | Nightsky redesign |
| `app/client/src/components/Header.tsx` | Updated navigation |
| `app/client/src/hooks/useSSE.ts` | Terminal event auto-close |
| `app/client/src/index.css` | Theme updates |
| `app/client/src/pages/Dashboard.tsx` | Full redesign with tabs |
| `app/client/src/pages/Landing.tsx` | Repo picker + dual mode |
| `app/client/src/services/api.ts` | Types, new endpoints, handleApiResponse |
| `app/client/vite.config.ts` | Auth callback proxy bypass |
| `app/.env.example` | New env vars |
| `app/package.json` | New dependency |
| `package-lock.json` | Lock file update |

## status
Committed as `2e26090` on `main`. Not pushed.
