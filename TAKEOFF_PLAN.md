# TAKEOFF — Transformation Plan

## Vision

CodeGuru becomes **Takeoff**: the tool that takes AI-built apps from localhost
to production.

Core loop: **Paste repo URL → analyze readiness → smart path:**
- **≥90% ready** → "Your app is ready. Deploy now." (one-click deploy)
- **<90% ready** → "Here's your plan to ship." (step-by-step productionalization)
- **User always picks** — both options visible, system highlights the recommendation

The existing codebase already does most of the analysis work — it reads GitHub
repos, detects frameworks, identifies gaps, calculates completion %, and streams
progress via SSE. The transformation is: instead of outputting `.context.md`
files as the final product, the analysis drives **two actionable paths** — deploy
now or plan first.

The second pillar is **BuildStory** — a build journal where users capture the
prompts, decisions, and context of how they built their app. Working through
the plan auto-populates BuildStory. Shareable build stories become a growth
loop ("here's how I built this app in a weekend"). And `.context.md` generation
becomes the *output* of BuildStory rather than a standalone feature.

---

## Architectural Strategy

### What stays (and why)

| Existing piece | Reuse as | Rationale |
|---------------|----------|-----------|
| `@codeguru/github` package | Repo reading + framework detection | Already handles tree, file reads, metadata |
| `analyzer.js` → `detectStack()` | **Deploy intelligence** — determine framework, runtime, build command | Already detects Next.js, React, Vue, Angular, Svelte, Express, Python, Go, Rust |
| `analyzer.js` → `detectDeploymentFiles()` | Check if repo already has deploy config (Dockerfile, etc.) | Use existing config if present instead of guessing |
| `@codeguru/sse` package | Stream deploy progress to browser | Same pattern: progress → building → deploying → live |
| `@codeguru/auth` package | GitHub OAuth login (needed to access repos + persist deploys) | Already works, just make auth required for deploy |
| SQLite + `lib/db.js` pattern | Store deployments, user projects | Same CRUD pattern, new tables |
| Express server + Vite client | Same stack | No reason to rewrite |
| SSE hooks (`useSSE`) | Stream deploy progress on frontend | Identical pattern to analysis streaming |
| Docker + Railway hosting | Host Takeoff itself | Already configured |

### What changes

| Current | Becomes |
|---------|---------|
| `POST /api/analyze` → generates .context.md | `POST /api/takeoff` → analyzes → scores readiness → recommends path |
| `Analysis.tsx` (SSE progress for analysis) | `AnalysisProgress.tsx` (SSE progress, then → path choice) |
| `Results.tsx` (context files + gaps) | `ReadinessReport.tsx` (score + dual path: Deploy Now / Plan to Ship) |
| `Landing.tsx` hero: .context.md focus | Hero: "Paste your repo. We'll tell you what it needs to ship." |
| `Dashboard.tsx` (list of analyses + reviews) | `Dashboard.tsx` (list of projects: deployed, in-plan, analyzed) |
| `analyses` DB table | `projects` DB table (analysis + plan + deployment state in one) |
| Brand: CodeGuru / violet theme | Brand: Takeoff / nightsky gold theme |

### What's new

| New piece | Purpose |
|-----------|---------|
| `services/plan-generator.js` | From gaps → generate step-by-step productionalization plan with context files + prompts |
| `services/build-detector.js` | From analyzer output → build/deploy config for Railway ✅ (Phase 0 done) |
| `packages/railway/` | `@codeguru/railway` — Railway GraphQL client ✅ (Phase 0 done) |
| `routes/takeoff.js` | `POST /api/takeoff` (analyze + score), `GET /api/takeoff/:id`, `GET /api/takeoff/:id/stream` |
| `routes/deploy.js` | `POST /api/deploy/:projectId` (trigger deploy), `GET /api/deploy/:id/stream`, `POST /api/deploy/:id/redeploy` |
| `routes/projects.js` | CRUD for user's projects (deployed or in-plan) |
| `ReadinessReport.tsx` | The decision point: score + both paths |
| `ProductionPlan.tsx` | Step-by-step plan view with context files + prompts per step |
| `DeployProgress.tsx` | SSE-streamed deploy progress |
| `ProjectView.tsx` | Live app management + BuildStory tab |

