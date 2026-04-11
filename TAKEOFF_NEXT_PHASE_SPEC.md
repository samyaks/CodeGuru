# TAKEOFF — Next Phase Feature Spec
## Cursor instructions: read this entire file before writing any code

---

## What I just read — the actual codebase state

After cloning and reading the repo, here is what **actually exists** vs what
I thought existed. The gap is much smaller than expected. Most of the hard
work is already done.

### What's fully built and working:

**`packages/github/index.js`** — Complete GitHub API client
- `fetchRepoTree`, `fetchFileContent`, `fetchRepoMeta`, `parseRepoUrl`
- Rate limit warnings, error handling, 404 / 403 messaging
- Used everywhere as `@codeguru/github`

**`app/server/services/analyzer.js`** — Real repo analyzer (NOT fake)
- Reads up to 30 key files via GitHub API
- Priority scoring: `package.json`, `.env.example`, framework configs first
- `detectStack()` — framework, runtime, styling, database, auth, languages
- `detectGaps()` — auth, database, deployment, testing, error handling
- `detectFeatures()` — feature dir map with UI/API/test presence
- `detectExistingContext()` — checks for `.cursorrules`, `CLAUDE.md`, `.context.md`
- Streams progress events via SSE throughout
- **This is already real. Do not replace it.**

**`app/server/services/build-detector.js`** — Deploy plan generator
- Framework-specific build/start commands (Next.js, Nuxt, SvelteKit, React, etc.)
- Dockerfile detection → Railway uses it automatically
- Env var parsing from `.env.example`
- Port detection from `package.json` scripts and source files
- Outputs `deployPlan` with type, buildCommand, startCommand, port, confidence

**`app/server/services/readiness-scorer.js`** — Production readiness score
- 0–100 score with 8 weighted categories
- frontend (15), backend (15), auth (15), database (15), errorHandling (10),
  envConfig (10), deployment (10), testing (10)
- `recommendation`: "deploy" (≥90) or "plan" (<90)

**`app/server/services/context-generator.js`** — Claude-powered .context.md
- Generates app-level, feature-level, and gap-filling prescriptive context files
- Streams partial output via SSE
- Already integrated and working

**`packages/railway/index.js`** — Full Railway GraphQL client
- `createProject`, `createServiceFromRepo`, `setVariables`, `addRailwayDomain`
- `triggerDeploy`, `pollDeploymentStatus`, `getDeploymentLogs`, `getBuildLogs`
- High-level `deployFromRepo()` — one call to go from repo to live URL
- Already integrated and working

**`app/server/routes/takeoff.js`** — Main analysis pipeline
- `POST /api/takeoff` → creates project, runs analysis async, streams via SSE
- Pipeline: analyze → detectBuildPlan → scoreReadiness → generatePlan
- `GET /api/takeoff/:id` → get project state
- `GET /api/takeoff/:id/stream` → SSE stream with event replay (no lost events)
- Plan step status updates: `PATCH /api/takeoff/:id/plan/:stepId`

**`app/server/routes/deploy.js`** — Railway deployment
- `POST /api/deploy/:projectId` → triggers Railway deploy async
- Polls deployment status, sets `live_url`, Railway IDs on project
- Error cleanup: deletes Railway project if deploy fails
- `GET /api/deploy/:projectId/stream` → SSE for deploy progress
- `POST /api/deploy/:projectId/redeploy`

**`app/server/routes/build-story.js`** — BuildStory CRUD
- GET/POST/DELETE entries per project
- Entry types: prompt, note, decision, milestone, deploy_event, file
- `POST /generate-context` — Claude-powered context generation from entries
- Rate limited

**`packages/auth/`** — Supabase auth (GitHub OAuth, Google, email)
**`packages/sse/`** — SSE with event buffering (no lost events between POST and stream)
**`app/server/lib/db.js`** — SQLite with better-sqlite3

---

## What's actually missing / broken

After reading the code carefully, here are the **real gaps**:

### Gap 1: URL sync after deploy (the #1 pain point — not built at all)

After Railway gives a live URL like `https://takeoff-myapp-production.up.railway.app`,
the user must manually update:
1. Supabase Auth → Site URL + Redirect URLs
2. Railway env vars → `NEXT_PUBLIC_APP_URL`, `APP_URL`, etc.
3. `.env.production` in the codebase
4. Hardcoded `localhost:3000` references in source files

