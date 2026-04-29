# CONTEXT.md — Build Instructions for Cursor

## What this project is

CodeGuru (being renamed to UpdateAI) is a web app that helps vibe coders and PMs
finish the last 40% of their AI-built apps. The user pastes a GitHub repo URL,
we analyze the actual codebase via GitHub API, and generate `.context.md` files
that ground AI tools (Cursor, Claude Code) with the context they need to
generate correct backend code — auth, database, deployment, permissions.

The core insight: vibe coders get stuck at ~60% because AI tools generate great
UI but fail at backend infrastructure. They fail because they lack context about
what the app is, what constraints exist, and what architectural decisions matter.
`.context.md` files solve this by being the source of truth between human and AI.

## What exists today (in this repo)

### Reuse these — they're solid:
- `packages/auth/` — Supabase auth wrapper with OAuth (GitHub, Google),
  email/password, Express middleware (requireAuth, optionalAuth), cookie
  management. Well-structured. Use this as-is for our own auth.
- `packages/github/` — GitHub API service with fetchRepoTree, fetchFileContent,
  fetchRepoMeta, parseRepoUrl, rate-limit handling, truncation tracking, and
  fetchCommits. Originally migrated from the legacy `code-reviewer` prototype
  and extended. `app/server/services/github.js` is a one-line re-export shim.

### Legacy / archived (NOT in the working tree)
The following directories were removed from `main` and now live on the
`archive/legacy-snapshot` git branch:
- `_archived/code-reviewer/` — original PR/repo-review prototype.
- `_archived/codebase-analyzer/` — fake-analysis prototype (replaced by `app/server/services/analyzer.js`).
- `_archived/fastapi-project/` — abandoned Python stub.
- `code-visualizer-mvp/workspace-app/`, `workspace-prototype/`, `knowledge-graph-extension/` — old collaborative workspace experiments.

Do NOT reintroduce these into the live tree. The file scanner in
`app/server/services/analyzer.js` skips any path containing `_archived` or
`legacy` even if they reappear on disk.

## What to build — the new unified app

### Architecture

```
codeguru/
├── packages/auth/           ← KEEP AS-IS (already works)
├── app/
│   ├── server/
│   │   ├── app.js           ← Express server, port 3001
│   │   ├── services/
│   │   │   ├── github.js    ← One-line re-export of `@codeguru/github` (packages/github)
│   │   │   ├── analyzer.js  ← NEW: reads repo files, builds codebase model
│   │   │   └── context-generator.js ← NEW: generates .context.md via Claude
│   │   ├── routes/
│   │   │   ├── health.js
│   │   │   ├── projects.js  ← NEW: CRUD for user's projects (repos they've analyzed)
│   │   │   └── analyze.js   ← NEW: trigger analysis, stream results
│   │   └── lib/
│   │       ├── db.js        ← Supabase for persistence
│   │       └── sse.js       ← One-line re-export of `@codeguru/sse` (packages/sse)
│   └── client/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── Landing.tsx      ← Hero + paste URL input
│       │   │   ├── Dashboard.tsx    ← User's analyzed repos
│       │   │   ├── Analysis.tsx     ← Real-time analysis progress
│       │   │   └── Results.tsx      ← Generated context files + completion gaps
│       │   ├── components/
│       │   │   ├── RepoInput.tsx
│       │   │   ├── AnalysisProgress.tsx
│       │   │   ├── ContextFileViewer.tsx  ← Renders .context.md with syntax highlight
│       │   │   ├── CompletionGaps.tsx     ← Shows what's missing (auth, db, deploy)
│       │   │   └── CopyButton.tsx
│       │   ├── hooks/
│       │   │   ├── useAuth.ts
│       │   │   └── useSSE.ts
│       │   └── services/
│       │       └── api.ts
│       └── package.json
└── package.json              ← Root with workspaces
```

### Server: services/analyzer.js

This is the brain. It reads the actual repo via GitHub API and builds a
structured model of what the codebase contains.