---

## Core Pipeline — Analyze → Route → Act

```
User pastes GitHub repo URL + clicks "Analyze My App"
       │
       ▼
POST /api/takeoff { repoUrl }
       │
       ├── optionalAuth (works without login, auth for persistence)
       ├── validate GitHub URL
       ├── create 'projects' row (status: analyzing)
       │
       ▼  (setImmediate — non-blocking)
  ┌─────────────────────────────────────────┐
  │  STAGE 1: ANALYZE (reuse existing)       │
  │                                          │
  │  analyzer.js (full analysis):            │
  │    github.parseRepoUrl → owner, repo     │
  │    github.fetchRepoMeta → description    │
  │    github.fetchRepoTree → file listing   │
  │    Read ~30 key files via GitHub API     │
  │    detectStack() → framework, runtime    │
  │    detectDeploymentFiles() → existing cfg│
  │    detectGaps() → auth, db, deploy, etc  │
  │                                          │
  │  SSE: "Analyzing your repo..."           │
  │  SSE: "Detected: Next.js + Tailwind"     │
  │  ~5-10 seconds                           │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 2: SCORE + ROUTE                  │
  │                                          │
  │  readiness-scorer.js:                    │
  │    Input: gaps, stack, deployInfo        │
  │    Output: {                             │
  │      score: 0-100,                       │
  │      categories: {                       │
  │        frontend: { score, status },      │
  │        backend:  { score, status },      │
  │        auth:     { score, status },      │
  │        database: { score, status },      │
  │        errorHandling: { score, status }, │
  │        envConfig: { score, status },     │
  │        deployment: { score, status },    │
  │        testing:  { score, status },      │
  │      },                                  │
  │      recommendation: 'deploy' | 'plan', │
  │      planSteps: [...] (if < 90%),        │
  │    }                                     │
  │                                          │
  │  build-detector.js:                      │
  │    → deploy config (for both paths)      │
  │                                          │
  │  SSE: "Your app is 72% production-ready" │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  ┌─────────────────────────────────────────┐
  │  STAGE 3: GENERATE CONTEXT (if < 90%)    │
  │                                          │
  │  context-generator.js (existing):        │
  │    For each gap → generate .context.md   │
  │    + ready-to-paste Cursor prompt        │
  │                                          │
  │  plan-generator.js (new):                │
  │    Prioritize gaps into ordered steps    │
  │    Each step: title, why, context file,  │
  │    prompt, estimated effort              │
  │                                          │
  │  SSE: "Generating your plan..."          │
  │  SSE: streaming plan steps               │
  └──────────────────┬──────────────────────┘
                     │
                     ▼
  Store results in 'projects' row
  SSE: { type: 'complete', score, recommendation, ... }
       │
       ▼
Browser shows: ReadinessReport with dual-path choice
```

### Path A: Deploy Now (score ≥ 90%, or user chooses)

```
User clicks "Deploy" on ReadinessReport
       │
       ▼
POST /api/deploy/:projectId
       │
       ├── requireAuth (need identity for Railway)
       ├── read project's build plan from DB
       │
       ▼  (setImmediate)
  railway.createProject → createServiceFromRepo
  → setVariables → addDomain → poll status
  → SSE: building → deploying → live!
       │
       ▼
  Update project (status: 'live', live_url)
  Auto-log deploy_event to BuildStory
```

### Path B: Plan to Ship (score < 90%, or user chooses)

