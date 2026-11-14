# Product direction: one plan, kept true

Draft, 2026-11-13. Written after a whole-product review. Not yet agreed.

## The one sentence

**You and your agents share one plan, and you can always see in plain words
whether the code matches it.**

Everything in the product has to make that faster, clearer or more trustworthy.
If it doesn't, it waits.

## Where we actually are

- No active users. Seven accounts over time; only two used it on a real repo,
  and those two are the founder and a friend. The other five were curious, not
  blocked.
- Both real users work solo in Cursor or Claude Code, with agents as their team.
- The two of them are starting a new project together and have not used the
  product on it yet. That project is the first honest test.
- We don't know how the early accounts used it. The funnel (`report:funnel`) may
  tell us. Two short calls would tell us more.

## Who it's for

The people directing agents, who need to stay on the same page as each other and
as their agents about what is being built and what changed. Today that is two
humans, each with their own agents, on one repo.

It is not (yet) for a team with a separate non-technical reader, a support
team, or a sales team. Each of those is a different customer with its own
question: "is this blocking you today, and by what?"

## The job, in PULL terms

Rob Snyder's PULL framework, written for the one customer we can name: the
founder and a friend.

| | |
|---|---|
| **Project** | Keep two people's work, and both people's agents, in sync on a shared repo. |
| **Unavoidable** | A new project starting now, with branches and agent-written changes already piling up. |
| **List of options** | GitHub pull requests, Slack, talking to each other, a shared notes file. |
| **Limitations** | To be confirmed by use. The hypothesis: agent-written changes are hard to read without reading code, and none of the options know what the plan says, so none can tell us when the code has drifted from it. |

If, after two weeks, the options don't actually fail us, there is no blocked
demand and this is not yet a product.

## The product, small

Three parts, all serving the one sentence above.

### 1. A shared plan, in the repo

- One short file that every agent reads before it builds: what we're building,
  the decisions made and why, what is in flight.
- Versioned and changed by pull request. Agents propose updates; a human
  approves.
- Small on purpose. A long plan goes stale and agents stop weighting it.
- Builds on `.context.md` and the intent spec
  ([intent-driven-building.md](intent-driven-building.md)).

### 2. An "in flight" view

- Every open branch and pull request, with one plain sentence each: what it
  does, and who or which agent is working on it.
- A flag when two branches touch the same feature.
- A short "recently merged" list underneath.
- Lives where the work happens: a summary and a status on every agent pull
  request, and in the agent's own session through the extension. A web page is
  where those link to, not the main surface.

### 3. A check that keeps the plan true

This is the product. A plan with no check is a wiki.

- When a branch or pull request contradicts the plan, say so in plain words.
- When the plan is out of date, say so, and let an agent propose the update.
- When both people change direction, record the decision once, where both
  agents will see it.

Every statement about the product carries one of three statuses, shown with its
word and icon: **Cleared** (the code does this), **Holding** (partly),
**Grounded** (planned, or not true). Shipped and intended things are kept
separate so an agent can tell them apart.

## The longer bet: context truth for other agents

A checked plan is also what a marketing, support or sales agent needs. Each one
fails the same way when it improvises from stale or invented context.

We have already seen this: the trust pass (2026-11-01) removed marketing claims
that were not true (fake testimonials, "one-click deploy", "under two minutes").
A marketing agent reading only the Cleared statements could not have made them.

To keep that door open, from day one:

- Give every claim a status.
- Keep "what is true" separate from "what we plan".
- Tie each claim to evidence, in plain words.

We do **not** build those agents now. Order: the two of us first, then the
marketing agent as the natural second reader, then support and sales once there
are customers asking questions.

## The interface for the longer bet: ask the plan

Idea: a live agent that people who don't read code can talk to. Marketing, sales
and CS ask "does it do X?" and "what changed?" and can leave feedback. Product
and design use a plan mode before committing to a solution: describe a rough
idea, and get back what it would touch, what already exists, and what conflicts
with the plan.

The risk is that "ask questions about the codebase" is already a crowded
category (Cursor and Claude Code read-only, Greptile, Cody, DeepWiki), and an
agent reading raw code answers confidently and is sometimes wrong. A sales agent
that says "yes, it supports SSO" because it found a half-built file repeats the
fake-claims problem, faster.

What would make it ours:

- It answers from the checked plan first, and attaches the status: Cleared,
  Holding, Grounded, or "not verified, I only read the code".
- It says what isn't built, and when it doesn't know.
- Feedback from sales or CS becomes a proposed change to the plan, which a human
  approves. It never edits the code or the plan directly.
- Plan mode's output is a proposed slice written to the plan through a pull
  request, not a code change.

Why not now: nobody is blocked on it yet (no marketing, sales or CS team); it
depends on the check being trustworthy; and read access to source for
non-engineers brings permissions, hosting and spend we haven't scoped (the
roadmap already flags unbounded scan spend).

The cheap early version is for the two of us: ask "what changed since Tuesday?"
or "does this branch match the plan?" over the plan file, inside Cursor or
Claude Code, with no new hosted agent. If we reach for that daily, it is the
seed of the bigger version.

## What waits

Until the two-person loop is proven:

- Gap, security and readiness reporting as a front-page feature.
- Production Packs ([PRODUCTION_PACK_SPEC.md](../../PRODUCTION_PACK_SPEC.md)).
- Most marketing pages. Keep the landing page, pricing and a demo; each extra
  page is another place for a claim to be wrong.