**None of this exists.** The deploy route sets `live_url` in the DB and
broadcasts the URL — and that's where it stops.

### Gap 2: Env var injection is empty

`deployFromRepo()` accepts a `variables` param but the deploy route passes
`{}` — it never reads `envVarsRequired` from the build plan or asks the user
to provide values. The deployed app on Railway has no env vars set.

### Gap 3: `features-describer.js` and `plan-generator.js` are incomplete

`features-describer.js` exists but the actual implementation is unknown —
needs verification. `plan-generator.js` generates static steps but doesn't
wire to context-generator for per-step prompts.

### Gap 4: No Supabase provisioning

The analyzer detects `@supabase/supabase-js` in deps and flags auth/database
gaps — but there's no code to actually provision a Supabase project, create
the schema, or configure auth providers. The user still has to do this manually.

### Gap 5: BuildStory is passive — no prompt capture from Cursor/IDE

BuildStory accepts manual entries via API. There's no Cursor extension or
git commit hook to auto-capture prompts from the actual build workflow.

### Gap 6: No `NEXT_PUBLIC_*` variable update after URL is known

Next.js apps with `NEXT_PUBLIC_APP_URL` baked in at build time need a
rebuild after the URL is set. Currently the deploy triggers build before
the URL is known, so the baked URL is empty.

---

## Phase 2 Build Spec — in priority order

---

### Feature 1: Env Var Collection UI + Injection (HIGHEST PRIORITY)

**Why first:** Without this, every deployed app is broken. Railway deploys
succeed but the app crashes because `SUPABASE_URL`, `DATABASE_URL`, etc.
are missing.

**What to build:**

`app/client/src/pages/EnvSetup.tsx` — new page in the deploy flow

```
URL: /project/:id/env-setup
Appears between: ReadinessReport (score) → Deploy trigger
```

The page reads `buildPlan.envVarsRequired` from the project and shows a
form with one input per required env var.

```typescript
// buildPlan.envVarsRequired shape (already produced by build-detector.js):
interface EnvVar {
  name: string;        // e.g. "SUPABASE_URL"
  hasDefault: boolean; // whether .env.example has a non-empty value
  value: string | null; // the example value if present
}
```

Display logic:
- If `hasDefault: true` → pre-fill the input with the example value, but
  mark it clearly: "This is an example — replace with your real value"
- If `hasDefault: false` → empty input, required field
- Group by prefix: `SUPABASE_*`, `DATABASE_*`, `STRIPE_*`, `NEXT_PUBLIC_*`
- Show a link to where to get each value (Supabase dashboard, Stripe keys, etc.)
- "Skip for now" option (deploys without vars, user can add later in Railway)

On submit, the values go to a new API endpoint:

```
POST /api/takeoff/:id/env-vars
Body: { vars: { SUPABASE_URL: "https://...", ... } }
```

Server stores vars encrypted in the project record (or just in Railway directly).

Then the deploy flow uses them:

In `app/server/routes/deploy.js` → `runDeploy()`, replace:
```js
// CURRENT (broken — no vars)
const result = await railway.deployFromRepo(`${project.owner}/${project.repo}`, {
  projectName,
  branch: project.branch || 'main',
  onProgress: (p) => broadcast(deployStreamId, { type: 'progress', ...p }),
});
```

With:
```js
// FIXED
const storedVars = getProjectEnvVars(projectId); // from DB or decrypted store
const result = await railway.deployFromRepo(`${project.owner}/${project.repo}`, {
  projectName,
  branch: project.branch || 'main',
  variables: storedVars,
  onProgress: (p) => broadcast(deployStreamId, { type: 'progress', ...p }),
});
```

---

### Feature 2: URL Sync — auto-update everything after deploy

**What to build:** `app/server/services/url-sync.js`

This runs automatically after a successful deploy, using the `live_url`
and the `project_services` dependency map.

