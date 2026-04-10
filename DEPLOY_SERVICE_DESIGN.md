# Deploy Service Design — Zero-Config Deploys via Account Connection

## The Problem

Vibe coders build apps with AI tools but hit a wall at deployment. The pain:

1. **Which platform?** Railway, Vercel, Fly, Render — too many choices
2. **Config files** — Dockerfile, railway.toml, vercel.json, Procfile... which one?
3. **Build/start commands** — wrong guess = cryptic build failure
4. **Environment variables** — "build failed: DATABASE_URL not set" with no guidance
5. **Database provisioning** — "I need Postgres but don't know how to set it up"
6. **Multi-service apps** — frontend + backend + database = 3 things to wire together
7. **Debugging failures** — build logs are unreadable for non-engineers

These are all **solvable problems** if you know what the code needs. And we already
know what the code needs — the analyzer tells us. The missing piece is acting on
that knowledge automatically.

## The Insight

We already have **deploy intelligence** (analyzer + build-detector). What we lack
is a **deploy execution layer** that uses the intelligence to provision
infrastructure on the user's own accounts — not ours.

```
Current model (broken):
  User → Takeoff → Takeoff's Railway account → app lives on our infra
  Problem: we eat cost, users don't own their infra, can't customize

New model (this design):
  User → connects GitHub + Railway → Takeoff orchestrates → app lives on THEIR infra
  Takeoff = control plane, not hosting provider
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         TAKEOFF (Control Plane)                    │
│                                                                    │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐ │
│  │ GitHub OAuth  │  │ Railway OAuth  │  │ Analysis Engine        │ │
│  │ (repo access) │  │ (infra control)│  │ (already built)        │ │
│  └──────┬───────┘  └───────┬───────┘  └────────────┬───────────┘ │
│         │                  │                        │              │
│  ┌──────▼──────────────────▼────────────────────────▼────────────┐│
│  │                  Deploy Orchestrator                            ││
│  │                                                                ││
│  │  1. Read repo (GitHub API — user's token for private repos)   ││
│  │  2. Detect stack + infra needs (analyzer + build-detector)    ││
│  │  3. Generate deploy manifest (what to provision)              ││
│  │  4. Show user what we'll do + collect secrets                 ││
│  │  5. Provision infra (Railway API — user's token)              ││
│  │     → Create project                                          ││
│  │     → Create app service (from GitHub repo)                   ││
│  │     → Provision databases (Postgres plugin)                   ││
│  │     → Wire internal networking                                ││
│  │     → Set all env vars (auto-detected + user-provided)        ││
│  │     → Add domain                                              ││
│  │  6. Monitor deployment (poll + stream via SSE)                ││
│  │  7. On failure: Claude explains error + suggests fix          ││
│  │  8. Register webhook for auto-redeploy on push               ││
│  └────────────────────────────────────────────────────────────────┘│
│                                                                    │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │                    Connection Vault                              ││
│  │  Encrypted storage for per-user OAuth tokens                    ││
│  │  github_token, railway_token (refresh + access)                 ││
│  └────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────┐
│ User's GitHub    │    │ User's Railway    │
│ (repos, webhooks)│    │ (projects, infra) │
└─────────────────┘    └──────────────────┘
```

## User Experience — The Full Flow

### Step 0: Sign Up + Connect Accounts (one-time, 2 minutes)

```
Landing page: "Paste your repo. We'll deploy it."

[Sign in with GitHub]   ← Supabase OAuth (already built)
                          Scopes: user:email, read:user
                          This gets us: identity, public repos

After sign-in, dashboard shows:

┌─────────────────────────────────────────────────┐
│  Welcome to Takeoff                              │
│                                                  │
│  To deploy apps, connect your accounts:          │
│                                                  │
│  ✅ GitHub    Connected as @samyaks              │
│  ⬜ Railway   [Connect Railway →]                │
│                                                  │
│  Why? We deploy to YOUR Railway account.         │
│  You own the infrastructure. We just orchestrate.│
└─────────────────────────────────────────────────┘

Click "Connect Railway" →
  Railway OAuth2 flow (https://docs.railway.com/reference/public-api#oauth)
  Scopes: project:create, project:read, service:create,
          deployment:create, variable:write, domain:create
  Redirects back → store encrypted tokens

After connecting:

┌─────────────────────────────────────────────────┐
│  ✅ GitHub    Connected as @samyaks              │
│  ✅ Railway   Connected (Hobby plan)             │
│                                                  │
│  [Paste a repo URL to get started]               │
│  ________________________________________        │
│  [Analyze & Deploy →]                            │
└─────────────────────────────────────────────────┘
```