```
User clicks "See Plan" on ReadinessReport
       │
       ▼
Browser shows: ProductionPlan.tsx
  ┌──────────────────────────────────────────┐
  │  Your Plan to Ship (5 steps)             │
  │                                          │
  │  Step 1: Add authentication        ❌    │
  │    Why: No auth detected                 │
  │    Recommended: Supabase Auth            │
  │    [Copy context file] [Copy prompt]     │
  │    [Mark as done ✓]                      │
  │                                          │
  │  Step 2: Set up database           ❌    │
  │    Why: No database or schema found      │
  │    Recommended: Prisma + Postgres        │
  │    [Copy context file] [Copy prompt]     │
  │    [Mark as done ✓]                      │
  │                                          │
  │  Step 3: Add error handling        ❌    │
  │    ...                                   │
  │                                          │
  │  Step 4: Create .env.example       ❌    │
  │    ...                                   │
  │                                          │
  │  Step 5: Deploy 🚀                 🔒    │
  │    Unlocks when you're ready             │
  │    [Deploy when ready]                   │
  └──────────────────────────────────────────┘

Each "Mark as done" → auto-logs to BuildStory
When all steps done (or user clicks anyway) → Deploy path
```

---

## Railway API Integration (`packages/railway/`)

New package: `@takeoff/railway` (or `@codeguru/railway` if we defer rename)

### Core Operations

```
GraphQL endpoint: https://backboard.railway.com/graphql/v2
Auth: Bearer token (RAILWAY_API_TOKEN)

Operations needed for MVP:

1. createProject(name)
   → mutation { projectCreate(input: { name }) { id } }

2. createServiceFromRepo(projectId, repo, branch)
   → mutation { serviceCreate(input: { projectId, source: { repo } }) { id } }

3. setVariables(serviceId, environmentId, vars)
   → mutation { variableCollectionUpsert(input: { projectId, environmentId, serviceId, variables }) }

4. addRailwayDomain(serviceId, environmentId)
   → mutation { serviceDomainCreate(input: { serviceId, environmentId }) { domain } }

5. getDeploymentStatus(deploymentId)
   → query { deployment(id) { status } }
   Statuses: BUILDING, DEPLOYING, SUCCESS, FAILED, CRASHED, SLEEPING

6. getDeploymentLogs(deploymentId)
   → query { deploymentLogs(deploymentId, filter, limit) }

7. triggerDeploy(serviceId, environmentId)
   → mutation { serviceInstanceDeploy(serviceId, environmentId) }

8. deleteProject(projectId)
   → mutation { projectDelete(id) }
```

### Rate Limits (Railway API)
- Free: 100 req/hour
- Hobby: 1,000 req/hour
- Pro: 10,000 req/hour

We'll need Railway Pro for production. Each deploy cycle uses ~6-10 API calls.

---

## Build Detection (`services/build-detector.js`)

Extracts from the existing `detectStack()` output what Railway needs to know.

```
INPUT:  stack (from analyzer), fileContents (package.json etc.), fileTree
OUTPUT: {
  type: 'static' | 'server' | 'fullstack',
  framework: 'nextjs' | 'vite-react' | 'cra' | 'express' | 'django' | ...,
  buildCommand: string | null,
  startCommand: string | null,
  outputDir: string | null,       // for static sites
  port: number | null,            // for servers
  envVarsRequired: string[],      // from .env.example
  hasDockerfile: boolean,         // let Railway use it
  nixpacksOverrides: {},          // optional tuning
}
```

### Framework → Build Plan mapping (day one)

| Framework | type | buildCommand | startCommand | outputDir |
|-----------|------|-------------|-------------|-----------|
| Next.js | fullstack | `npm run build` | `npm start` | `.next` |
| Vite + React | static | `npm run build` | — | `dist` |
| CRA | static | `npm run build` | — | `build` |
| Vue (Vite) | static | `npm run build` | — | `dist` |
| SvelteKit | fullstack | `npm run build` | `node build` | — |
| Express | server | — | `npm start` or `node server.js` | — |
| Astro | static/server | `npm run build` | varies | `dist` |
| Plain HTML | static | — | — | `.` |
| Python (Flask/Django) | server | `pip install -r requirements.txt` | `gunicorn app:app` | — |

Railway's Nixpacks auto-detects most of this, but we want to:
1. Show the user what we detected (builds trust)
2. Override when Nixpacks gets it wrong
3. Know if it's static (could deploy to CDN later for cost savings)

---

## Database Schema Changes