```
INPUT: GitHub repo URL
PROCESS:
  1. fetchRepoMeta(owner, repo) → get description, default branch, language
  2. fetchRepoTree(owner, repo, branch) → get full file tree
  3. Identify key files to read (smart selection, not everything):
     - package.json, requirements.txt, Cargo.toml, go.mod (dependencies)
     - Next/Nuxt/Vite config files (framework detection)
     - .env.example, env.example (environment shape)
     - README.md (existing documentation)
     - src/ or app/ directory structure (architecture)
     - Any existing .cursorrules, CLAUDE.md, .context.md files
     - Route files, API files, middleware files
     - Auth-related files (login, signup, session, middleware with "auth")
     - Database files (schema, migrations, models, prisma, drizzle)
     - Config files (docker-compose, Dockerfile, vercel.json, netlify.toml)
  4. fetchFileContent for each key file (respect rate limits, max ~30 files)
  5. Build a structured codebase model:
     {
       meta: { name, description, language, defaultBranch },
       stack: { framework, runtime, styling, database, auth, deployment },
       structure: { directories, entryPoints, routeFiles, configFiles },
       features: [ { name, path, hasUI, hasAPI, hasTests } ],
       gaps: {
         auth: { exists: bool, provider: string|null, issues: [] },
         database: { exists: bool, type: string|null, hasSchema: bool, hasMigrations: bool },
         deployment: { exists: bool, platform: string|null, hasCI: bool },
         permissions: { exists: bool, hasRoles: bool },
         testing: { exists: bool, coverage: string },
         errorHandling: { exists: bool, hasGlobalHandler: bool },
         envConfig: { exists: bool, hasExample: bool, missingVars: [] }
       },
       existingContext: { hasCursorRules: bool, hasClaudeMd: bool, hasContextMd: bool },
       fileContents: { [path]: content }  // the actual file contents we read
     }
OUTPUT: codebase model object
```

IMPORTANT: The file selection must be smart. Don't try to read every file.
Prioritize files that reveal architecture and gaps. Use the file tree to
identify patterns (e.g., if there's a `prisma/` directory, read `schema.prisma`;
if there's `src/app/` with `layout.tsx`, it's Next.js App Router).

### Server: services/context-generator.js

Takes the codebase model and generates `.context.md` files using Claude.

```
INPUT: codebase model from analyzer.js
PROCESS:
  1. Generate app-level .context.md:
     - Send codebase model to Claude with a prompt that says:
       "Based on this codebase analysis, generate a .context.md file that
        captures the app's purpose, tech stack, architecture decisions,
        constraints, and current state. Follow the .context.md spec below."
     - Include the SPEC (see below)
     - Stream the response via SSE

  2. Generate feature-level .context.md files:
     - For each detected feature directory (auth, api, components, pages, etc.)
     - Send the relevant subset of the codebase model + the app-level context
     - Claude generates a feature-specific context file

  3. Generate gap-specific .context.md files:
     - For MISSING capabilities (no auth, no database, no deployment):
     - Claude generates a PRESCRIPTIVE context file that describes what
       SHOULD be built, with constraints and recommended approach
     - This is the key differentiator — it's not just documenting what exists,
       it's specifying what's needed so AI tools can build it correctly

  4. Generate completion report:
     - Overall completion percentage
     - What's done, what's missing
     - Priority order for gaps
     - For each gap: the .context.md that will help AI tools fill it

OUTPUT: Array of { path, content, type: 'existing'|'gap' } objects
```

### Claude prompt for context generation

When calling Claude to generate context files, use this system prompt:

```
You are an expert software architect analyzing a codebase to generate
.context.md files. These files serve as the source of truth between
human developers and AI coding tools.

Your output will be used by vibe coders — people who build apps primarily
through AI tools like Cursor and Claude Code. They understand their app's
purpose but may not know engineering best practices for auth, databases,
deployment, etc.

For EXISTING code: document what's there accurately. Capture the purpose,
constraints, decisions, and dependencies.

For MISSING capabilities: write a PRESCRIPTIVE context file that specifies
what should be built. Include:
- What the capability needs to do (in plain English)
- Recommended approach given the existing tech stack
- Constraints that must be respected
- Common pitfalls to avoid
- How it connects to existing code

Always follow the .context.md spec format with these sections:
## owner, ## purpose, ## constraints, ## decisions, ## ai-log, ## dependencies, ## status

Keep language clear and non-technical where possible. A PM should be able
to read and understand every context file.
```

### The .context.md spec

See SPEC.md in the updateai-cli project for the full spec. The key sections:

- `## owner` — who maintains this module
- `## purpose` — what it does and why (plain English)
- `## constraints` — hard rules that must not be violated
- `## decisions` — architectural choices with rationale
- `## ai-log` — record of AI-assisted changes
- `## dependencies` — what this connects to
- `## status` — current state

### Client: Key pages

#### Landing.tsx
- Clean hero: "You built the front end. We'll help you ship the rest."
- Single input: paste a GitHub repo URL
- "Analyze" button → starts analysis
- No auth required to analyze (auth for saving/dashboard)
- Show example repos people can try

#### Analysis.tsx
- Real-time progress via SSE
- Show steps: "Reading repo structure..." → "Analyzing tech stack..." →
  "Detecting capabilities..." → "Generating context files..."
- Stream the analysis as it happens (the same SSE-driven progress pattern the legacy codebase-analyzer prototype used)

#### Results.tsx
This is the most important page. It shows:

1. **Completion overview** — visual bar showing what % of a shippable app
   exists. Categories: UI, Routing, API, Auth, Database, Permissions, Deploy.