### Step 1: Paste URL → Analysis (already built, 10 seconds)

No change to the existing analysis pipeline. But now:
- If user connected GitHub with `repo` scope, we can analyze **private repos**
- Analysis uses the user's GitHub token (higher rate limits, private access)

### Step 2: Readiness Report (already built) + Deploy Manifest (new)

After scoring, we show the existing ReadinessReport. New addition — the
**Deploy Manifest**: a plain-English preview of exactly what we'll provision.

```
┌──────────────────────────────────────────────────────────┐
│  Your App: my-saas-app                                    │
│  Score: 78% production-ready                              │
│  Recommendation: Deploy with setup                        │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Deploy Manifest — here's what we'll set up:       │  │
│  │                                                    │  │
│  │  📦 App Service                                    │  │
│  │     Framework: Next.js 14 (App Router)             │  │
│  │     Build: npm run build                           │  │
│  │     Start: npm start                               │  │
│  │     Source: github.com/samyaks/my-saas-app (main)  │  │
│  │                                                    │  │
│  │  🗄️ PostgreSQL Database                            │  │
│  │     Detected: Prisma schema with 4 models          │  │
│  │     Will provision: Railway Postgres plugin         │  │
│  │     Auto-set: DATABASE_URL                         │  │
│  │                                                    │  │
│  │  🔑 Environment Variables                          │  │
│  │     Auto-filled (3):                               │  │
│  │       PORT = 3000                                  │  │
│  │       DATABASE_URL = (from Postgres plugin)        │  │
│  │       NODE_ENV = production                        │  │
│  │                                                    │  │
│  │     You need to provide (2):                       │  │
│  │       NEXT_PUBLIC_SUPABASE_URL = [__________]      │  │
│  │       NEXT_PUBLIC_SUPABASE_ANON_KEY = [__________] │  │
│  │                                                    │  │
│  │  🌐 Domain                                         │  │
│  │     my-saas-app.up.railway.app (auto-assigned)     │  │
│  │                                                    │  │
│  │  🔄 Auto-deploy                                    │  │
│  │     On push to `main` branch                       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  [Deploy to Railway →]        [Edit manifest]             │
└──────────────────────────────────────────────────────────┘
```

The manifest is generated from analysis + build-detector output. The user reviews
it, fills in any secrets we can't auto-detect, and clicks deploy. That's it.

### Step 3: Deploy (10-60 seconds, streamed)

```
┌────────────────────────────────────────────────────────┐
│  Deploying my-saas-app to Railway...                    │
│                                                         │
│  ✅ Created Railway project                             │
│  ✅ Provisioned PostgreSQL database                     │
│  ✅ Created app service from github.com/samyaks/...     │
│  ✅ Set 5 environment variables                         │
│  ✅ Added domain: my-saas-app.up.railway.app            │
│  🔄 Building... (npm run build)                         │
│     │████████████░░░░░░░░│ 65%                          │
│                                                         │
│  Build logs:                                            │
│  > next build                                           │
│  > Creating optimized production build...               │
│  > Compiled successfully                                │
└────────────────────────────────────────────────────────┘
```

On success:

```
┌────────────────────────────────────────────────────────┐
│  🎉 Your app is live!                                   │
│                                                         │
│  URL: https://my-saas-app.up.railway.app                │
│                                                         │
│  [Open app]  [View on Railway]  [Add custom domain]     │
│                                                         │
│  Auto-deploy is ON — push to main to update.            │
│                                                         │
│  What's next:                                           │
│  • Add a custom domain ($0 on Railway)                  │
│  • Set up monitoring                                    │
│  • Check your app's production plan for remaining gaps  │
└────────────────────────────────────────────────────────┘
```

On failure:

```
┌────────────────────────────────────────────────────────┐
│  ❌ Build failed                                        │
│                                                         │
│  What happened (plain English):                         │
│  Your app tried to connect to a database during the     │
│  build step, but DATABASE_URL wasn't available at       │
│  build time. This is common with Prisma — it needs      │
│  the database URL to generate the client.               │
│                                                         │
│  Fix:                                                   │
│  Add `prisma generate` as a postinstall script in       │
│  package.json, and make sure DATABASE_URL is set as     │
│  a build-time variable (not just runtime).              │
│                                                         │
│  [Copy fix to clipboard]  [Retry deploy]                │
│  [View raw build logs]                                  │
└────────────────────────────────────────────────────────┘
```

The Claude-powered error explanation is the differentiator. Railway shows raw
build logs. We show "here's what went wrong and how to fix it."

---

## System Design — Backend

### New: OAuth Connection Layer

#### Database: `connections` table

```sql
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('github', 'railway')),
  provider_user_id TEXT,          -- their ID on the provider
  provider_username TEXT,         -- display name
  access_token TEXT NOT NULL,     -- encrypted at rest
  refresh_token TEXT,             -- encrypted, for Railway OAuth refresh
  token_expires_at TEXT,          -- ISO timestamp
  scopes TEXT,                    -- comma-separated granted scopes
  plan TEXT,                      -- 'free', 'hobby', 'pro' (Railway)
  connected_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(user_id, provider)
);
```

Tokens encrypted with AES-256-GCM using a `TOKEN_ENCRYPTION_KEY` env var.
We never log or expose tokens. Refresh Railway tokens before they expire.

#### Routes: `routes/connections.js`

```
GET  /api/connections              — list user's connected accounts
POST /api/connections/github       — start GitHub OAuth (expanded scopes)
GET  /api/connections/github/callback — handle GitHub OAuth callback
POST /api/connections/railway      — start Railway OAuth
GET  /api/connections/railway/callback — handle Railway OAuth callback
DELETE /api/connections/:provider  — disconnect an account
```

#### Service: `services/token-vault.js`

```
encrypt(plaintext) → ciphertext   — AES-256-GCM encrypt
decrypt(ciphertext) → plaintext   — AES-256-GCM decrypt
getToken(userId, provider) → token — fetch + decrypt + auto-refresh if expired
revokeToken(userId, provider)     — delete from DB
```

### New: Deploy Manifest Generator

#### Service: `services/manifest-generator.js`

Takes the output of analyzer + build-detector and produces a **deploy manifest**
— a complete description of what needs to be provisioned.

```
INPUT:
  - codebaseModel (from analyzer)
  - buildPlan (from build-detector)

OUTPUT: {
  services: [
    {
      name: 'my-saas-app',
      type: 'app',                    // 'app' | 'database' | 'redis' | 'worker'
      source: {
        repo: 'samyaks/my-saas-app',
        branch: 'main',
      },
      build: {
        command: 'npm run build',
        dockerfile: null,             // path if Dockerfile detected
      },
      start: {
        command: 'npm start',
      },
      port: 3000,
    },
    {
      name: 'my-saas-app-db',
      type: 'database',
      engine: 'postgres',             // 'postgres' | 'mysql' | 'redis' | 'mongo'
      reason: 'Prisma schema detected with 4 models',
      connectionVar: 'DATABASE_URL',  // env var name that gets the connection string
    },
  ],

  envVars: {
    auto: {
      PORT: { value: '3000', source: 'detected from next.config.js' },
      DATABASE_URL: { value: null, source: 'from Postgres plugin (auto-wired)' },
      NODE_ENV: { value: 'production', source: 'standard' },
    },
    required: {
      NEXT_PUBLIC_SUPABASE_URL: { hint: 'From your Supabase project settings' },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: { hint: 'From Supabase → Settings → API' },
    },
    optional: {
      SENTRY_DSN: { hint: 'For error tracking (optional)' },
    },
  },

  domain: {
    subdomain: 'my-saas-app',        // auto-generated from repo name
    type: 'railway',                  // 'railway' | 'custom'
  },

  hooks: {
    autoDeploy: true,                 // webhook on push to branch
    branch: 'main',
  },

  warnings: [
    'No .env.example found — env var detection may be incomplete',
    'Large node_modules detected — first build may take 3-5 minutes',
  ],
}
```