### New table: `deployments`

```sql
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,              -- our UUID
  user_id TEXT NOT NULL,            -- from auth
  repo_url TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT DEFAULT 'main',

  -- Detection results
  framework TEXT,                   -- 'nextjs', 'vite-react', etc.
  deploy_type TEXT,                 -- 'static', 'server', 'fullstack'
  stack_info TEXT,                  -- JSON: full detectStack() output

  -- Railway resources
  railway_project_id TEXT,
  railway_service_id TEXT,
  railway_environment_id TEXT,
  railway_deployment_id TEXT,       -- latest deployment
  railway_domain TEXT,              -- e.g., myapp.up.railway.app

  -- State
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','analyzing','deploying','building',
                     'live','failed','stopped')),
  live_url TEXT,                    -- the URL users visit
  error TEXT,
  build_logs TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT,
  deployed_at TEXT                  -- last successful deploy timestamp
);
```

### New table: `build_entries` (BuildStory)

```sql
CREATE TABLE IF NOT EXISTS build_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,         -- links to deployments.id
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL
    CHECK(entry_type IN ('prompt','note','decision','milestone','deploy_event','file')),
  title TEXT,                       -- short label
  content TEXT NOT NULL,            -- the actual text / prompt / note
  metadata TEXT,                    -- JSON: { tool, model, filename, size, ... }
  is_public INTEGER DEFAULT 0,     -- 0=private, 1=visible on shareable story
  created_at TEXT NOT NULL,
  updated_at TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);
```

### Keep existing tables?

- `analyses` — **keep for now**, can still offer analysis-only mode
- `reviews`, `review_files`, `fix_prompts` — **keep but deprioritize**, remove from main nav
- Long term: drop review tables if product fully pivots

---

## Frontend Architecture

### New Pages

| Page | Route | Purpose | Phase |
|------|-------|---------|-------|
| `Landing` | `/` | Takeoff hero + repo URL input + "Analyze My App" | 1 |
| `AnalysisProgress` | `/takeoff/:id` | SSE-streamed analysis progress | 1 |
| `ReadinessReport` | `/takeoff/:id/report` | Score + dual-path choice (Deploy Now / Plan to Ship) | 1 |
| `ProductionPlan` | `/takeoff/:id/plan` | Step-by-step plan with context files + prompts per step | 1 |
| `DeployProgress` | `/deploy/:id` | SSE-streamed Railway deploy progress | 1 |
| `ProjectView` | `/projects/:id` | Live app dashboard: URL, status, logs, redeploy, BuildStory tab | 2 |
| `Dashboard` | `/dashboard` | Grid of projects: live, in-plan, analyzed | 2 |
| `BuildStory` | `/projects/:id/story` | Timeline of build context: prompts, decisions, notes | 2 |
| `ShareableStory` | `/story/:slug` | Public read-only build story (no auth) | 3 |
| `NotFound` | `*` | 404 | 1 |

### Removed/Deprioritized Pages

| Page | Action |
|------|--------|
| `Analysis`, `Results` | Keep routes working, remove from main nav |
| `ReviewProgress`, `ReviewReport`, `FixPrompt` | Keep routes working, remove from main nav |

### Landing Page Redesign

```
Hero:
  "You built the front end."
  "We'll tell you what it needs to ship."

Input:
  [paste GitHub repo URL] [Analyze My App →]

Below:
  "How it works" — 3 steps:
  1. Paste your repo — we read the code via GitHub API
  2. See what's ready and what's missing — production readiness score
  3. Deploy now or follow a plan — context files + prompts for every step

Social proof:
  "100+ apps shipped" (counter, once we have it)

No auth required to analyze — login wall appears when deploying or saving.
```

### Design System Update

Current: violet/purple theme (`violet-400`, `violet-500`).
New: nightsky theme from the GTM doc:

```
--midnight: #080e28    (base bg)
--navy:     #0d1540    (card bg)
--gold:     #f0d349    (accent — replaces violet)
--white:    #f0f4ff    (text)
--muted:    #6878a8    (secondary text)
```

