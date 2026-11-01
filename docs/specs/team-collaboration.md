# Team collaboration with coding agents

> **Draft, 2026-10-31.** A proposal, not a commitment. Where it touches the
> roadmap, [ROADMAP.md](../../ROADMAP.md) wins until this is accepted.

## Problem

A team of two to ten people builds one app, each with Cursor or Claude Code
running agents in parallel branches. The agents are fast and know nothing about
each other. Three things go wrong:

1. **Two agents build the same thing**, or one rewrites what another just
   built, and nobody finds out until the PRs conflict or production breaks.
2. **Product intent lives in people's heads and chat.** Each agent re-guesses
   what the app is for from the code, and each guess is a little different.
3. **No one can see what is in flight.** "Who is on checkout?" is answered in
   standup, not by a screen.

The app already has most of the pieces to fix this: confirmed jobs and
invariants are a shared spec, `claims` record who is working on what, and
`check_intent` warns an agent before it edits a file that a confirmed invariant
depends on. What it lacks is any idea of a team, any live connection to the
agents, and any view of work before it lands on the default branch.

## Goals

- A project belongs to a team, and every member and their agents see the same
  confirmed spec.
- An agent can find out, before it starts, whether someone else holds the job
  it is about to touch, and can say that it holds one.
- Every PR shows which jobs and invariants it touches, who has claimed them,
  and which other open PRs touch the same ones.
- The confirmed spec is in the repo, where every agent reads it without setup.
- One screen answers "what is in flight, by whom, and is it still correct?"

## Non-goals

- **Locking files or blocking pushes.** Claims are advisory. Agents and people
  can work on a claimed job; they are told, not stopped.
- **Replacing PR review.** The PR check informs reviewers; it does not approve.
- **Agents confirming intent.** Agents can propose. Only a person confirms.
- **An IDE extension.** MCP plus a file in the repo covers Cursor and Claude
  Code. `cursor-extension/` stays as it is.
- **Billing.** Whether team workspaces are paid is an open decision below.

## Working agreement

The standard the app is built around. It is also the answer to "write a
standard for how engineering and product stay in sync" from the 2026-10-25 user
session.

| Who | Owns | Does |
| --- | --- | --- |
| Product | Jobs | Confirms or challenges each job. A confirmed job is a promise about what the app does for a persona. |
| Engineering | Invariants | Confirms the invariants under each job: the checkable rules that keep the job true. |
| Agents | Nothing | Read the confirmed spec, claim jobs, propose candidate invariants for what they built. |
| The app | The record | Links invariants to code, re-checks them on every push and PR, and shows what changed. |