- The wider team layer ([team-collaboration.md](team-collaboration.md)); already
  parked on the roadmap.

## Design notes from the review

These come from a read of the client code. They are directions, not yet changes,
and none has been built. Do them as one pass, not screen by screen.

- **Verdict first.** Each screen leads with the one thing the person needs to
  know, not a title and a list. On the personas screen, that is the weakest
  persona as a headline ("Admins can't finish setup yet"), not a note at the
  bottom.
- **One project page, one story.** The project page is already four tabs (Spec,
  Build, Shipped, Settings). They mirror the data model, not a person's
  question. Aim for one scrolling page: what it's for, what's true, what to fix
  or build next, with history and settings tucked away.
- **One status per thing.** A status word with its icon (Cleared, Holding,
  Grounded) replaces bare percentages, progress bars and emoji.
- **One primary action per view, in beacon.** `bg-night` is used as the primary
  button across six section files, so nothing reads as primary. It is reserved
  for the verdict panel. Everything else is a quiet button.
- **Readable text.** Over 100 uses of `text-xs` and 10 to 11px labels, below the
  13px `small` floor. If a label needs 10px to fit, cut the label.
- **No emoji, no internal jargon.** Persona emoji (including fallbacks) are
  removed. Words describe what someone would notice in the app, not how the
  system works ("Redo from your code", not "Re-run Claude extraction").
- **Quiet controls.** Confirm and remove appear on hover or expand, not on every
  card.
- **Say it when it's done.** When everything is Cleared, the screen says so
  plainly and shows little else. Empty states invite; they don't apologise.

Where "Fix this" should lead (for example, the gaps list filtered to that
persona) is a behaviour question to settle before building, per the client
design rules.

## Beta plan

Goal: put the two-person loop (shared plan, in-flight view, the check) in front
of the founder, a friend, then 10 to 20 builders. Hosting already exists
(Railway, a Dockerfile, a `/health` check, Supabase Postgres, 28 migrations), so
this is mostly cutting and fixing, plus one new piece of storage.

Scope below is estimated from the roadmap, not checked against the code.

### 1. Simplify first

- Delete the unrouted files already listed on the roadmap: `pages/BuildStory.tsx`,
  `pages/Analytics.tsx`, `pages/v2/StyleGuide.tsx`, `components/v2/ProjectCard.tsx`.
- Take one-click deploy (`routes/deploy.js`, `routes/railway.js`) out of the beta
  path. No screen calls it and the site no longer advertises it.
- Cut the marketing site to the landing page, pricing and a demo. Hide features,
  how it works, the gaps pages and the use-case pages.
- Hide Production Packs (`app/server/packs`, `app/server/services/packs`) behind
  a flag.
- Apply the design notes above to the four project tabs in one pass.

### 2. Close the beta blockers

All already on the roadmap's Stage 1 and Stage 2 lists.

- Bound scan spend: a per-user cap and a daily ceiling; today the only limit is
  in memory.
- Scans survive a deploy: a sweep that fails stale scans stuck in `analyzing`.
- Set `trust proxy`, so the IP rate limit keys on the visitor and not Railway.
- Dependabot: 256 vulnerabilities on `main`, 8 critical (as of 2026-11-01).
- Private repos through the GitHub App ([PR #28](https://github.com/samyaks/CodeGuru/pull/28)).
- Hide the feedback toolbar from regular visitors, and dollar and token costs
  from people who aren't paying.
- Decide the name (Jibe or Takeoff) before registering anything public.

### 3. Add storage for plan and history

New migration (029) in the existing Postgres. No new service.

- **Plan versions** per project and branch: the plan text, who or which agent
  changed it, when. The repo file stays the source of truth; this is a cached,
  queryable copy.
- **Claim statuses over time:** each claim with Cleared, Holding or Grounded, its
  evidence, and the commit it was checked against.
- **Change summaries:** one plain sentence per pull request or branch, with a
  link to its preview.
- **Reviewer confirmations:** who confirmed a claim on a preview, and when.

Do not store full source code. The site no longer claims we don't keep it, and
we should keep that line true.

### 4. Deploy

- Gate signup with the waitlist and invite list that already exist.
- Run migrations on deploy (the runner already supports it).
- Invite the two of us, then 10 to 20 builders, and watch each first session, as
  the roadmap's external test says.

### If time runs short

Cut from sections 1 and 4 before touching the blockers in section 2. The
minimum shippable beta is the shared plan, the in-flight view and the check,
made safe by the blockers.

## Housekeeping this implies

- **One name.** Jibe was chosen on 2026-10-23. Rename once, across product,
  GitHub App and design system, before more strings spread.
- **One look.** The landing page uses raw amber and stone colours while the app
  uses tokens. Move it onto the tokens, and add a lint check that fails the build
  on raw colours and on `bg-night` outside the verdict panel, so the rules stop
  depending on memory.

## How we'll know

Run it on the new project for two weeks, then answer:

1. Did either of us open it without being reminded?
2. Did it catch overlapping work or a contradiction before it hurt?
3. How often did the plan go stale, and did the check notice?

If the answers are no, the problem is not the design. Stop and find the real
blocker before building more.

## Open questions

- Where do we feel the Limitation of existing options? Pin it to a specific
  moment from the new project.
- Does the plan file need to be one file, or one per area? Start with one.
- How do two people's agents write to the plan without conflicting? Start with
  pull requests and a human approving.
- Can the funnel tell us what the five other accounts did? Worth a look before
  anyone is called.