Font: keep system/Tailwind defaults for the app. The GTM doc uses Cormorant
Garamond + IBM Plex — consider for the marketing site, but the app UI should
stay clean and functional.

---

## Phase Plan

### Phase 0: Foundation (3-4 days) ✅ DONE

**Goal:** Railway API works, can deploy a repo programmatically from the server.

- [x] Create `packages/railway/index.js` — Railway GraphQL client (19 functions)
- [x] Create `app/server/services/build-detector.js` — framework → build plan
- [x] Add `RAILWAY_API_TOKEN` to `.env.example`
- [x] Add `deployments` + `build_entries` tables to `lib/db.js`
- [x] **Verified:** Dry-run test against excalidraw (Docker), shadcn/taxonomy (Next.js)

### Phase 1: Analyze + Smart Path (5-7 days) ✅ DONE

**Goal:** Paste URL → see readiness score → choose: Deploy Now or Plan to Ship.

#### 1A: Backend — Readiness Scoring + Plan Generation

- [x] Create `app/server/services/readiness-scorer.js`
  - Input: gaps (from analyzer), stack, deployInfo, buildPlan
  - Output: `{ score: 0-100, categories: {...}, recommendation: 'deploy'|'plan' }`
  - Scoring weights: frontend 15, backend/API 15, auth 15, database 15,
    error handling 10, env config 10, deployment 10, testing 10
  - `recommendation: 'deploy'` when score ≥ 90, else `'plan'`
- [x] Create `app/server/services/plan-generator.js`
  - Template-based plan steps for each missing gap category
  - Each step: `{ id, title, category, effort, why, contextFile, cursorPrompt, status }`
  - Context files follow .context.md spec, prompts are copy-paste ready
  - Smart recommendations per stack (e.g., Prisma for Next.js, Supabase Auth for Node)
  - Final step is always "Deploy" (links to deploy flow)
- [x] Create `app/server/routes/takeoff.js`
  - `POST /api/takeoff` — validate URL, run analyzer, score, generate plan
  - `GET /api/takeoff/:id` — project status + results
  - `GET /api/takeoff/:id/stream` — SSE for analysis + scoring progress
  - `PATCH /api/takeoff/:id/plan/:stepId` — mark step done/undone
- [x] Create `app/server/routes/deploy.js`
  - `POST /api/deploy/:projectId` — trigger Railway deploy (auth required)
  - `GET /api/deploy/:projectId/stream` — SSE for deploy progress
  - `POST /api/deploy/:projectId/redeploy` — trigger redeploy
  - Auto-logs deploy events to BuildStory
- [x] Update `lib/db.js` — add new columns to deployments table:
  - `readiness_score INTEGER`, `readiness_categories TEXT`, `plan_steps TEXT`, `recommendation TEXT`
  - New status values: scored, planning, ready
  - Made `user_id` nullable (analysis works without auth)

#### 1B: Frontend — Landing + Analysis + Readiness Report + Plan

- [x] Redesign `Landing.tsx` — nightsky theme, gold accents, "Analyze My App" CTA
- [x] Create `AnalysisProgress.tsx` — SSE progress with auto-redirect on completion
- [x] Create `ReadinessReport.tsx` — score display, category breakdown, dual-path cards
- [x] Create `ProductionPlan.tsx` — expandable steps with context files + Cursor prompts
- [x] Create `DeployProgress.tsx` — SSE deploy progress, success/failure states
- [x] Update `api.ts` — `startTakeoff`, `fetchProject`, `updatePlanStep`, `triggerDeploy`, `triggerRedeploy`
- [x] Update `App.tsx` — new routes: `/takeoff/:id`, `/takeoff/:id/report`, `/takeoff/:id/plan`, `/deploy/:id`
- [x] Update `index.css` — nightsky color palette (midnight, navy, gold, star, sky-*)
- [x] Update `Header.tsx` — Takeoff branding with gold logo
- [x] Auth flow: no-auth for analyze, login wall on Deploy
- [ ] **Verify:** Full flow: paste URL → analysis → score → plan view → copy prompt → deploy