```js
// app/server/services/url-sync.js

async function syncLiveUrl(projectId, liveUrl, { supabaseProjectRef, vars }) {
  const results = [];

  // 1. Update Supabase Auth redirect URLs
  if (supabaseProjectRef) {
    try {
      await updateSupabaseAuthUrls(supabaseProjectRef, liveUrl);
      results.push({ service: 'supabase_auth', status: 'synced', url: liveUrl });
    } catch (err) {
      results.push({ service: 'supabase_auth', status: 'failed', error: err.message });
    }
  }

  // 2. Update Railway env vars that reference the URL
  const urlVarNames = ['APP_URL', 'NEXT_PUBLIC_APP_URL', 'SITE_URL', 'PUBLIC_URL', 'BASE_URL'];
  const railwayUpdates = {};
  for (const name of urlVarNames) {
    if (vars[name] !== undefined) {
      railwayUpdates[name] = liveUrl;
    }
  }
  if (Object.keys(railwayUpdates).length > 0) {
    // use railway.setVariables() — already built in packages/railway
    results.push({ service: 'railway_env', status: 'synced', updated: Object.keys(railwayUpdates) });
  }

  return results;
}

async function updateSupabaseAuthUrls(projectRef, liveUrl) {
  // Supabase Management API — requires SUPABASE_SERVICE_KEY
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_MANAGEMENT_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        site_url: liveUrl,
        redirect_urls: [`${liveUrl}/auth/callback`, `${liveUrl}/**`],
      }),
    }
  );
  if (!res.ok) throw new Error(`Supabase API ${res.status}: ${await res.text()}`);
}
```

**New DB table needed:**

```sql
CREATE TABLE IF NOT EXISTS project_services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  service_type TEXT NOT NULL, -- 'supabase' | 'railway' | 'vercel' | 'github'
  external_id TEXT,           -- Supabase project ref, Railway project ID, etc.
  config TEXT,                -- JSON: what to update on URL change
  synced_at TEXT,
  FOREIGN KEY (project_id) REFERENCES deployments(id) ON DELETE CASCADE
);
```

**Wire into deploy route:**

In `app/server/routes/deploy.js` → after `result.status === 'SUCCESS'`:

```js
// After setting live_url in DB, run sync
setImmediate(async () => {
  try {
    broadcast(deployStreamId, { type: 'progress', phase: 'url-sync',
      message: 'Syncing live URL across services...' });

    const syncResults = await syncLiveUrl(projectId, result.url, {
      supabaseProjectRef: project.supabase_project_ref, // from env vars user entered
      vars: storedVars,
    });

    broadcast(deployStreamId, { type: 'url-synced', results: syncResults });
  } catch (err) {
    console.error('URL sync failed (non-fatal):', err.message);
    // Don't fail the deploy over URL sync — it's best-effort
  }
});
```

**Frontend:** Add a "Sync URLs" step to `DeployProgress.tsx` that shows
each service syncing (Supabase Auth ✓, Railway env ✓, etc.). Use the
existing progress SSE pattern.

---

### Feature 3: Supabase Project Provisioning

**What to build:** `app/server/services/supabase-provisioner.js`

When analyzer detects `@supabase/supabase-js` in deps and `gaps.database.exists`
is false OR `gaps.auth.exists` is false, offer to provision a Supabase project.

```js
// app/server/services/supabase-provisioner.js

const SUPABASE_MGMT = 'https://api.supabase.com/v1';

async function provisionProject(projectName, dbPassword, orgId) {
  // 1. Create Supabase project
  const proj = await supabaseFetch('POST', '/projects', {
    name: projectName,
    db_pass: dbPassword,
    region: 'us-east-1',
    organization_id: orgId,
  });

  // 2. Poll until ready (takes 30-60s)
  let project = proj;
  while (project.status !== 'ACTIVE_HEALTHY') {
    await sleep(5000);
    project = await supabaseFetch('GET', `/projects/${proj.ref}`);
  }

  // 3. Get connection strings
  const connStr = `postgresql://postgres:${dbPassword}@db.${proj.ref}.supabase.co:5432/postgres`;
  const supabaseUrl = `https://${proj.ref}.supabase.co`;

  // 4. Get anon key from project API keys
  const keys = await supabaseFetch('GET', `/projects/${proj.ref}/api-keys`);
  const anonKey = keys.find(k => k.name === 'anon public')?.api_key;

  return {
    projectRef: proj.ref,
    supabaseUrl,
    anonKey,
    databaseUrl: connStr,
    projectId: proj.id,
  };
}

async function configureAuthProviders(projectRef, providers) {
  // providers: ['github', 'google']
  // Uses Supabase Management API to enable OAuth providers
  // Requires user to paste their GitHub/Google OAuth app credentials
}
```

**Key env var needed:** `SUPABASE_MANAGEMENT_KEY` — a Supabase Personal Access
Token (PAT) from supabase.com/dashboard/account/tokens.

**Wire into the flow:**

In `EnvSetup.tsx`, add a toggle: "Provision a new Supabase project for me"
If checked, show fields for org selection and DB password, then call:
`POST /api/takeoff/:id/provision-supabase`

This endpoint runs `provisionProject()`, stores the returned credentials as
the env vars for the project, and pre-fills the `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`DATABASE_URL` fields.

---

### Feature 4: Cursor Extension — prompt-to-commit capture

**What to build:** A VS Code extension at `cursor-extension/` in the repo root.

This is a 2-3 day build. Spec:

**File structure:**
```
cursor-extension/
├── package.json        ← VS Code extension manifest
├── src/
│   └── extension.ts   ← Main extension entry
└── tsconfig.json
```

**`package.json` key fields:**
```json
{
  "name": "takeoff-buildstory",
  "displayName": "Takeoff BuildStory",
  "description": "Capture prompts and commits for your BuildStory",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "configuration": {
      "properties": {
        "takeoff.projectId": {
          "type": "string",
          "description": "Your Takeoff project ID"
        },
        "takeoff.apiKey": {
          "type": "string",
          "description": "Your Takeoff API key"
        }
      }
    }
  }
}
```

**`extension.ts` — core logic:**

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Hook into git commits
  const gitExt = vscode.extensions.getExtension('vscode.git')?.exports;
  const git = gitExt?.getAPI(1);

  if (git) {
    git.repositories.forEach((repo: any) => {
      repo.onDidCommit(async () => {
        const config = vscode.workspace.getConfiguration('takeoff');
        const projectId = config.get<string>('projectId');
        if (!projectId) return; // extension not configured, skip silently

        // Show optional prompt capture input
        const prompt = await vscode.window.showInputBox({
          prompt: 'What did you just build? (optional — adds to BuildStory)',
          placeHolder: 'e.g. Added Google auth using Supabase SSR helpers',
          ignoreFocusOut: false,
        });

        // Get the latest commit
        const log = await repo.log({ maxEntries: 1 });
        const commit = log[0];

        // Send to Takeoff API
        await sendToBuildStory(projectId, {
          type: 'prompt',
          prompt: prompt || null,
          commitHash: commit.hash,
          commitMessage: commit.message,
          filesChanged: commit.files?.map((f: any) => f.uri.fsPath) || [],
        });
      });
    });
  }
}

async function sendToBuildStory(projectId: string, entry: object) {
  const config = vscode.workspace.getConfiguration('takeoff');
  const apiKey = config.get<string>('apiKey');
  const apiUrl = config.get<string>('apiUrl') || 'https://takeoff.app';

  try {
    await fetch(`${apiUrl}/api/projects/${projectId}/build-story`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(entry),
    });
  } catch {
    // Silently fail — never interrupt the developer's flow
  }
}
```

**The UX principle:** The input box is optional and appears AFTER the commit
succeeds. If the developer ignores it (presses Escape), nothing is lost.
If they fill it in, the prompt is attached to that commit in BuildStory.

---

### Feature 5: BuildStory shareable page

`app/client/src/pages/ShareableStory.tsx` — this file already exists in the
repo. Need to verify its current state and complete it.

The shareable URL pattern: `takeoff.app/story/:slug`

The page should show:
- App name, description, stack
- Timeline of build entries (prompts, milestones, deploys)
- Stats: total prompts, deploy count, time to first deploy
- Link to the live app if deployed
- "Built with Takeoff" attribution

**API needed:** `GET /api/public-story/:slug` (unauthenticated)
- `app/server/routes/public-story.js` — file exists, check current state

---

## Files to create / modify — summary

### New files:
```
app/client/src/pages/EnvSetup.tsx          ← Env var collection UI
app/server/services/url-sync.js            ← URL sync after deploy
app/server/services/supabase-provisioner.js ← Supabase project creation
cursor-extension/package.json              ← VS Code extension
cursor-extension/src/extension.ts          ← Extension logic
cursor-extension/tsconfig.json             ← TS config
```

### Files to modify:
```
app/server/routes/deploy.js                ← Wire env vars + URL sync
app/server/routes/takeoff.js               ← Add POST /:id/env-vars, POST /:id/provision-supabase
app/server/lib/db.js                       ← Add project_services table
app/client/src/pages/DeployProgress.tsx    ← Add URL sync step to progress UI
app/client/src/services/api.ts             ← Add EnvVar, UrlSync API types + calls
```

### Files to verify (exist but state unknown):
```
app/client/src/pages/ShareableStory.tsx    ← Check completion
app/server/routes/public-story.js          ← Check completion
app/server/services/features-describer.js  ← Check if actually works
app/server/services/plan-generator.js      ← Check per-step context generation
```

---

## Env vars to add to `.env.example`

```bash
# Supabase Management API — required for Supabase provisioning + URL sync
SUPABASE_MANAGEMENT_KEY=sbp_your-personal-access-token

# Takeoff's own Supabase org ID (for provisioning customer projects)
SUPABASE_ORG_ID=your-org-id
```

---

## Build order for Cursor sessions

**Session 1 (2-3 hours):** Feature 1 — Env var collection + injection
- Build `EnvSetup.tsx` page
- Add `POST /api/takeoff/:id/env-vars` endpoint
- Modify `runDeploy()` to pass vars to Railway
- Test: deploy a Next.js app, verify env vars appear in Railway

**Session 2 (2-3 hours):** Feature 2 — URL sync
- Build `url-sync.js` service
- Add `project_services` table to `db.js`
- Wire into `deploy.js` after success
- Add sync step to `DeployProgress.tsx`
- Test: deploy, verify Supabase auth redirect URL is updated automatically

**Session 3 (2-3 hours):** Feature 3 — Supabase provisioning
- Build `supabase-provisioner.js`
- Add provision option to `EnvSetup.tsx`
- Add `POST /api/takeoff/:id/provision-supabase` endpoint
- Test: full flow — paste repo → provision Supabase → deploy → URL sync

**Session 4 (2-3 hours):** Feature 4 — Cursor extension
- Scaffold extension in `cursor-extension/`
- Implement git commit hook + input box
- Publish to VS Code marketplace (or install as .vsix locally)
- Test: make commit in Cursor, see entry appear in BuildStory

**Session 5 (1-2 hours):** Feature 5 — Verify + complete shareable story
- Read `ShareableStory.tsx` and `public-story.js`
- Fill in what's missing
- Test: share a project URL, verify it loads publicly

---

## Key architectural decisions — don't re-litigate these

1. **SQLite for now** — `better-sqlite3` is synchronous and fast. No need for
   Postgres until 1000+ concurrent users. Don't switch.

2. **SSE not WebSockets** — SSE is simpler, works through proxies, already
   implemented. Don't switch to WebSockets.

3. **Railway for customer app deployment** — Already integrated. Vercel adds
   complexity (different env var API, different project model). Stick with Railway.

4. **No job queue yet** — `setImmediate()` is fine for 0-100 concurrent deploys.
   Add Inngest/BullMQ when Railway deploy queue depth exceeds 20 concurrent jobs.

5. **Env vars stored plaintext in SQLite for now** — Encrypt at rest before
   going to production at scale. For MVP, a locked-down server is sufficient.

6. **Supabase Management API requires user's own PAT** — Takeoff cannot provision
   on behalf of users without their Supabase credentials. The user must paste a
   Personal Access Token from supabase.com/dashboard/account/tokens.

---

## Testing each feature

**Env vars:**
```bash
# After Session 1, test with a Next.js app that requires SUPABASE_URL
curl -X POST http://localhost:3001/api/takeoff \
  -H "Content-Type: application/json" \
  -d '{"repoUrl": "https://github.com/vercel/next.js"}'
# Note the projectId, then set env vars, then deploy
# Check Railway dashboard: variables should be set
```

**URL sync:**
```bash
# After Session 2, check Supabase project after deploy
# Dashboard → Authentication → URL Configuration
# site_url should match the Railway URL
```

**Full integration test:**
```bash
# Create a fresh Next.js + Supabase app on GitHub
# Paste into Takeoff
# Walk all 6 steps
# Verify: app is live, Supabase URL is updated, env vars are set
```