#### Detection Logic for Infrastructure Needs

```
Database detection:
  prisma/schema.prisma exists           → Postgres (Prisma default)
  drizzle.config.* exists               → Postgres
  package.json has 'pg' or 'postgres'   → Postgres
  package.json has 'mysql2'             → MySQL
  package.json has 'mongoose' / 'mongodb' → MongoDB (suggest external — Atlas)
  package.json has 'redis' / 'ioredis'  → Redis
  requirements.txt has 'psycopg2'       → Postgres
  requirements.txt has 'django'         → Postgres (Django default)
  .env.example has DATABASE_URL         → Postgres (assume)

Worker detection:
  package.json has 'bull' or 'bullmq'   → needs Redis + worker process
  Procfile with 'worker:' entry         → separate worker service

Multi-service detection:
  Monorepo with separate apps/ or packages/ directories
  docker-compose.yml with multiple services
  Turborepo/Nx with multiple apps
```

### Enhanced: Deploy Orchestrator

#### Service: `services/deploy-orchestrator.js`

Replaces the current simple `railway.deployFromRepo` call with a multi-step
orchestration that provisions everything in the manifest.

```
async function orchestrateDeploy(userId, projectId, manifest, onProgress) {
  const railwayToken = await tokenVault.getToken(userId, 'railway');

  // 1. Create Railway project
  onProgress({ step: 'project', status: 'running', message: 'Creating Railway project...' });
  const project = await railway.createProject(manifest.services[0].name, { token: railwayToken });

  // 2. Provision databases / plugins
  for (const svc of manifest.services.filter(s => s.type === 'database')) {
    onProgress({ step: 'database', status: 'running', message: `Provisioning ${svc.engine}...` });
    const plugin = await railway.addPlugin(project.id, svc.engine, { token: railwayToken });
    // Railway auto-sets the connection string as a variable
    // Store the mapping: svc.connectionVar → plugin reference
  }

  // 3. Create app service from GitHub repo
  for (const svc of manifest.services.filter(s => s.type === 'app')) {
    onProgress({ step: 'service', status: 'running', message: 'Connecting to GitHub repo...' });
    const service = await railway.createServiceFromRepo(project.id, svc.source.repo, {
      branch: svc.source.branch,
      token: railwayToken,
    });

    // 4. Set environment variables
    onProgress({ step: 'env', status: 'running', message: 'Setting environment variables...' });
    const vars = {};
    for (const [key, val] of Object.entries(manifest.envVars.auto)) {
      if (val.value) vars[key] = val.value;
    }
    for (const [key, val] of Object.entries(manifest.envVars.required)) {
      if (val.value) vars[key] = val.value;  // user-provided values
    }
    await railway.setVariables(service.id, project.environmentId, vars, { token: railwayToken });

    // 5. Configure build/start if Nixpacks doesn't auto-detect
    if (svc.build.command || svc.start.command) {
      await railway.updateServiceInstance(service.id, project.environmentId, {
        buildCommand: svc.build.command,
        startCommand: svc.start.command,
      }, { token: railwayToken });
    }

    // 6. Add domain
    onProgress({ step: 'domain', status: 'running', message: 'Setting up domain...' });
    const domain = await railway.addRailwayDomain(service.id, project.environmentId, { token: railwayToken });

    // 7. Poll deployment status
    onProgress({ step: 'building', status: 'running', message: 'Building your app...' });
    const result = await railway.pollDeploymentStatus(deployment.id, {
      token: railwayToken,
      onStatus: (status) => onProgress({ step: 'building', status: 'running', message: `Status: ${status}` }),
    });
  }

  // 8. Register webhook for auto-deploy (if GitHub connected)
  if (manifest.hooks.autoDeploy) {
    // Uses the user's GitHub token to register a push webhook
    // Webhook points to: POST /api/webhooks/github
    // On push event → trigger Railway redeploy via user's Railway token
  }

  return { url: `https://${domain}`, projectId: project.id, status: result.status };
}
```

### New: Webhook Handler for Auto-Redeploy

#### Route: `routes/webhooks.js`

```
POST /api/webhooks/github    — receives GitHub push events
  1. Verify webhook signature (HMAC-SHA256)
  2. Look up deployment by repo URL
  3. Get user's Railway token from vault
  4. Trigger redeploy via Railway API
  5. Log deploy_event to BuildStory