2. **Generated context files** — each .context.md displayed in a card with:
   - File path (e.g., `src/auth/.context.md`)
   - Type badge: "existing" (green) or "needs building" (amber)
   - Rendered markdown preview
   - "Copy" button to copy the file content
   - "Download all" button to get a zip of all context files

3. **Next steps** — prioritized list of what to build next, with the
   context file that will help AI tools do it right. Each step has a
   "Copy context to clipboard" action so the user can paste it into Cursor.

### Auth flow

Use the existing `packages/auth` package. The app works without auth
(anyone can analyze a public repo), but auth unlocks:
- Saving analysis results
- Dashboard of past analyses
- Analyzing private repos (using their GitHub token)
- Re-analyzing when code changes

Wire up auth via `app/server/app.js`, which already mounts the same Supabase
session middleware the legacy code-reviewer prototype used.

### Database (Supabase)

Tables needed:

```sql
-- Users are managed by Supabase Auth

-- Projects: repos a user has analyzed
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  repo_url text not null,
  repo_owner text not null,
  repo_name text not null,
  analysis jsonb,          -- the full codebase model
  context_files jsonb,     -- generated .context.md files
  completion_pct integer,  -- overall completion percentage
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable RLS
alter table projects enable row level security;
create policy "Users see own projects" on projects
  for all using (auth.uid() = user_id);
```

### Environment variables

```
# Server
PORT=3001
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...          # For higher rate limits + private repos
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_REDIRECT_URL=http://localhost:3001/auth/callback

# Client
REACT_APP_API_URL=http://localhost:3001
```

## Build order

Follow this sequence. Each step should be working before moving to the next.

### Step 1: Project setup
- Create the `app/` directory structure above
- Set up root package.json with workspaces: ["packages/*", "app"]
- Copy `packages/auth` as-is
- (Done) `app/server/services/github.js` and `app/server/lib/sse.js` are already migrated from the legacy code-reviewer prototype.
- Set up Express server with health check
- Set up React client with Tailwind (CRA or Vite, either works)
- Verify: server starts, client starts, health check returns 200

### Step 2: GitHub repo reading (analyzer.js)
- Build the analyzer service that reads a real repo
- Start with: parseRepoUrl → fetchRepoMeta → fetchRepoTree
- Add smart file selection logic
- Add fetchFileContent for selected files
- Build the codebase model object
- Add POST /api/analyze endpoint that returns the model as JSON
- Test with a real public repo (try: https://github.com/samyaks/CodeGuru)
- Verify: paste a URL, get back a structured model with real file contents

### Step 3: Context generation (context-generator.js)
- Build the Claude integration that generates .context.md files
- Start with just the app-level context file
- Add SSE streaming so the user sees generation in real-time
- Add feature-level context generation
- Add gap-specific context generation (the prescriptive files)
- Add completion percentage calculation
- Verify: paste a URL, get back multiple .context.md files + completion %

### Step 4: Client — Landing + Analysis + Results
- Build Landing page with repo URL input
- Build Analysis page with SSE progress
- Build Results page with context file viewer
- Add copy-to-clipboard for each context file
- Add "Download all as zip" functionality
- Verify: full flow works end-to-end without auth

### Step 5: Auth + persistence
- Wire up @codeguru/auth package
- Add Supabase database with projects table
- Add Dashboard page showing past analyses
- Add save/load for analysis results
- Verify: login with GitHub, analyze a repo, see it in dashboard

### Step 6: Polish + deploy
- Add loading states, error handling, empty states
- Add rate limit handling for GitHub API
- Deploy to Vercel (client) + Railway/Render (server)
- Or deploy as a single Next.js app on Vercel

## Key technical decisions

1. **Read files via GitHub API, not git clone.** Cloning is slow and requires
   disk space. The API lets us selectively read only the files we need.

2. **Smart file selection matters.** Don't read node_modules, dist, or binary
   files. Prioritize files that reveal architecture: configs, route definitions,
   schemas, middleware. Cap at ~30 files to stay within Claude's context window
   and GitHub's rate limits.

3. **Stream everything.** Use SSE for analysis progress and context generation.
   The user should never stare at a spinner — they should see what's happening.

4. **Context files are the product, not the analysis.** The analysis is a means
   to generate great context files. The user's success metric is: "I took this
   context file back to Cursor and it generated working auth on the first try."

5. **Gap detection is more valuable than documentation.** Telling someone what
   they already built is nice. Telling them what they're MISSING and giving
   them the spec to build it — that's the product.

## What NOT to build yet

- Chrome extension (from code-visualizer-mvp) — premature
- Collaborative features / real-time multiplayer — premature
- GitHub App / webhook listener — phase 2
- CLI tool — exists in updateai-cli, add later
- PR comments — phase 2
- Team features — phase 2
- Billing / payments — way too early

Focus ruthlessly on the core loop:
Paste URL → See what you have → Get context files → Copy to Cursor → Ship.
