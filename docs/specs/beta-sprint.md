# Beta sprint

Draft, 2026-11-13. Companion to [product-direction.md](product-direction.md).

**Goal:** by the end of the sprint, 8 to 10 invited builders can use the product
on their own repos without it costing us money, losing their work, or breaking on
the main path, and we can see what they do.

**Length:** two weeks, Monday 2026-11-16 to Friday 2026-11-27. This is an
assumption. Sizes are T-shirt guesses (S under a day, M one to two days, L three
or more), not measured estimates. Adjust to who is working and when.

## Checked against the code on 2026-11-13

These were open on the roadmap and are confirmed still open:

- `trust proxy` is not set in `app/server/app.js`.
- No sweep fails scans stranded in `analyzing`.
- Scan spend has only a per-project soft ceiling (`lib/cost-budget.js`); no
  per-user cap and no global daily ceiling.
- No payments detector exists in `services/capability-detectors`.
- Error tracking is not installed (no Sentry in either `package.json`).
- Open PRs: #28 (GitHub App, draft), #29 (Jibe rename), and four Dependabot PRs
  (#13, #14, #23, #24), the older ones likely superseded by #24.

Not checked: how well a scan reads a stranger's repo, or any flow end to end.

## Decide first (day 1)

| Decision | Why it blocks |
|---|---|
| **Name and domain** (Jibe or Takeoff) | The GitHub App's name shows on GitHub's install screen; #29 is parked on it. |
| **Lead for the beta:** launch readiness, or staying in sync | Fills the one lead-feature slot below. Decide with the PULL tables in the direction doc. |
| **Who works on what** | Two people share a repo and each has agents. Split by area, not by file, to avoid conflicts. |

## Must have

### Safe to invite (week 1)

| # | Item | Size | Done when |
|---|---|---|---|
| 1 | Set `trust proxy` | S | Rate limit keys on the visitor's IP behind Railway; `/api/waitlist` and `/api/events` limits behave. |
| 2 | Bound scan spend | M | Per-user scan cap, a global daily ceiling, and a rule for signed-out scans. Ownerless projects are no longer editable or deletable by any signed-in user (`checkProjectAccess`). |
| 3 | Sweep stale scans | S | A scan stranded by a restart moves to `failed` and the Read shows the existing retry. |
| 4 | Dependabot | M | #24 merged or closed with reason; #13, #14, #23 closed as superseded; re-check the vulnerability count on `main` (256, 8 critical on 2026-11-01). |
| 5 | Install error tracking | S | An uncaught server and client error reaches us with the project and route. |
| 6 | Hide the feedback toolbar from regular visitors; hide dollar and token costs from non-paying users | S | A signed-out visitor sees neither. Checked on a phone width. |
| 7 | Walk the flows nobody has: sign-in, repo picker, live scan progress, folder upload | M | Each walked on a clean account; a written list of what broke. |

### Simplify (weeks 1 to 2)

| # | Item | Size | Done when |
|---|---|---|---|
| 8 | Delete unrouted files and cut surface | M | `pages/BuildStory.tsx`, `pages/Analytics.tsx`, `pages/v2/StyleGuide.tsx`, `components/v2/ProjectCard.tsx` removed; one-click deploy routes off the beta path; marketing reduced to landing, pricing and demo; packs behind a flag. Type check and client build pass. |
| 9 | Project page design pass | L | Verdict first, one beacon action, no emoji, 13px minimum text, plain words, on the four tabs. Checked in light and dark and at 400px. |

### Storage (week 2)

| # | Item | Size | Done when |
|---|---|---|---|
| 10 | Design the tables | S | Plan versions per project and branch, claim statuses over time, change summaries, reviewer confirmations. No full source code stored. |
| 11 | Migration 029 and the writes | M | Idempotent migration applied locally and in prod; a scan writes a plan version and claim statuses; reads come back in the Read. |

### Private repos (weeks 1 to 2)

| # | Item | Size | Done when |
|---|---|---|---|
| 12 | Finish the GitHub App ([#28](https://github.com/samyaks/CodeGuru/pull/28)) | L | Conflicts resolved; app registered under the chosen name; env vars set; migrations 025 and 026 run; install, private scan, re-analyze and Shipped tested signed in; uninstall and suspension handled. |

**Fallback if it slips:** invite only people with public repos or folder uploads,
and say so.

### Lead feature (pick one after the day-1 decision)

| Lead | Items | Size |
|---|---|---|
| **Launch readiness** | Payments detector (checkout, webhooks, subscription state); intake v1 (propose from the code, ask where it is silent, five questions at most); relevance marking on each finding | M + M + S |
| **Staying in sync** | In-flight view (branches and pull requests, one plain sentence each); a plan file both agents read; the check that flags a contradiction | L + M + M |

Do not start both. Intake's "marked relevant" signal is the main number in the
test either way.

### Ready to invite (end of week 2)

| # | Item | Size | Done when |
|---|---|---|---|
| 13 | Gate signup on the waitlist and an invite list | S | A stranger cannot start a scan; an invited account can. |
| 14 | Run migrations and deploy | S | Migrations through 029 applied in prod; `/health` green; a real scan completes on the deployed build. |
| 15 | Test plan and kill criteria | S | Recruit list of 8 to 10; script for watching a first session; the funnel (`npm run report:funnel --prefix app`) shows each; the pass and fail lines written before the first invite. |

## Stretch (only if must-haves are done)

- Apply a pack as a pull request (pack library exists; nothing calls it).
- Next.js apps get "No global error handler" (`ruleNoErrorHandler`).
- Read margin notes show only the basename for file chips.
- Read pages get a title that names the repo.
- "Live demo" points at a real public Read.
- Settings shows raw values like `fullstack` and `ready`.

## Order

1. **Day 1:** decisions above. Start items 1, 3, 5 (small, no dependencies).
2. **Week 1:** items 2, 4, 6, 7, 8. Start 12 as soon as the name is set.
3. **Week 2:** items 9, 10 to 11, the lead feature, 12 to done. Items 13 to 15 in the last two days.

Items 10 to 11 depend on the lead choice only if it changes what gets stored;
if unsure, store plan versions and claim statuses first, which both leads need.

## Risks

- **Private repos (12) is the likeliest to slip.** It touches GitHub, new
  migrations and a name decision. The fallback is in the table.
- **Spend cap (2) done late** means invited testers can run up cost. Do it
  before anyone is invited, even by hand.
- **Walking the flows (7) may find more than the sprint can fix.** Triage by the
  roadmap's bar: does it lose data, cost money, or leave someone stuck.
- **Two people, one repo.** Keep to separate areas and merge small, often.

## Exit: ready for the beta

- Every Must have row is done, or its fallback is chosen and stated.
- A real scan, start to finish, on the deployed build, by someone who is not us.
- Errors and the funnel are visible.
- The kill criteria are written down.

Then invite, watch each first session, and write down what broke. That is the
roadmap's external test.