```

### New: Smart Error Explainer

#### Service: `services/error-explainer.js`

When a deploy fails, feed the build logs + codebase context to Claude:

```
INPUT: build logs (last 100 lines) + framework + detected stack
OUTPUT: {
  summary: 'plain English explanation of what went wrong',
  cause: 'specific technical cause',
  fix: {
    description: 'what to change',
    files: ['package.json'],
    code: '// add this to scripts...',
  },
  cursorPrompt: 'Copy-paste prompt to fix this in Cursor',
}
```

---

## Database Schema Changes

### New table: `connections`

```sql
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('github', 'railway')),
  provider_user_id TEXT,
  provider_username TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  plan TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(user_id, provider)
);
```

### New table: `deploy_manifests`

```sql
CREATE TABLE IF NOT EXISTS deploy_manifests (
  id TEXT PRIMARY KEY,
  deployment_id TEXT NOT NULL REFERENCES deployments(id),
  manifest TEXT NOT NULL,         -- JSON: full manifest object
  user_env_values TEXT,           -- JSON: encrypted user-provided secret values
  created_at TEXT NOT NULL,
  UNIQUE(deployment_id)
);
```

### Alter `deployments`

```sql
ALTER TABLE deployments ADD COLUMN webhook_id TEXT;       -- GitHub webhook ID
ALTER TABLE deployments ADD COLUMN webhook_secret TEXT;   -- HMAC secret
ALTER TABLE deployments ADD COLUMN auto_deploy INTEGER DEFAULT 0;
```

---

## API Surface

### Connection Management

```
GET    /api/connections                    — list connected accounts
POST   /api/connections/github/start       — get GitHub OAuth URL (expanded scopes)
GET    /api/connections/github/callback     — handle callback, store token
POST   /api/connections/railway/start      — get Railway OAuth URL
GET    /api/connections/railway/callback    — handle callback, store token
DELETE /api/connections/:provider           — disconnect, revoke token
```

### Deploy (enhanced)

```
POST   /api/deploy/:projectId/manifest    — generate deploy manifest (preview)
PATCH  /api/deploy/:projectId/manifest    — update manifest (user edits env vars)
POST   /api/deploy/:projectId             — execute deploy from manifest
GET    /api/deploy/:projectId/stream      — SSE deploy progress
POST   /api/deploy/:projectId/redeploy    — redeploy latest
DELETE /api/deploy/:projectId             — tear down Railway project
```

### Webhooks

```
POST   /api/webhooks/github               — GitHub push webhook receiver
```

---

## Frontend Changes

### New: `ConnectionSetup.tsx`

Shown on first deploy or in settings. Two cards: GitHub + Railway.
Each shows: connected/disconnected state, username, plan, disconnect button.

### Enhanced: `DeployProgress.tsx`

Before deploying, show the Deploy Manifest as a reviewable checklist.
User fills in required env vars (with hints), reviews services, clicks deploy.

### New: `SettingsPage.tsx`

```
/settings
  ├── Connected Accounts (GitHub, Railway)
  ├── Default deploy settings (auto-deploy on/off, branch)
  └── Danger zone (disconnect accounts, delete data)
```

---

## Security

### Token Storage
- All OAuth tokens encrypted at rest with AES-256-GCM
- Encryption key in `TOKEN_ENCRYPTION_KEY` env var (not in code, not in DB)
- Tokens never logged, never sent to frontend, never exposed in API responses
- Railway refresh tokens rotated on each use

### Webhook Security
- GitHub webhooks verified via HMAC-SHA256 signature
- Per-deployment webhook secrets (not shared)
- Webhook endpoint validates: signature, repo match, event type

### Scope Minimization
- GitHub OAuth: request only `repo` scope (for private repos + webhooks)
- Railway OAuth: request minimum scopes needed for project/service/deploy operations
- Users can revoke access at any time via Settings or directly on GitHub/Railway

### Deployment Isolation
- Each user's deploys go to THEIR Railway account
- Takeoff never has standing access to user infrastructure
- Token revocation immediately stops all management capability

---

## Environment Variables (new)

```env
# Existing
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=eyJ...