Roles are a working agreement, not permissions. A two-person team can have one
person do both columns. Permissions are covered by workspace roles below.

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Project access | `checkProjectAccess`, [helpers.js:7](../../app/server/lib/helpers.js) | One owner per project (`deployments.user_id`). Ownerless projects are open to anyone signed in. |
| Jobs | `map_jobs`, [005_product_map.sql](../../app/server/migrations/005_product_map.sql) | Created once per project by `autoCreateProductMap` in [takeoff.js](../../app/server/routes/takeoff.js), which skips if a map exists. Job IDs survive re-analysis, so claims can point at them. |
| Invariants | `intent_statements` + `statement_jobs`, [023_job_invariants.sql](../../app/server/migrations/023_job_invariants.sql) | Hang under jobs, or stand alone as global guarantees. `source` is `inferred` or `human`. |
| Satisfaction | [satisfaction.js](../../app/server/services/intent/satisfaction.js) | `hashLinkedFiles` + one LLM call per invariant. Baseline comes from the default-branch scan in `analysis_files`. |
| Claims | `claims`, [020_claims.sql](../../app/server/migrations/020_claims.sql); [db.js:2351](../../app/server/lib/db.js) | Target a statement or a feature area, not a job. `claimant_id` is a free string. Released rows are kept, but nothing releases a claim. |
| MCP tools | [mcp-tools.js](../../app/server/services/intent/mcp-tools.js) | Five tools, tested, no transport or auth. |
| Webhook | [github-webhook.js](../../app/server/routes/github-webhook.js) | Ignores every event except `push` (line 132), and pushes to any branch but the tracked one (line 49). |
| PR fetch | `fetchPullRequest`, `fetchPRFiles` in [packages/github/index.js](../../packages/github/index.js) | Exist for the legacy reviews flow. `fetchPRFiles` reads one page of 100 files. |
| GitHub App | [PR #28](https://github.com/samyaks/CodeGuru/pull/28), draft | Contents, Metadata and Pull requests, all read-only. Push event only. Migration 025 is taken by it. |

## Design

Five parts, in build order. Each has its own "done when".

### 1. Workspaces and members

A workspace owns projects. A person can be in several.

**Roles.** These are permissions, separate from the working agreement above.

| Role | Can |
| --- | --- |
| Owner | Everything an editor can, plus manage members, delete projects, and delete the workspace. |
| Editor | Scan and re-analyze, confirm or challenge jobs and invariants, claim, create an MCP key. |
| Viewer | Read everything and comment. No MCP key. |

**Joining.**

- Owners invite by email or GitHub login. An invite is a link with a role and
  an expiry.
- When a signed-in user has GitHub access to a repo whose project is in a
  workspace they are not in (from `github_repo_access`, PR #28), the dashboard
  offers "Request to join". An owner approves. Repo access alone never grants
  membership.

**Access rule.** `checkProjectAccess(project, req, minRole)` replaces the
owner check. A request passes when `req.user` is a member of the project's
workspace with at least `minRole`. Reads need `viewer`, writes need `editor`,
deletes need `owner`.

**Migration of existing data.** Each user with projects gets a personal
workspace named after their GitHub login, with themself as owner, and their
projects move into it. Behavior for solo users does not change.

**Ownerless projects** (scanned signed out) become read-only for everyone.
To edit one, sign in and scan the repo into a workspace. This closes the
Stage 1 hole where any signed-in user can edit or delete them.

**Done when:** two accounts share a project; a viewer cannot confirm, claim or
delete; an ownerless project cannot be edited; existing solo users see no
change; server tests cover every role on every write route.

### 2. MCP server

The bridge between the shared spec and the agents.

**Transport.** Streamable HTTP at `POST /mcp`, wrapping the functions in
`mcp-tools.js`. Auth is a bearer key.

**Keys are per member, not per project.** A key belongs to one person in one
workspace and can reach every project in it. Keys are shown once, stored
hashed, listed in Settings with a label, last-used time, and a revoke button.
Every claim and proposal made with a key is attributed to its person, plus the
`agent` label the client sends (`cursor`, `claude-code`, or free text). So a
claim reads "Priya · Claude Code", not an opaque ID.

**Project lookup.** Every tool accepts `repo` (`owner/name`) as well as
`project_id`, since an agent knows its git remote but not our IDs. The key's
workspace scopes the lookup.

**Tools.** None have shipped, so the shapes in `mcp-tools.js` can change
freely. Identity comes from the key, so no tool takes `claimant_id`.

| Tool | Returns or does | LLM |
| --- | --- | --- |
| `get_intent(job_id?)` | Confirmed jobs with their confirmed invariants, plus global guarantees and non-goals. Replaces the flat statement list, since 023 made jobs the confirmation unit. | No |
| `check_intent(file_paths[])` | For each file: the confirmed jobs and invariants linked to it, active claims on those jobs, and open PRs touching them. | No |
| `claim_job(job_id, note?, branch?)` | Stakes an advisory claim. If someone else holds it, returns their claim with `conflict: true` and does not create one. | No |
| `release_claim(job_id)` | Releases the caller's claim. | No |
| `list_claims()` | Every active claim in the project, with person, agent, note, branch and age. | No |
| `get_my_gaps()` | Open gaps under jobs the caller has claimed. | No |
| `propose_intent(job_id, text, kind, file_paths[])` | Adds a candidate invariant with `source = 'agent'` and the proposer recorded. It appears in the review queue. Capped at 20 a day per key. | No |
| `resolve_gap(statement_id)` | Re-checks one invariant against current code. Counts toward the workspace's spend ceiling. | Yes |

`claim_intent` with a `feature_area` target is dropped: since 023, jobs are
the unit people reason about, and area claims were never surfaced.

**Claims expire.** Agents crash and sessions end without releasing. A claim
is released automatically when any of these happens:

- 24 hours pass with no tool call from its holder on that project;
- the PR for its `branch` is merged or closed;
- its holder releases it, or an editor releases it from the Work tab.

**Setup docs** for Cursor (`.cursor/mcp.json`) and Claude Code
(`claude mcp add --transport http`), shown in Settings next to the key with
the values filled in. Check both clients' current config formats when writing
them.

**Done when:** a Cursor agent and a Claude Code agent, under two members' keys,
connect to one project; one claims a job and the other sees the claim and
gets `conflict: true` when it tries; a proposed invariant shows up for review;
claims expire as described.

### 3. PR check

Most agent work lives in branches. Today the app sees nothing until a push
lands on the tracked branch.

**GitHub App changes.** Subscribe to `pull_request` (opened, synchronize,
reopened, closed). Add `Checks: write`. Bundle this with the permissions in
part 4 so installers approve one update, not two.

**On opened, synchronize or reopened:**

1. Fetch the changed files, paginating past 100.
2. **Touched:** confirmed invariants with a link to a changed file, and the
   jobs they hang under (`statement_jobs`). Global guarantees count too.
3. **Claimed:** active claims on touched jobs held by someone other than the
   PR's author (matched on GitHub login).
4. **Collisions:** other open PRs in the project whose touched jobs or
   invariants overlap this one's.
5. **Still holds?** For touched invariants whose linked files changed, fetch
   those files at the head SHA, hash them with `hashLinkedFiles`, and re-check
   with `checkStatementSatisfied` when the hash differs from the baseline.
   Capped at 10 re-checks per PR push, and skipped once the workspace hits its
   daily spend ceiling. Skipped ones are listed as "not checked".
6. Post or update one check run on the head SHA.

Steps 1–4 and 6 make no LLM calls and always run.

**What the check shows.**

```
Jibe · intent

Touches 2 confirmed jobs
  Checkout › Pay for an order        claimed by Sam · Cursor (3h)
  Accounts › Reset a password        unclaimed

Invariants
  ✗ Orders are only marked paid after the payment webhook confirms
  ✓ Reset links expire after 1 hour
  – Prices are computed on the server   not checked (cap reached)

Also touched by #41 (Priya · Claude Code): Checkout › Pay for an order
```

**Conclusion** is `neutral` by default, so the check never blocks a merge.
A workspace setting turns on `failure` when a confirmed invariant does not
hold. No PR comments by default; the check updates in place on each push.

**On closed:** mark the PR closed, release claims on its branch. The merge
itself reaches Shipped through the existing push flow.

**Done when:** on a test repo with two open PRs touching one job, each PR's
check names the job, the other PR, and the claim holder; a PR that breaks an
invariant shows ✗; the re-check cap holds; nothing posts on repos not in a
workspace.

### 4. Spec in the repo

MCP needs setup per person. A file in the repo needs none, and is versioned
with the code.

**What.** A managed block in `AGENTS.md`, between
`<!-- jibe:start -->` and `<!-- jibe:end -->`, holding confirmed jobs with
their confirmed invariants, global guarantees, non-goals, and three lines on
how to check in through MCP. Content outside the markers is never touched.
If the repo has a `CLAUDE.md` that does not already reference `AGENTS.md`,
add an import line to it. Check each tool's current file conventions when
building this.

**How.** Always a pull request from the `jibe/spec-sync` branch, updated in
place, never a push to the default branch. Triggered by an "Open PR" button
in the Work tab, and optionally whenever the confirmed set changes (debounced
to one PR update per hour).

**GitHub App changes.** `Contents: write` and `Pull requests: write`,
requested together with part 3.

This replaces "Export `.context.md` files to the repo as a pull request" in
Later.

**Done when:** the PR opens on a test repo, re-running updates the same PR,
hand-written content outside the markers survives, and an agent in a fresh
Cursor or Claude Code session can answer "what jobs are confirmed?" from the
file alone.

### 5. Work tab, activity and Slack

**Work tab.** One row per confirmed job:

| Column | From |
| --- | --- |
| Job and persona | `map_jobs`, `map_personas` |
| Claimed by | Active claim: person, agent, note, age |
| In flight | Open PRs touching the job, with check status |
| Invariants | Holding / broken / not checked |
| Last shipped | Latest `shipped_items` commit touching the job |

Editors can release any claim here. Candidate invariants proposed by agents
show as a review queue at the top.

This adds a seventh tab to the six in `ReadPage.tsx`. The 2026-10-25 session
already asks to reorganize navigation and merge Map with Context; do that in
the same change so the count stays at six.

**Activity.** A feed per project of: claims taken and released, PRs opened
and merged that touch jobs, invariants broken and restored, jobs confirmed and
challenged, invariants proposed.

**Slack.** A workspace pastes an incoming-webhook URL. Three events post:
an invariant breaks on the default branch, a claim conflict, a PR collision.
A Slack app is later.

**Done when:** the Work tab matches the state of the test repo from part 3;
each activity event appears within a minute; each Slack event posts once.

## Data model

Migrations start at 026, since PR #28 takes 025. Same conventions as 019–024:
TEXT ids, TEXT + CHECK enums, TIMESTAMPTZ, forward-only and idempotent.

```sql
-- 026 workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  github_account_login TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  github_login TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT, github_login TEXT,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);
ALTER TABLE deployments ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
-- backfill: one personal workspace per distinct deployments.user_id

-- 027 mcp keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  label TEXT,
  prefix TEXT NOT NULL,          -- shown in Settings, e.g. "jb_7f3a"
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 028 claims on jobs, with people and expiry
ALTER TABLE claims ADD COLUMN job_id TEXT REFERENCES map_jobs(id) ON DELETE CASCADE;
ALTER TABLE claims ADD COLUMN user_id TEXT;
ALTER TABLE claims ADD COLUMN agent_label TEXT;
ALTER TABLE claims ADD COLUMN note TEXT;
ALTER TABLE claims ADD COLUMN branch TEXT;
ALTER TABLE claims ADD COLUMN last_seen_at TIMESTAMPTZ;
CREATE UNIQUE INDEX uniq_claims_active_job
  ON claims(project_id, job_id) WHERE status = 'active' AND job_id IS NOT NULL;
-- intent_statements.source gains 'agent'; add proposed_by (user_id) and proposed_agent

-- 029 pull requests and activity
CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  head_sha TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  author_login TEXT,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
  touched_job_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  touched_statement_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  check_run_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE TABLE project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_agent TEXT,
  subject JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_project_events_project ON project_events(project_id, created_at DESC);
```

Existing statement and area claims stay as history. Nothing new writes them.

## Dependencies on the roadmap

- **PR #28 (GitHub App)** must merge before parts 3 and 4.
- **Stage 1 "Bound scan spend"** must land before part 3: PR re-checks are new
  LLM spend triggered by anyone who can open a PR. The workspace daily ceiling
  used here is the same ceiling.
- **Stage 1 ownerless-project access** is fixed by part 1.
- **Name.** The check run, the managed-block markers, the branch name and the
  key prefix all show the product name. This spec uses Jibe.
- **Stage 3 "MCP server"** becomes part 2 of this spec, with per-member keys
  instead of the per-project key it describes.

## Open decisions

1. **Who the app is for.** The site and roadmap aim at solo builders. This
   spec aims at teams. Building it changes the landing page, the pricing page,
   and probably the order of Stage 3.
2. **Are workspaces paid?** Later lists "team workspace" under Pro.
3. **Claim expiry.** 24 hours of inactivity is a guess. Too short and claims
   vanish mid-task; too long and dead claims block people.
4. **Should the PR check be able to fail?** Proposed: off by default, a
   workspace setting turns it on.
5. **Who confirms jobs?** Proposed: any editor. A team that wants only
   product to confirm jobs would need a product role, which this spec avoids.

## Measures

- Workspaces with a second member who returns within 7 days.
- Members with an MCP key that made a call in the last 7 days.
- Claim conflicts and PR collisions surfaced per week, and how many led to a
  PR being closed or rebased.
- Share of PRs on connected repos with a completed check.
- Agent-proposed invariants confirmed versus rejected.