### Phase 2: Dashboard + BuildStory + Polish (5-7 days)

**Goal:** Users can manage deployed apps AND capture the context of how they
built them. The experience feels solid and sticky.

#### 2A: Dashboard + Project Management

- [ ] Create `routes/projects.js`
  - `GET /api/projects` — list user's deployments
  - `GET /api/projects/:id` — single project detail
  - `DELETE /api/projects/:id` — tear down (delete Railway project)
- [ ] Redesign `Dashboard.tsx`
  - Grid of deployed apps with: name, URL, status badge, last deployed, framework icon
  - "Deploy new" button
  - Empty state: "No apps yet. Deploy your first one."
- [ ] Add environment variable management
  - On `ProjectView`: show detected env vars needed
  - Let user set values before deploy (or on redeploy)
  - Pass to Railway via `setVariables`
- [ ] Error handling polish
  - If Railway deploy fails: parse build logs, show the relevant error
  - Use Claude to explain the error in plain English (optional, nice-to-have)
  - Suggest fixes: "Missing DATABASE_URL — add it in settings"
- [ ] Rate limiting on deploy endpoint
- [ ] Loading, error, empty states on all pages
- [ ] **Verify:** Multiple deploys, dashboard shows all, redeploy works, delete works

#### 2B: BuildStory — Capture Your Build Context

BuildStory is a first-class tab on every project. It's where users capture the
*why* behind their app — prompts that worked, decisions they made, problems
they hit. Deploy gets them in the door. BuildStory keeps them.

**Data model:**

```sql
CREATE TABLE IF NOT EXISTS build_entries (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,         -- links to deployments.id
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL
    CHECK(entry_type IN ('prompt','note','decision','milestone','deploy_event','file')),
  title TEXT,                       -- short label
  content TEXT NOT NULL,            -- the actual text / prompt / note
  metadata TEXT,                    -- JSON: { tool, model, filename, size, ... }
  created_at TEXT NOT NULL,
  updated_at TEXT,
  sort_order INTEGER DEFAULT 0,     -- manual reorder
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);
```

**Entry types:**

