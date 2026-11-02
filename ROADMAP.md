# Roadmap

Source of truth for what we are building and in what order.

- One line per item. Detail lives in the linked PR or a spec under `docs/specs/`.
- **Now** holds at most three items, each with a "done when".
- Update this file in the same commit as the work it describes.

> **Updated 2026-11-01.** Now and Shipped are facts from the repo. The plan is
> the one agreed on 2026-11-01: ship to outsiders and verify before building the
> team layer. First drafted 2026-10-11 on `cursor/analysis-file-ticker`; landed on
> `main` with the trust pass.

## Now

- [ ] **Trust pass** — this PR. Site claims match the product (no Readiness Score, One-Click Deploy, "~30 files", "private repos via OAuth" or "under two minutes"; fabricated testimonials removed). Waitlist writes to a `waitlist` table instead of `localStorage`. First-party funnel events (`funnel_events`) and `npm run report:funnel` for funnel, scan timings and Claude spend. Failed scans show a failed state with retry instead of "still drafting".
      Done when: merged, migration 027 run in prod, and `report:funnel` shows real visitors.
- [ ] **Minimal intent loop (weeks 2–4).** The Build tab's "next thing" becomes a real slice — `current_micro_slice`, `guardrails[]`, `acceptance_criteria[]` — written to `.intent/active.json` on the working branch via PR, with the builder prompt derived from it. On push, re-read the affected files and mark the slice verified or not. Spec: `docs/specs/intent-driven-building.md` (to be written from the IDB Lean V1 draft).
      Done when: one outside builder completes a slice end to end — copy prompt → build → push → verified — without help.
- [ ] **External test (week 5).** Five to eight vibe coders, each on their own repo, watched live.
      Done when: every session is recorded against the funnel and we have a written list of what broke.

## Stage 1 — Safe to invite people

Ordered. Nothing here is a new feature; each is a way launch goes wrong today.

