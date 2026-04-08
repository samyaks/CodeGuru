# CodeGuru / UpdateAI — Tech Stack & Architecture

## Executive Summary

CodeGuru is a monorepo web application that analyzes GitHub repositories and generates `.context.md` files — structured documentation that grounds AI coding tools (Cursor, Claude Code) with the architectural context they need to produce correct backend code. The core loop: **paste a repo URL → analyze via GitHub API → generate context files via Claude → copy into Cursor → ship**.

The production system is a **Node.js/Express API** serving a **React + TypeScript SPA**, backed by **SQLite** for persistence, **Anthropic Claude** for LLM generation, and **GitHub REST API** for repo introspection. Authentication is optional via **Supabase Auth** (GitHub OAuth). The monorepo uses **npm workspaces** to share auth, GitHub, and SSE packages across apps.

---

## Tech Stack At a Glance

| Layer | Technology | Version / Notes |
|-------|-----------|-----------------|
| **Runtime** | Node.js | >= 18 |
| **Backend framework** | Express | v4 |
| **Frontend framework** | React | v18, functional components + hooks |
| **Frontend build** | Vite | v6 with `@vitejs/plugin-react` |
| **Language (client)** | TypeScript | Strict mode, `moduleResolution: bundler` |
| **Language (server)** | JavaScript | CommonJS (`require` / `module.exports`) |
| **Styling** | Tailwind CSS | v4 (`@tailwindcss/vite` plugin, no config file) |
| **Routing (client)** | React Router | v6 (`react-router-dom`) |
| **Icons** | Lucide React | |
| **Database** | SQLite | via `better-sqlite3`, file-based (`reviews.db`) |
| **LLM / AI** | Anthropic Claude | `@anthropic-ai/sdk`, model `claude-sonnet-4-20250514` |
| **Auth** | Supabase Auth | OAuth (GitHub), optional — app works without it |
| **GitHub integration** | GitHub REST API | Token optional (60 req/hr anon, 5000/hr with token) |
| **Real-time** | Server-Sent Events (SSE) | Custom in-memory broadcaster |
| **Monorepo** | npm workspaces | `packages/*` + `app` |
| **CI/CD** | GitHub Actions | `ci.yml` (build+test), `deploy.yml` (commented-out Railway/Fly) |
| **Containerization** | Docker | Multi-stage Dockerfile, `docker-compose.yml` |
| **Hosting** | Railway | `railway.toml` with healthcheck |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│  React SPA (Vite)  ←→  React Router  ←→  api.ts (fetch)        │
│  Tailwind v4 · Lucide · useSSE hook · useAuth hook              │
│  Port 3000 (dev) — proxies /api, /auth, /health → 3001         │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP / SSE
┌───────────────────────────▼─────────────────────────────────────┐
│                     EXPRESS SERVER (port 3001)                    │
│                                                                  │
│  Middleware: CORS · JSON · Cookies · requestLogger               │
│  Auth (optional): @codeguru/auth (Supabase)                      │
│  Rate Limiting: in-memory per-IP windowed limiter                │
│                                                                  │
│  Routes:                                                         │
│    /health, /api/info          → health.js                       │
│    /api/analyze                → analyze.js (POST, GET, SSE)     │
│    /api/reviews                → reviews.js (CRUD, SSE)          │
│    /api/github                 → github.js (proxy)               │
│    /api/fix                    → fix-prompts.js                  │
│    /auth/*                     → @codeguru/auth router           │
│                                                                  │
│  Services:                                                       │
│    analyzer.js          → reads repo, builds codebase model      │
│    context-generator.js → Claude streaming → .context.md         │
│    features-describer.js→ plain-English feature summary          │
│    reviewer.js          → PR/repo AI review pipeline             │
│    fix-prompt.js        → structured fix prompts from findings   │
│    deployment.js        → deployment file detection heuristics   │
│                                                                  │
│  Lib: db.js (SQLite) · sse.js · rate-limit.js · validate.js     │
│       logger.js · app-error.js · constants.js                    │
│                                                                  │
│  Prompts: pr-review.js · repo-review.js · fix-convention.js     │
└──────┬───────────────┬──────────────────┬───────────────────────┘
       │               │                  │
       ▼               ▼                  ▼
   ┌────────┐   ┌────────────┐   ┌──────────────┐
   │ SQLite │   │ GitHub API │   │ Anthropic    │
   │(local) │   │ (REST v3)  │   │ Claude API   │
   └────────┘   └────────────┘   └──────────────┘
```

---

## Detailed Architecture

### 1. Monorepo Structure

```
codeguru/
├── package.json                 ← Root: workspaces orchestration only
├── Dockerfile                   ← Multi-stage: build client → production server
├── docker-compose.yml           ← Local prod-like: port mapping, env, SQLite volume
├── railway.toml                 ← Railway deploy config with healthcheck
├── .github/workflows/           ← CI + deploy pipelines
│
├── packages/                    ← Shared workspace packages
│   ├── auth/                    ← @codeguru/auth — Supabase auth middleware
│   ├── github/                  ← @codeguru/github — GitHub REST API wrapper
│   └── sse/                     ← @codeguru/sse — SSE connection broadcaster
│
├── app/                         ← Primary application (workspace member)
│   ├── server/                  ← Express API
│   │   ├── app.js               ← Entry point
│   │   ├── routes/              ← Express routers (5 route files)
│   │   ├── services/            ← Business logic (6 service files)
│   │   ├── lib/                 ← Shared utilities (7 lib files)
│   │   ├── prompts/             ← Claude prompt builders (3 prompt files)
│   │   └── data/                ← SQLite database files (runtime)
│   └── client/                  ← React SPA (nested package, not workspace member)
│       └── src/
│           ├── pages/           ← 8 page components
│           ├── components/      ← 4 shared components
│           ├── hooks/           ← useAuth, useSSE
│           ├── services/        ← api.ts (HTTP client)
│           └── types/           ← SSE message types
│
├── code-reviewer/               ← Legacy: standalone review app (reference only)
├── codebase-analyzer/           ← Legacy: prototype analyzer (fake analysis)
├── code-visualizer-mvp/         ← Legacy: workspace/graph experiments
└── fastapi-project/             ← Abandoned Python stub
```

**Workspace graph:**
- Root `package.json` declares `workspaces: ["packages/*", "app"]`
- `app` depends on `@codeguru/auth`, `@codeguru/github`, `@codeguru/sse` (resolved via workspaces)
- `app/client` is a nested package under `app` (not a separate workspace member)
- Legacy directories (`code-reviewer`, `codebase-analyzer`, `code-visualizer-mvp`) are **outside** the workspace graph

### 2. Backend — Express Server

#### Entry Point (`app/server/app.js`)

The server bootstraps in this order:
1. Load `.env` via `dotenv`
2. Configure Express: CORS (from `ALLOWED_ORIGINS`), JSON body parser, cookie parser
3. Mount `requestLogger` middleware (skips `/health`)
4. Conditionally mount Supabase auth router at `/auth/*` (if `SUPABASE_URL` is set)
5. Mount API routes with optional `requireAuth` / `optionalAuth` guards
6. In production: serve `client/dist` as static SPA with catch-all for client routing
7. Global error handler: catches `AppError` instances, returns structured JSON errors
8. Initialize SQLite database, start listening, register graceful shutdown (SIGTERM/SIGINT)

#### Route Layer

| Route File | Base Path | Auth | Key Endpoints |
|-----------|-----------|------|---------------|
| `health.js` | `/health`, `/api/info` | None | Liveness probe, API metadata |
| `analyze.js` | `/api/analyze` | None (public) | `POST` create analysis, `GET` list, `GET /:id` detail, `GET /:id/stream` SSE |
| `reviews.js` | `/api/reviews` | `requireAuth` (when Supabase configured) | Full CRUD + SSE streaming + fix-prompt listing |
| `github.js` | `/api/github` | `requireAuth` (when Supabase configured) | Repo search proxy, PR listing proxy |
| `fix-prompts.js` | `/api/fix` | None (public, shareable) | `GET /:shortId` fetch prompt, `POST /:shortId/events` analytics |

#### Service Layer (Business Logic)

**`analyzer.js` — Repo Analysis Pipeline:**
1. Parse GitHub URL → extract owner/repo
2. Fetch repo metadata (description, language, default branch)
3. Fetch full file tree
4. **Smart file selection** — prioritizes configs, schemas, routes, auth files, deployment files (capped at ~30 files)
5. Fetch content for each selected file via GitHub API
6. Score and detect: tech stack, frameworks, deployment platform, gaps (auth, DB, deploy, testing, env)
7. Output: structured codebase model with `meta`, `stack`, `structure`, `gaps`, `fileContents`
8. Broadcasts progress via SSE throughout

**`context-generator.js` — .context.md Generation:**
1. Takes codebase model from analyzer
2. Sends to Claude with system prompt specifying the `.context.md` spec format
3. Generates: app-level context, feature-level contexts, gap-specific prescriptive contexts
4. Calculates completion percentage across categories (UI, API, Auth, DB, Deploy, etc.)
5. Streams output via SSE so user sees generation in real-time

**`features-describer.js` — Plain-English Summary:**
- Takes analysis output and generates a non-technical feature summary via Claude
- Designed for PMs and non-engineers to understand the codebase

**`reviewer.js` — Code Review Pipeline:**
- Supports PR review (diff-based) and full repo review
- Builds prompts with deployment context detection
- Streams Claude response, parses structured JSON report with findings and severities
- Extracts per-file comments and severity ratings

**`fix-prompt.js` — Actionable Fix Prompts:**
- Takes review findings and generates copy-pasteable fix instructions
- Searches for convention references in the codebase
- Produces short-ID shareable URLs for each fix prompt

**`deployment.js` — Deployment Detection:**
- Pure logic module (no external APIs)
- Pattern-matches against known deployment files (Dockerfile, railway.toml, vercel.json, netlify.toml, etc.)
- Used by both analyzer and review pipelines

#### Data Layer (SQLite)

Schema defined inline in `lib/db.js` via `CREATE TABLE IF NOT EXISTS`:

| Table | Purpose |
|-------|---------|
| `analyses` | Repo analysis jobs: URL, status, codebase model, context files, completion %, features summary |
| `reviews` | PR/repo review jobs: URL, status, AI report JSON, human notes |
| `review_files` | Per-file review results: severity, AI comments, human notes |
| `fix_prompts` | Generated fix prompts: short ID, finding, prompt text, conventions |
| `fix_prompt_events` | Analytics events for fix prompt usage (copy, apply, etc.) |

- File-based SQLite at `app/server/data/reviews.db`
- No migration framework — schema evolution via `ALTER TABLE` with try/catch for idempotency
- `user_id` column on reviews/analyses (nullable — populated when auth is active)

#### Prompt Engineering Layer

Three prompt builder modules in `prompts/`:
- **`pr-review.js`** — Builds PR review prompt from diff + deployment hints, enforces strict JSON output schema
- **`repo-review.js`** — Builds repo review prompt from sampled file contents, uses `truncate()` to fit context window
- **`fix-convention.js`** — Builds convention search prompt for batched findings → structured JSON references

### 3. Frontend — React SPA

#### Build & Dev Setup

- **Vite 6** with React plugin and `@tailwindcss/vite` (Tailwind v4 — no `tailwind.config.js`)
- Dev server on **port 3000**, proxies `/api`, `/auth`, `/health` to **port 3001**
- TypeScript in strict mode with `moduleResolution: bundler`
- Theme tokens defined in `index.css` via `@theme` block (Tailwind v4 convention)

#### Page Architecture

| Page | Route | Purpose |
|------|-------|---------|
| `Landing` | `/` | Hero + repo URL input → triggers analysis |
| `Dashboard` | `/dashboard` | Lists user's past analyses and reviews |
| `Analysis` | `/analyze/:id` | Real-time SSE progress during repo analysis |
| `Results` | `/results/:id` | Context files, completion bar, gaps, feature summary |
| `ReviewProgress` | `/reviews/:id/progress` | Real-time SSE progress during code review |
| `ReviewReport` | `/reviews/:id` | Parsed AI report, findings, links to fix prompts |
| `FixPrompt` | `/fix/:shortId` | Full fix prompt display + usage telemetry |
| `NotFound` | `*` | 404 fallback |

#### State Management

- **No global store** (no Redux, Zustand, etc.)
- Auth state via `AuthContext` (React Context in `hooks/useAuth.ts`)
- Page-level state via `useState` + `useEffect` with API calls
- SSE state via `useSSE` hook (EventSource wrapper, accumulates messages)

#### API Client (`services/api.ts`)

- `authFetch` wrapper: sets `credentials: 'include'` for cookie-based auth
- Typed functions for each API endpoint (analyze, reviews, fix prompts, GitHub proxy)
- Exports TypeScript interfaces (`FixPromptFull`, etc.)

### 4. Shared Packages

#### `@codeguru/auth` (Supabase Auth Middleware)

- **`createClient(url, key)`** — Supabase client with server-friendly options (`persistSession: false`)
- **`createAuthRouter(supabase, options)`** — Express router: OAuth login/callback, email signup/login, logout, session check
- **`requireAuth(supabase)`** — Middleware: validates Bearer token or session cookie, sets `req.user`
- **`optionalAuth(supabase)`** — Same but non-blocking (sets `req.user` if present, continues regardless)
- Cookie-based session management with configurable redirect URLs

#### `@codeguru/github` (GitHub REST API)

- **`parseRepoUrl(url)`** / **`parsePRUrl(url)`** — URL parsing
- **`fetchRepoTree(owner, repo, branch)`** — Full recursive tree
- **`fetchFileContent(owner, repo, path, branch)`** — Single file content
- **`fetchRepoMeta(owner, repo)`** — Repo metadata
- **`fetchPullRequest`** / **`fetchPRDiff`** / **`fetchPRFiles`** — PR-specific endpoints
- **`searchRepos(query)`** / **`fetchRepoPulls(owner, repo)`** — Search and listing
- Uses `GITHUB_TOKEN` from env when available (5000 req/hr vs 60 req/hr anonymous)

#### `@codeguru/sse` (Server-Sent Events)

- **`addConnection(id, res, options)`** — Register SSE client with heartbeat
- **`removeConnection(id, res)`** — Deregister on disconnect
- **`broadcast(id, event, data)`** — Fan-out to all clients subscribed to an ID
- In-memory connection registry (no Redis/external broker)
- Supports CORS origin passthrough

### 5. Infrastructure & Deployment

#### Docker

Multi-stage `Dockerfile`:
1. **Build stage:** `npm ci` (workspace install), build client (`npm run build --workspace=app/client`), native rebuild for `better-sqlite3`
2. **Production stage:** Copy server + built client + node_modules, healthcheck `curl /health`, run `node server/app.js`

`docker-compose.yml`: maps `PORT` (default 3001), mounts `app/server/data` volume for SQLite persistence, reads env from `app/.env`.

#### Railway

`railway.toml`: Dockerfile builder, healthcheck on `/health`, restart on failure.

#### GitHub Actions CI

- **`ci.yml`:** Node 20, `npm ci`, TypeScript check, client build, require-test server routes, Docker build + smoke test on `/health`
- **`deploy.yml`:** Build + typecheck, deployment steps commented out (manual Railway/Fly/registry setup)

#### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access for all LLM features |
| `GITHUB_TOKEN` | No | Higher GitHub API rate limits (60→5000/hr) |
| `SUPABASE_URL` | No | Enables authentication features |
| `SUPABASE_ANON_KEY` | No | Supabase client key (required with URL) |
| `SUPABASE_REDIRECT_URL` | No | OAuth callback URL |
| `PORT` | No | Server port (default 3001) |
| `ALLOWED_ORIGINS` | No | CORS origins (comma-separated) |
| `NODE_ENV` | No | `production` enables static SPA serving |
| `CLAUDE_MODEL` | No | Override default Claude model |

### 6. Data Flow — Core Analysis Pipeline

```
User pastes URL
       │
       ▼
POST /api/analyze { repoUrl }
       │
       ├── validate URL (lib/validate.js)
       ├── rate limit check (lib/rate-limit.js)
       ├── create 'analyses' row (status: pending)
       │
       ▼  (setImmediate — non-blocking)
  analyzer.js
       │
       ├── parseRepoUrl → owner, repo
       ├── fetchRepoMeta → description, language, branch
       ├── fetchRepoTree → full file listing
       ├── smart file selection (~30 key files)
       ├── fetchFileContent × N (rate-limit aware)
       ├── build codebase model (stack, gaps, structure)
       │   └── SSE broadcast: progress events
       │
       ▼
  context-generator.js
       │
       ├── Claude streaming: app-level .context.md
       ├── Claude streaming: feature-level .context.md files
       ├── Claude streaming: gap-specific prescriptive .context.md
       ├── calculateCompletion → percentage
       │   └── SSE broadcast: context generation progress
       │
       ▼
  features-describer.js (optional)
       │
       ├── Claude streaming: plain-English summary
       │   └── SSE broadcast: features stream
       │
       ▼
  Update 'analyses' row (status: completed, store results)
  SSE broadcast: completed event
       │
       ▼
Client navigates to /results/:id
  → Renders context files, completion %, gaps, copy/download
```

### 7. Legacy / Prototype Code (Not in Production Path)

| Directory | What It Is | Status |
|-----------|-----------|--------|
| `code-reviewer/` | Standalone PR/repo review app (Express + CRA). Supabase auth mandatory. Local copies of github/sse/db services. | Reference — patterns migrated to `app/` |
| `codebase-analyzer/` | Prototype that sends repo name to Claude and asks it to guess the architecture (no real file reading). | Superseded by `app/server/services/analyzer.js` |
| `code-visualizer-mvp/` | Collaborative workspace experiments: Next.js app, static prototype, Chrome extension with Supabase + TipTap + Yjs. | Shelved — premature for current roadmap |
| `fastapi-project/` | Abandoned Python/FastAPI stub. | Ignored per project rules |

---

## Key Architectural Decisions

1. **GitHub API over git clone** — No disk I/O, selective file reading (~30 files max), works in serverless/container contexts without git binary.

2. **SQLite over Postgres** — Zero-ops persistence for the current scale. Schema defined inline with `CREATE IF NOT EXISTS`. Trade-off: single-writer, no horizontal scaling without migration.

3. **SSE over WebSockets** — Simpler protocol for the unidirectional streaming use case (analysis progress, generation output). No need for client→server real-time messaging.

4. **Optional auth** — The analyze endpoint works without login. Auth unlocks persistence (dashboard, saved analyses) and private repo access. This lowers the barrier to first use.

5. **Shared packages via npm workspaces** — `@codeguru/auth`, `@codeguru/github`, `@codeguru/sse` are extracted to `packages/` for reuse. The main `app` imports them; legacy code has local copies.

6. **CommonJS on server, ESM + TypeScript on client** — Server uses `require`/`module.exports` to match the existing codebase convention. Client uses TypeScript with Vite's ESM bundling.

7. **Tailwind v4 (no config file)** — Theme tokens defined in CSS via `@theme` block. Tailwind integrated as a Vite plugin rather than PostCSS.

8. **Prompt engineering as code** — Claude prompts are structured in dedicated `prompts/` modules with builder functions, not inline strings. This enables version control and testing of prompt changes.

9. **In-memory rate limiting and SSE** — No Redis dependency. Rate limits and SSE connections are per-process. Acceptable for single-instance deployment; would need external state for horizontal scaling.

---

## Security Considerations

- **No secrets in client bundle** — All API keys (Anthropic, GitHub, Supabase) are server-side only
- **Cookie-based auth** — `httpOnly`, `secure` (in production), `sameSite` cookies via Supabase session
- **Rate limiting** — Per-IP in-memory limiters on all public endpoints
- **Input validation** — URL validation against GitHub URL patterns before any API calls
- **CORS** — Configurable allowed origins; defaults restrict cross-origin access
- **Error sanitization** — `AppError` class with typed HTTP errors; stack traces not exposed in production

---

## Scaling Boundaries & Future Considerations

| Current Approach | Scaling Limitation | Migration Path |
|-----------------|-------------------|----------------|
| SQLite (single file) | Single writer, no replicas | Postgres (Supabase) or Turso |
| In-memory SSE registry | Lost on restart, single process | Redis pub/sub |
| In-memory rate limits | Per-process, not shared | Redis-backed rate limiter |
| GitHub API (token) | 5000 req/hr per token | GitHub App installation tokens |
| Single Anthropic key | Rate limits per key | Key rotation / queue-based job processing |
| Monolith Express server | Vertical scaling only | Extract analyzer/generator as workers |
