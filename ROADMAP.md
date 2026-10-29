# Roadmap

Source of truth for what we are building and in what order.

- One line per item. Detail lives in the linked PR or a spec under `docs/specs/`.
- **Now** holds at most three items, each with a "done when".
- Update this file in the same commit as the work it describes.

> **Draft, 2026-10-11.** Now and Shipped are facts from the repo. The launch
> stages and their order are a proposal until the open decisions below are settled.

## Now

- [ ] **Model picker + cost estimate before a scan** — [PR #30](https://github.com/samyaks/CodeGuru/pull/30); tests 227/227, typecheck clean. The Read now uses the picked model too. Opus is signed-in only (2026-10-28): the server rejects it with 401 for signed-out scans, the picker shows it locked, and push re-analyses of ownerless projects drop back to the default.
      Done when: the work is merged.
      A per-step model comparison was shelved on 2026-10-23: the wrong output in stored scans came from detection code, not the model.
- [ ] **Shipped tab: recent commits with summaries** — commit `0e85558`, in [PR #30](https://github.com/samyaks/CodeGuru/pull/30).
      Done when: merged to `main`.
- [ ] **Private repos through a GitHub App** — [PR #28](https://github.com/samyaks/CodeGuru/pull/28), draft.
      Done when: app registered, env vars set, migration 025 run, and install → private scan → re-analyze → Shipped tested signed in.

## Stage 1 — Safe to invite people

Ordered. Nothing here is a new feature; each is a way launch goes wrong today.

1. [ ] **Bound scan spend.** Anyone can start a scan signed out, and the only limit is 10 requests a minute per IP, held in memory. Needs: a per-user scan cap, a global daily spend ceiling, and a rule for signed-out scans. Ownerless projects are also editable and deletable by any signed-in user (`checkProjectAccess` returns early when there is no owner).
1. [ ] **Scans must survive a deploy.** A scan runs inside the web process, so a restart strands it in `analyzing` with no retry (`analyzing` is not a re-analyzable status). 32 projects are stuck this way from April–May; none since. Needs: a sweep that fails stale scans, and a retry button.
2. [ ] **Set `trust proxy`.** It is unset in `app/server/app.js`, so behind Railway the IP rate limit likely keys on the proxy, not the visitor.
3. [ ] **Save waitlist emails on the server.** `Pricing.tsx` writes them to the visitor's `localStorage`; they never reach us.
4. [ ] **Error tracking and a funnel on our own app.** Nothing is installed. Minimum funnel: landing → scan started → scan finished → Read opened → signed in → came back.
5. [ ] **Decide the name and domain, then apply it to user-facing strings.** Do this before registering the GitHub App, since its name shows on GitHub's install screen.
6. [ ] **Make the site's claims true.** The FAQ says we read "~30 key files" and "do not persist full source code"; we read up to 150 and store their contents in `analysis_files`. Pricing promises "Unlimited public repo analysis" and "Private repos via GitHub OAuth". The landing page advertises One-Click Deploy, which no screen offers.
7. [ ] **GitHub App: handle uninstall and suspension.** Today a revoked install makes scans fail with an error.
8. [ ] **Merge or close Dependabot PRs #23 and #24**, open since May.

## Stage 2 — Soft launch

**Bar (set 2026-10-11): no major issues, and the small but impactful UX kinks are fixed.**
"Major issue" means a first-time visitor can hit it on the main path — landing →
scan → Read → tabs — and it loses data, costs us money, or leaves them stuck.

- [ ] Every Stage 1 item is closed.
- [ ] UX kinks below are fixed.
- [ ] Invite 10–20 builders by hand and watch each first session.

### UX kinks

From a signed-out walkthrough on 2026-10-11 (landing, scan confirm, demo, and
every tab of a Read, at desktop and phone widths), plus a check of stored scans
of CodeGuru and client-desk on 2026-10-23. Ordered by impact. Not yet walked:
sign-in, repo picker, dashboard, live scan progress, folder upload.

1. [x] **Stack and capability detection read only the root `package.json`.** Monorepos and apps kept in a subfolder came back with no framework, database or auth. That produced false gaps ("Add user authentication" on client-desk, which uses Clerk) and a wrong "next thing" in the Read ("there's no sign-in at all"). Fixed, uncommitted: every `package.json` is read via `lib/package-manifests.js`, and a hand-written rate limiter now counts. Still root-only: the security detectors (`missing-helmet`, `csrf-on-state-changing-routes`, `dependency-vulnerabilities`) and `build-detector.js`.
2. [ ] **Feedback toolbar shows to every visitor.** "Feedback Round 1 · 0 pins · Share Session · New Round" sits above every page, wraps badly on phones, and appends `#tf=…` to every URL. Gate it to invited testers or replace it with a plain "Send feedback".
3. [x] **Express findings on apps that are not Express.** `suggestion-rules.js:192` and `:224` treated any Node runtime as Express, so every Next.js repo got "No helmet" and "No rate limiting on your Express app". Fixed, uncommitted.
4. [ ] **Next.js apps get "No global error handler".** `ruleNoErrorHandler` in `suggestion-rules.js` runs on any Node app but only recognises Express error middleware.
5. [ ] **Read margin notes repeat themselves.** Repeated sentences and the double "We're guessing." are fixed, uncommitted. Still open: file chips show only the basename, so a Next.js app reads "page.tsx page.tsx page.tsx".
6. [x] **Duplicate gaps.** `gap-mapper.js:347` made one card per job for the same target; the sample showed "Finish DELETE /api/posts/[postId]" three times in 15 gaps. Now one card per target lists every job. Fixed, uncommitted.
7. [ ] **"Unlock with Pro" is a stub.** Any signed-in user unlocks for free, and pricing says everything is free. Relabel it as sign-in for the beta.
8. [ ] **The scan confirm step shows dollar costs and token counts** to people who are not paying, and asks them to choose a model.
9. [ ] **Signed-out visitors on a Read see owner controls** — Accept/Reject, Confirm, Delete project, "Takeoff listens to push events" — and no prompt to scan their own repo.
10. [ ] **"Live demo" is a static mock of the older report.** Point it at a real public Read.
11. [ ] **Read pages have a generic tab title**, so shared links do not name the repo.
12. [ ] Small copy: Context tab's heading does not match its label, Shipped prints a commit title twice, "saves your tokens", raw values like `fullstack` and `ready` in Settings, and the unverified "under 2 minutes" claim.

## Stage 3 — Public launch

- [ ] **MCP server for the living spec.** Tool logic and tests exist in `app/server/services/intent/mcp-tools.js`; it needs a transport, a per-project key, and setup docs for Cursor and Claude Code.
- [ ] **A public sample Read** linked from the landing page, so visitors see the output before scanning.
- [ ] **Launch assets:** short demo video, launch post, refreshed `/demo`.
- [ ] **Channels:** Show HN, Product Hunt, X, Cursor and Claude Code communities.

## Later

- Billing (Stripe) and a Pro tier: team workspace, priority queue, custom context templates.
- One-click deploy in the UI. Server routes and client API calls exist; no screen calls them.
- Export `.context.md` files to the repo as a pull request (needs write permission on the GitHub App).
- Move push webhooks from per-repo hooks onto the GitHub App.
- Settings view of repos granted to the GitHub App (`GET /api/github-app/repos` exists).
- Promote `components/v2` and `pages/v2` to canonical paths (old followup #10).
- Cursor extension for BuildStory capture, untouched since April.

### From a user session, 2026-10-25

Not triaged or ordered yet. Some may belong in Stage 2's UX kinks.

- Map tab: a persona's job titles are cut off (`truncate` at `MapSection.tsx:681`). Show the full title.
- Reorganize navigation. Tabs today: Read, Gaps, Map, Context, Shipped, Settings (`ReadPage.tsx:30`).
- Replace "Confirm" on a job with "Challenge". Confirming a job also generates its invariants (`confirmJob` in `product-map.js`), so that needs a new trigger.
- Adding a persona does not look for its jobs: `addPersona` in `product-map.js` only inserts the row.
- Merge the Map and Context tabs.
- Write a standard for how engineering and product stay in sync, and build the app around it. Needs a spec under `docs/specs/` first.

## Open decisions

- **Public launch date and shape.** Show HN / Product Hunt day, or a slower rollout? (Soft-launch bar is settled; see Stage 2.)
- **Name.** Jibe was chosen 2026-09-29 and reopened 2026-10-06. Code and site still say Takeoff.
- **Free tier.** Must people sign in to scan? How many scans are free? Who gets Opus? (Not signed-out users, as of 2026-10-28.)
- **MCP timing.** Before the public launch as the headline, or after as the first follow-up?

## Shipped

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
`CONTEXT.md`, and `docs/v2-reference/followups.md` (items 1–9 and 11 are done,
10 is under Later, 12 looks done but is unverified, 13 is the name decision).