# New — Token encryption
TOKEN_ENCRYPTION_KEY=...         # 32-byte hex key for AES-256-GCM

# New — GitHub OAuth App (expanded scopes beyond Supabase's)
GITHUB_CLIENT_ID=...             # OAuth App client ID
GITHUB_CLIENT_SECRET=...         # OAuth App client secret

# New — Railway OAuth
RAILWAY_CLIENT_ID=...            # From Railway developer portal
RAILWAY_CLIENT_SECRET=...        # From Railway developer portal

# Remove (no longer needed — we use user tokens)
# RAILWAY_API_TOKEN=...          # Was: server's own Railway token
# GITHUB_TOKEN=...               # Was: server's own GitHub token
```

---

## Migration Path from Current State

### What stays
- `packages/railway/index.js` — all functions still needed, but each call now
  receives the user's token instead of reading from env
- `services/build-detector.js` — stays as-is, feeds into manifest generator
- `services/analyzer.js` — stays, uses user's GitHub token for private repos
- `routes/takeoff.js` — stays, still drives analysis + scoring
- All frontend pages — enhanced, not replaced

### What changes
- `packages/railway/index.js` — every function gets an optional `{ token }` param
  that overrides the env-based token. Backward compatible.
- `routes/deploy.js` — rewired to use orchestrator + user tokens
- `lib/db.js` — add `connections` + `deploy_manifests` tables

### What's new
- `services/token-vault.js` — encrypted token storage
- `services/manifest-generator.js` — analysis → deploy manifest
- `services/deploy-orchestrator.js` — manifest → provisioned infrastructure
- `services/error-explainer.js` — build failure → plain English fix
- `routes/connections.js` — OAuth flows for GitHub + Railway
- `routes/webhooks.js` — auto-redeploy on push

### Phase plan

**Phase A: Token Infrastructure (2 days)**
- `connections` table + `token-vault.js`
- Railway OAuth flow (register app on Railway dev portal)
- GitHub OAuth flow with expanded scopes
- `ConnectionSetup.tsx` component
- Verify: can connect both accounts, tokens stored encrypted

**Phase B: Deploy Manifest (2 days)**
- `manifest-generator.js` — produces manifest from analysis
- Database/Redis/worker detection logic
- Env var categorization (auto / required / optional)
- Manifest preview UI in `DeployProgress.tsx`
- Verify: paste URL, see accurate manifest before deploying

**Phase C: Orchestrated Deploy (3 days)**
- `deploy-orchestrator.js` — multi-step provisioning
- Update `packages/railway` to accept per-call tokens
- Database plugin provisioning
- SSE progress for each orchestration step
- Verify: full flow — paste URL → manifest → deploy → live

**Phase D: Error Intelligence + Auto-Deploy (2 days)**
- `error-explainer.js` — Claude-powered build failure diagnosis
- Webhook registration on successful deploy
- `routes/webhooks.js` — auto-redeploy on push
- Verify: push to repo → auto-redeploys; break build → get helpful error

---

## Why This Design Wins

1. **User does zero config.** No Dockerfile, no railway.toml, no build commands.
   We detect everything from the code and show them what we'll do before doing it.

2. **User owns their infra.** Apps deploy to their Railway account. They can
   see everything on Railway's dashboard. If they leave Takeoff, their apps
   keep running.

3. **Secrets stay with the user.** We encrypt tokens at rest and never log them.
   Users connect via standard OAuth — they can revoke anytime.

4. **Failures are explained.** Instead of raw build logs, users get "your Prisma
   schema needs a postinstall script" with a copy-pasteable fix.

5. **Auto-deploy closes the loop.** Push code → app updates. No manual redeploy.
   The vibe coder's workflow becomes: write code with Cursor → push → live.

6. **Incremental adoption.** Analysis still works without any accounts connected.
   Deploy prompts connection only when needed. No upfront friction.

7. **We become the control plane, not the hosting bill.** Takeoff doesn't pay for
   user infrastructure. We provide the intelligence layer. This is the business
   model: charge for orchestration + intelligence, not compute.