| Type | What it captures | Example |
|------|-----------------|---------|
| `prompt` | An AI prompt that worked (or didn't) | "Generate a Supabase auth flow with GitHub OAuth" |
| `note` | Freeform context / explanation | "The app needs to handle 3 user roles: admin, editor, viewer" |
| `decision` | An architectural choice with rationale | "Chose Supabase over Clerk because we need direct DB access" |
| `milestone` | A progress marker | "Auth flow working end to end" |
| `deploy_event` | Auto-logged by Takeoff | "Deployed v3 — added payments page" |
| `file` | Reference to a key file with annotation | "schema.prisma — this is the source of truth for the data model" |

**Backend:**

- [ ] Add `build_entries` table to `lib/db.js`
- [ ] Create `routes/build-story.js`
  - `GET /api/projects/:id/story` — list entries (timeline order)
  - `POST /api/projects/:id/story` — add entry
  - `PATCH /api/projects/:id/story/:entryId` — edit entry
  - `DELETE /api/projects/:id/story/:entryId` — remove entry
  - `POST /api/projects/:id/story/generate-context` — use Claude to generate
    `.context.md` from all captured entries (ties back to original product)
- [ ] Auto-create `deploy_event` entries on each deploy/redeploy
- [ ] Auto-seed first entry from repo analysis: detected stack, description, gaps

**Frontend:**

- [ ] Create `BuildStory.tsx` — timeline view, the main BuildStory UI
  - Chronological timeline of entries with type icons
  - "Add entry" button → type picker → form (title + content + optional metadata)
  - Inline edit / delete
  - Each entry shows: type badge, title, content preview, timestamp
  - Prompts get monospace/code styling; decisions get a "rationale" callout
- [ ] Add "BuildStory" tab to `ProjectView.tsx` (alongside Status, Logs, Settings)
- [ ] Auto-populate timeline with deploy events and initial analysis
- [ ] "Generate .context.md" button — sends all entries to Claude, returns
  a `.context.md` file the user can copy into their repo
- [ ] **Verify:** Add entries, see timeline, edit/delete, generate .context.md

### Phase 3: Growth Features (1-2 weeks)

**Goal:** Retention, virality, monetization.

#### 3A: Shareable Build Stories

A public URL for each project's build story. The growth loop: vibe coders
share "here's how I built this app in a weekend" — readers discover Takeoff.

- [ ] Public story route: `GET /api/projects/:id/story/public`
  - Returns entries marked as public (user controls visibility per entry)
  - No auth required to read
- [ ] `ShareableStory.tsx` — public page at `/story/:projectSlug`
  - Beautiful read-only timeline: the app name, live URL, build journey
  - "Built and deployed with Takeoff" footer with CTA
  - Open Graph meta tags for social previews
- [ ] Share controls on `BuildStory.tsx`
  - Toggle per entry: public / private
  - "Copy share link" button
  - Preview of what the public page looks like
- [ ] Auto-generated summary at the top (Claude summarizes the full story
  into 2-3 sentences for the social preview)

#### 3B: Deploy + Infra Features

- [ ] Auto-redeploy on push (webhook or polling)
  - Register GitHub webhook on repo
  - On push to branch: trigger Railway redeploy + auto-log deploy_event in BuildStory
  - Show deploy history on ProjectView
- [ ] Custom domains
  - UI to add custom domain
  - Call Railway `customDomainCreate` API
  - Show DNS instructions
- [ ] Billing (Stripe)
  - Free tier: 1 deployed app, 10 BuildStory entries
  - Pro ($9/mo): unlimited deploys, unlimited entries, custom domains, shareable stories
  - Stripe Checkout integration
  - Webhook for subscription status
- [ ] Multi-service support
  - Detect monorepo / separate frontend+backend
  - Deploy as multiple Railway services in one project
  - Internal networking between services

#### 3C: Context Loop (Closing the Circle)

- [ ] "Export to repo" — push generated `.context.md` files directly to the
  GitHub repo via API (creates a PR or commits to branch)
- [ ] "What should I build next?" — uses existing gap analysis + BuildStory
  entries to recommend the next feature with a ready-to-paste prompt
- [ ] Auto-capture from git: parse recent commit messages and diffs to
  auto-suggest BuildStory entries ("Looks like you added auth — want to
  log this decision?")

---

## File Changes Summary

### New Files

```
packages/railway/                   ← ✅ DONE
  ├── index.js                      ← Railway GraphQL client
  └── package.json

app/server/
  ├── services/
  │   ├── build-detector.js         ← ✅ DONE — framework → build plan
  │   ├── readiness-scorer.js       ← Gaps → readiness score + recommendation
  │   └── plan-generator.js         ← Gaps → ordered plan steps with context files + prompts
  └── routes/
      ├── takeoff.js                ← Analyze + score + plan generation endpoint
      ├── deploy.js                 ← Railway deploy trigger + SSE progress
      ├── projects.js               ← Project CRUD
      └── build-story.js            ← BuildStory CRUD + .context.md generation

app/client/src/
  ├── pages/
  │   ├── AnalysisProgress.tsx      ← SSE analysis + scoring progress
  │   ├── ReadinessReport.tsx       ← Score + dual path: Deploy Now / Plan to Ship
  │   ├── ProductionPlan.tsx        ← Step-by-step plan with context files + prompts
  │   ├── DeployProgress.tsx        ← SSE deploy progress
  │   ├── ProjectView.tsx           ← Deployed app dashboard + BuildStory tab
  │   ├── BuildStory.tsx            ← Timeline UI for build context capture
  │   └── ShareableStory.tsx        ← Public read-only story page (Phase 3)
  └── services/
      └── api.ts                    ← Add takeoff + deploy + projects + story API functions
```

### Modified Files

```
app/server/app.js           ← Mount new routes, update CORS
app/server/lib/db.js        ← ✅ DONE — deployments + build_entries tables (rename to projects in Phase 1)
app/.env.example            ← ✅ DONE — RAILWAY_API_TOKEN added

app/client/src/App.tsx      ← New routes, update nav
app/client/src/pages/Landing.tsx     ← Full redesign
app/client/src/pages/Dashboard.tsx   ← Show projects (live, in-plan, analyzed)
app/client/src/components/Header.tsx ← Rebrand to Takeoff
app/client/src/index.css    ← Nightsky theme tokens

package.json                ← ✅ DONE — packages/railway in workspaces
```

### Unchanged Files (reused as-is)

```
packages/auth/*             ← Same auth flow
packages/github/*           ← Same repo reading
packages/sse/*              ← Same SSE broadcasting
app/server/services/analyzer.js  ← Reused for stack detection (called with lighter config)
app/server/services/deployment.js ← Reused for detecting existing deploy configs
app/server/lib/sse.js       ← Same
app/server/lib/rate-limit.js ← Same
app/server/lib/validate.js  ← Same
app/client/src/hooks/useSSE.ts  ← Same
app/client/src/hooks/useAuth.ts ← Same
```

---

## Environment Variables (updated)

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...       # Keep for .context.md / error explanation
RAILWAY_API_TOKEN=...              # NEW — Railway API token (Pro plan)

# Optional — increases GitHub API rate limit
GITHUB_TOKEN=ghp_...

# Optional — enables auth (required for deploy)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_REDIRECT_URL=http://localhost:3000/auth/callback

# Optional
PORT=3001
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
```

---

## Assumptions (for unanswered questions)

These are decisions I'm assuming. Flag any you disagree with:

1. **App source:** GitHub URLs only at launch. Connect-your-account and zip upload come later.
2. **Framework support:** Everything Nixpacks supports (which is most things). Our build-detector covers the top 8-10 frameworks explicitly; the rest fall through to Nixpacks auto-detect.
3. **URLs:** Railway's default `*.up.railway.app` domains at launch. Custom domains in Phase 3.
4. **Billing:** Not at launch. Start with invite/beta access. Stripe in Phase 3.
5. **Rebrand:** Incremental. Start with product name + landing page + color scheme. npm package names stay `@codeguru/*` for now (internal only, users don't see them).
6. **Existing features (.context.md, code review):** Routes stay working but are removed from primary navigation. Can resurface later as "Analyze" mode.
7. **Auth:** Required for deploy (need GitHub identity). The landing page still loads without auth — user hits login wall when clicking "Deploy."
8. **Post-deploy iteration:** Redeploy button at launch. Auto-redeploy on push in Phase 3.

---

## Risk Factors

| Risk | Mitigation |
|------|-----------|
| Railway API rate limits (100/hr free) | Use Pro plan (10K/hr). Cache project/service IDs. Minimize polling frequency. |
| Railway cost per app ($5+/mo per service) | Start with limited beta. Absorb cost until billing is live. Monitor spend. |
| Build failures on diverse repos | Show Railway build logs. Use Claude to explain errors. Add manual override for build/start commands. |
| Users expect database/auth provisioning | Phase 1 clearly says "deploys what you've built." Phase 3 adds service provisioning. |
| GitHub token permissions for private repos | OAuth scopes need `repo` access. Document clearly. |
| Nixpacks misdetects framework | build-detector overrides with explicit config when we're confident. Let user override via UI. |

---

## Success Criteria

### Launch
- **500 repos analyzed in 30 days** (low barrier — no auth, no cost)
- **100 plans started** (users who engage with the productionalization plan)
- **50 live deployments** (users who ship via Takeoff)
- **< 15 seconds** from paste URL to readiness report

### Engagement
- **60% of analyzed repos get a plan** (recommendation accuracy: < 90% actually follow plan path)
- **3+ plan steps completed per plan** (users are acting on the guidance)
- **30% of plan completers deploy** (the plan → deploy funnel)

### Retention (BuildStory)
- **50% of deployers add at least one BuildStory entry**
- **10+ shared build stories in first 60 days** (growth loop validation)
- **Context loop engaged:** users generate `.context.md` from their BuildStory and use it in Cursor