1. [ ] **Bound scan spend.** Anyone can start a scan signed out, and the only limit is 10 requests a minute per IP, held in memory. Needs: a per-user scan cap, a global daily spend ceiling, and a rule for signed-out scans. Ownerless projects are also editable and deletable by any signed-in user (`checkProjectAccess` returns early when there is no owner). Spend is already tracked per call in `analysis_llm_calls` (avg $0.28/scan, max $2.18 as of 2026-11-01).
2. [ ] **Scans must survive a deploy.** A scan runs inside the web process, so a restart strands it in `analyzing` with no retry. Needs: a sweep that fails stale scans. (The Read now shows a retry for `failed` scans, 2026-11-01.)
3. [ ] **Set `trust proxy`.** Unset in `app/server/app.js`, so behind Railway the IP rate limit likely keys on the proxy, not the visitor. Also affects the new `/api/waitlist` and `/api/events` limits.
4. [x] **Save waitlist emails on the server.** 2026-11-01, `waitlist` table + `POST /api/waitlist`.
5. [x] **A funnel on our own app.** 2026-11-01: landing → scan started → scan finished → Spec opened → Build opened → prompt loaded → prompt copied → sign-in clicked, plus waitlist joined. Read it with `npm run report:funnel --prefix app`. Error tracking is still not installed.
6. [ ] **Decide the name and domain, then apply it to user-facing strings.** Do this before registering the GitHub App, since its name shows on GitHub's install screen. [PR #29](https://github.com/samyaks/CodeGuru/pull/29) (Jibe) is parked and conflicting.
7. [x] **Make the site's claims true.** 2026-11-01. Still to verify: "do not persist full source code" was dropped; the FAQ now says we keep what we need between scans.
8. [ ] **Private repos through a GitHub App** — [PR #28](https://github.com/samyaks/CodeGuru/pull/28), draft. Done when: app registered, env vars set, migrations 025/026 run, and install → private scan → re-analyze → Shipped tested signed in. Also handle uninstall and suspension (a revoked install makes scans fail with an error today).
9. [ ] **Merge or close Dependabot PR #24**, open since May. GitHub reports 256 vulnerabilities on `main` (8 critical) as of 2026-11-01.

## Stage 2 — Soft launch

**Bar (set 2026-10-11): no major issues, and the small but impactful UX kinks are fixed.**
"Major issue" means a first-time visitor can hit it on the main path — landing →
scan → Read → tabs — and it loses data, costs us money, or leaves them stuck.

- [ ] Every Stage 1 item is closed.
- [ ] UX kinks below are fixed.
- [ ] Invite 10–20 builders by hand and watch each first session (this is the "external test" in Now).

### UX kinks

From a signed-out walkthrough on 2026-10-11, a check of stored scans on
2026-10-23, and the shell work on 2026-11-01. Ordered by impact. Not yet walked:
sign-in, repo picker, live scan progress, folder upload.

1. [x] **Stack and capability detection read only the root `package.json`.** Fixed: every `package.json` is read via `lib/package-manifests.js`. Still root-only: the security detectors (`missing-helmet`, `csrf-on-state-changing-routes`, `dependency-vulnerabilities`) and `build-detector.js`.
2. [ ] **Feedback toolbar shows to every visitor.** "Feedback Round 1 · 0 pins · Share Session · New Round" sits above every page, wraps badly on phones, and appends `#tf=…` to every URL (tab hashes still win, verified 2026-11-01). Gate it to invited testers or replace it with a plain "Send feedback".
3. [x] **Express findings on apps that are not Express.** Fixed in `suggestion-rules.js`.
4. [ ] **Next.js apps get "No global error handler".** `ruleNoErrorHandler` in `suggestion-rules.js` runs on any Node app but only recognises Express error middleware.
5. [ ] **Read margin notes:** file chips show only the basename, so a Next.js app reads "page.tsx page.tsx page.tsx".
6. [x] **Duplicate gaps.** One card per target now lists every job.
7. [x] **"Unlock with Pro" is a stub.** 2026-11-01, [#35](https://github.com/samyaks/CodeGuru/pull/35): the prompt is gated on sign-in only. The server comments in `routes/v2/read.js` still say "Pro stub".
8. [ ] **The scan confirm step shows dollar costs and token counts** to people who are not paying. (The model picker in [PR #30](https://github.com/samyaks/CodeGuru/pull/30) was closed, not merged.)
9. [x] **Signed-out visitors on a Read see owner controls.** 2026-11-01, [#35](https://github.com/samyaks/CodeGuru/pull/35): read-only visitor state with a "scan your own repo / sign in" line.
10. [ ] **"Live demo" is a static mock of the older report.** The Readiness number was removed 2026-11-01; still point it at a real public Read.
11. [ ] **Read pages have a generic tab title**, so shared links do not name the repo.
12. [ ] Small copy: raw values like `fullstack` and `ready` in Settings; Shipped prints a commit title twice. (Context heading, "saves your tokens" and "under 2 minutes" fixed 2026-11-01.)
13. [ ] **Empty states not yet seen live:** a ready project with zero personas or zero guarantees (copy updated 2026-11-01, not viewed with real data), and a fresh project in the first minutes after the scan.

## Stage 3 — Public launch

- [ ] **MCP server for the living spec.** Tool logic and tests exist in `app/server/services/intent/mcp-tools.js`; it needs a transport, a per-project key, and setup docs for Cursor and Claude Code.
- [ ] **A public sample Read** linked from the landing page, so visitors see the output before scanning.
- [ ] **Launch assets:** short demo video, launch post, refreshed `/demo`.
- [ ] **Channels:** Show HN, Product Hunt, X, Cursor and Claude Code communities.

## Later

- **Team layer** — workspaces, roles, per-member MCP keys, PR check, spec into `AGENTS.md`, Slack. Draft spec: [team-collaboration.md](docs/specs/team-collaboration.md), [PR #32](https://github.com/samyaks/CodeGuru/pull/32). Parked until the solo loop is verified with outsiders (decision 2026-11-01).
- Billing (Stripe) and a Pro tier: team workspace, priority queue, custom context templates.
- One-click deploy in the UI. Server routes and client API calls exist; no screen calls them, and the site no longer advertises it.
- Export `.context.md` files to the repo as a pull request (needs write permission on the GitHub App).
- Move push webhooks from per-repo hooks onto the GitHub App.
- Settings view of repos granted to the GitHub App (`GET /api/github-app/repos` exists).
- Promote `components/v2` and `pages/v2` to canonical paths; delete the unrouted `pages/BuildStory.tsx`, `pages/Analytics.tsx`, `pages/v2/StyleGuide.tsx`, `components/v2/ProjectCard.tsx`.
- Map tab: a persona's job titles are cut off (`truncate` in `MapSection.tsx`). Show the full title.
- Replace "Confirm" on a job with "Challenge". Confirming a job also generates its invariants (`confirmJob` in `product-map.js`), so that needs a new trigger.
- Adding a persona does not look for its jobs: `addPersona` in `product-map.js` only inserts the row.
- Cursor extension for BuildStory capture, untouched since April.

## Open decisions

- **Public launch date and shape.** Show HN / Product Hunt day, or a slower rollout? (Soft-launch bar is settled; see Stage 2.)
- **Name.** Jibe was chosen 2026-09-29 and reopened 2026-10-06. Code and site still say Takeoff; user-facing strings stay as they are until decided (2026-11-01).
- **Free tier.** Must people sign in to scan? How many scans are free? Who gets Opus?
- **MCP timing.** Before the public launch as the headline, or after as the first follow-up?
- **Solo builders or teams?** Settled for now (2026-11-01): solo loop first, verified with outsiders; the team layer waits.

## Shipped

- 2026-11-01 Four-tab project shell (Spec / Build / Shipped / Settings), Pro gate replaced by sign-in, read-only visitor state, legacy routes hidden (#35)
- 2026-11-01 Takeoff design system and new dashboard (#31); Shipped tab shows recent commits with summaries (#33)
- 2026-09-10 Dashboard cards show persona summary, gaps and last commit; gap findings grounded in evidence (#27)
- 2026-08-25 Files being read are shown during first analysis (#26)
- 2026-08-25 First-scan cost tracking, caps and a $1 soft ceiling (#25)
- 2026-08-08 The Read: living-spec page with claim corrections, now the project shell
- 2026-07 Intent layer: capture, review, jobs-to-be-done features, invariants, MCP tool logic
- 2026-06-06 Marketing pages: features, demo, how it works, pricing, gap guides
- 2026-05 v2 workspace, security report with share links, auto re-analyze on push

## Superseded docs

Kept for history; this file wins where they disagree: `TAKEOFF_PLAN.md`,
`TAKEOFF_NEXT_PHASE_SPEC.md`, `SUGGESTIONS_ENGINE_SPEC.md`, the build order in
`CONTEXT.md`, and `docs/v2-reference/followups.md`.
