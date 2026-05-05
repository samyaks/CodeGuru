# Cursor Agent Instructions: Takeoff v2 Migration

## How to use this document

This document contains instructions for migrating the Takeoff app from its current sprawled architecture to the v2 design (Gaps/Map/Context/Shipped). It uses the **strangler fig pattern**: build v2 alongside v1, migrate one slice at a time, swap routes at the end, delete v1 last.

**For each Cursor session:**
1. Pick a phase below (do them in order — each depends on the previous)
2. Copy the entire phase prompt into Cursor as a single instruction
3. Let the agent work, review the diff, commit
4. Move to the next phase in a new session

**Do not try to do multiple phases in one session.** Each phase is scoped to fit within a single Cursor agent context window without degrading.

**After every phase:** commit with the message format `feat(v2): phase N - <description>` so we can revert cleanly if needed.

---

## ⚠️ START HERE: Phase -1 (Reference Setup)

**Before running any phase**, put the v2 prototype reference file in your repo so the Cursor agent can read it.

**Manual one-time setup:**

1. Take the file `takeoff-prototype.jsx` (the React prototype generated alongside this document)
2. Save it to: `docs/v2-reference/takeoff-prototype.jsx` in your Takeoff repo
3. Save this instruction document to: `docs/v2-reference/cursor-migration-instructions.md`
4. Commit both: `chore: add v2 reference materials`

**Why this matters:** Multiple phases below tell the Cursor agent to "read the prototype at this path." If the file isn't there, the agent will hallucinate styles or skip details. With the file present, every phase has a concrete visual spec to match against.

---

## Project rules (apply to every phase)

Add these to your `.cursorrules` file or paste at the top of every phase prompt:

```
PROJECT: Takeoff v2 migration
PATTERN: Strangler fig — v2 lives alongside v1 until cutover

REFERENCE FILE:
The v2 visual + interaction spec lives at: docs/v2-reference/takeoff-prototype.jsx
READ THIS FILE before designing or building any v2 component. It is the source of truth
for styling, layout, interaction patterns, copy, and component structure. When in doubt,
match the prototype exactly. Do not invent new patterns.

GROUND RULES:
1. Never delete v1 code during phases 0-5. Only Phase 6 deletes.
2. v2 code lives at /v2/ routes and in components/v2/ directory.
3. Use feature flag USE_V2 from src/config/flags.ts. Default false until Phase 6.
4. Reuse existing analyzer/scoring/scanner backend logic. Do not rewrite it.
5. After every change, run the existing test suite. Do not break it.
6. Ask before deleting any file. Ask before changing any backend route signature.
7. If a file path doesn't exist, search for it before assuming it's missing.
8. Commit format: `feat(v2): phase N - <short description>`
```

---

# PHASE 0: Codebase Cleanup

**Goal:** Stop the analyzer from measuring zombie code. No UI changes.

**Why first:** Every redesign decision is informed by the analyzer's output. If the analyzer scans archived/abandoned code, it lies about what your app is. Fix this before designing around fictional data.

**Estimated time:** 3-4 hours
**Risk:** Low (no user-facing changes)

## Cursor prompt for Phase 0

```
You are working on the Takeoff codebase. Your job in this session is Phase 0: codebase cleanup. No UI changes. Do not redesign anything.

REFERENCE: This phase has no visual component. You don't need to read the prototype yet.
You will read it in Phase 1.

CONTEXT:
The Takeoff repo has accumulated archived/legacy directories that are still being scanned
by the analyzer. This makes the production-readiness score and module detection lie.
Before any v2 redesign work, we need to remove this noise.

DIRECTORIES TO ARCHIVE OR REMOVE:
First, search the repo to confirm these exist before acting on them:
- _archived/code-reviewer/
- _archived/codebase-analyzer/
- _archived/fastapi-project/
- code-visualizer-mvp/workspace-app/
- code-visualizer-mvp/workspace-prototype/
- code-visualizer-mvp/knowledge-graph-extension/

For each directory:
1. Confirm it's not imported anywhere in the live app (grep for the path)
2. If imports exist, STOP and report them — do not proceed
3. If no imports, move the directory to a new top-level folder called `archive/`
   (don't delete — just move out of scanning scope)
4. Update .gitignore patterns to exclude archive/ from any analysis tooling
   but keep the files tracked in git

SCANNER UPDATES:
Find the file scanner used by the analyzer (likely in app/server/scanners/ or similar —
search for files that read directory trees or do glob matching). Update it to:
1. Add an explicit ignore list including: archive, _archived, legacy, node_modules,
   .next, dist, build
2. Add an option for users to extend this list via a .takeoffignore file
3. Make sure the ignore happens BEFORE file reading, not after — we don't want to read
   200 files just to discard them

DATA MODEL ADDITIONS (prep for Phase 3):
Find the Suggestions data model. Add three new fields (don't use them yet, just add the
schema):
- category: enum('broken', 'missing_functionality', 'missing_infrastructure')
- status: enum('untriaged', 'in_progress', 'shipped', 'rejected')
- verification: enum('pending', 'verified', 'partial', null)

Default category to 'broken' for existing suggestions, status to 'untriaged'. Run a
migration if there's a database.

VERIFICATION:
After your changes:
1. Run a fresh analysis on the Takeoff repo itself
2. Module count should drop from ~24 to ~8
3. Production readiness score should change (likely improve, possibly drop if it was
   inflated by counting archived code as "complete")
4. Report the before/after numbers

DO NOT:
- Touch any UI code
- Change any backend route signatures
- Delete files (move only)
- Modify the analyzer's scoring logic itself

DELIVERABLE:
- A commit with message: "feat(v2): phase 0 - cleanup archived code and add v2 schema fields"
- A summary of: directories moved, scanner changes, schema additions,
  before/after analysis numbers
```

---

# PHASE 1: Design System Primitives

**Goal:** Extract reusable components from the v2 prototype. No real pages yet.

**Why second:** You can't apply a style you haven't extracted. Build the parts once, use them everywhere.

**Estimated time:** 4-5 hours
**Risk:** Low (additive, not replacing anything)

## Cursor prompt for Phase 1

```
You are working on the Takeoff codebase. Your job in this session is Phase 1: build the
v2 design system primitives. Do not modify any existing pages.

REFERENCE — READ FIRST:
Open and read: docs/v2-reference/takeoff-prototype.jsx
This is a single-file React prototype showing the entire v2 experience. Every component
you build in this phase should match its visual style and interaction patterns exactly.

KEY THINGS TO EXTRACT FROM THE PROTOTYPE:
1. Color palette — search for "stone-" classes throughout
2. Font stack — see the `sansFont` and `serifFont` constants near the top of the component
3. Border radius patterns — `rounded-lg` for cards, `rounded-md` for buttons
4. Spacing patterns — `p-5` for card padding, `gap-3` for stacks
5. The exact shape of GapCard (most complex component) — find the gap rendering logic
   inside the activeSection === 'gaps' block
6. The amber ring treatment for in-progress gaps — search for "ring-amber" or "amber-300"
7. Tab bar pattern with badges — search for "border-b-2" near the tab rendering

CONTEXT:
We're migrating Takeoff to a new visual style. Before redesigning pages, we need a small
library of reusable components matching the v2 prototype style. These will live in
components/v2/ and not affect any existing screens.

DESIGN TOKENS:
Create app/client/src/styles/v2-tokens.css (or .ts if the project uses CSS-in-JS) with:
- Color palette extracted from the prototype:
  - Backgrounds: stone-50 (page), stone-100 (subtle), white (cards)
  - Borders: stone-200 (default), stone-300 (hover/active)
  - Text: stone-900 (headings), stone-700 (body), stone-500 (muted), stone-400 (very muted)
  - Primary action: stone-900 bg / stone-50 text
  - Status accents:
    - Broken/danger: red-50 bg, red-200 border, red-600 text
    - Missing functionality/warning: amber-50 bg, amber-200 border, amber-700 text
    - Missing infrastructure/neutral-warn: stone-100 bg, stone-300 border, stone-700 text
    - Verified/success: emerald-50 bg, emerald-200 border, emerald-600 text
    - In-progress: amber-300 ring, amber-100 ring-offset
- Font stack:
  - Display/headings: ui-serif, Georgia, Cambria, serif
  - UI/body: ui-sans-serif, system-ui, -apple-system, sans-serif
- Spacing: stick to Tailwind defaults (4px base unit)
- Border radius: lg (8px) for cards, md (6px) for buttons, full for chips/badges

If the project uses Tailwind, prefer Tailwind utility classes over custom CSS.

COMPONENTS TO BUILD:
Create these in app/client/src/components/v2/. Each should be a focused, single-
responsibility component. For each, the prototype is your ground truth — match it.

1. Card — wrapper with white bg, stone-200 border, rounded-lg, p-5.
   Variants: default, hover (border-stone-300), active.

2. MetadataLabel — uppercase tracking-widest text-xs text-stone-500.
   Used for "Personas", "Stack", etc.
   In the prototype, search "uppercase tracking-widest" to see all uses.

3. Badge — small pill with icon + label.
   Props: variant (broken/missing/infra/verified/partial/pending/in-progress/rejected),
   icon, label.
   In the prototype, see categoryMeta and verificationMeta objects for variant styling.

4. TabBar — horizontal tab navigation with active underline.
   Props: tabs (id, label, icon, badge?, badgeColor?), activeId, onChange.
   In the prototype, see the activeSection tab rendering for exact pattern.

5. GapCard — the centerpiece. THIS IS THE MOST IMPORTANT COMPONENT.
   Renders a single gap with category badge, title, description, metadata row
   (effort, files, blocks personas), and action area.
   Props: gap, status, onAccept, onReject, onRefine, onMarkCommitted, onCopyPrompt.
   Status determines what action buttons render.
   The amber ring on in-progress is critical — don't skip it.
   In the prototype: visibleGaps.map(...) inside activeSection === 'gaps' has the
   complete reference implementation including all three states (untriaged,
   in-progress, rejected) and the refine flow.

6. ShippedItem — renders a verified-shipped commit.
   Props: item (commit, message, files, verification, deployedTo, partialItems).
   Shows partial-state breakdown with "Re-open as new gap" CTA.
   In the prototype: allShipped.map(...) inside activeSection === 'shipped'.

7. PersonaCard — name + icon + readiness % + progress bar.
   In the prototype: see the personas grid in activeSection === 'map'.

8. ChatDrawer — slide-in drawer with messages, input, and quick prompt chips.
   Props: open, onClose, messages, onSend, quickPrompts.
   In the prototype: the entire bottom modal rendering when chatOpen is true.

9. ProgressBar — thin horizontal bar with optional label.
   Use the persona readiness bar pattern from the prototype as reference.

10. EmptyState — icon + title + description, centered.
    Props: icon, title, description, action?
    In the prototype: see the "All gaps handled" or "Nothing shipped yet" states.

PREVIEW ROUTE:
Add a /v2/style-guide route that renders all components in their various states so you
can visually verify them. This is throwaway QA — it'll get deleted in Phase 6.

CRITICAL CONSTRAINTS:
- All components are exported as named exports from components/v2/index.ts
- Zero coupling to existing v1 components — these stand alone
- TypeScript strict types if the project is TS
- No business logic in components — pure presentation, all state lifted to props
- Each component < 150 lines
- Match the prototype's class names and structure where reasonable —
  it'll make Phase 2-5 faster

DO NOT:
- Modify any existing pages
- Add these components to any existing screen
- Change v1 styles
- Touch backend code
- Invent visual patterns not in the prototype

DELIVERABLE:
- Commit: "feat(v2): phase 1 - design system primitives + style guide"
- Brief summary of components built
- Confirmation that /v2/style-guide renders all of them correctly
- Screenshot or note any places where you had to deviate from the prototype
```

---

# PHASE 2: Project Workspace Shell

**Goal:** Build the empty v2 project page chrome at `/v2/project/:id`. Each tab renders a placeholder.

**Why third:** You need a container before you migrate features into it.

**Estimated time:** 3-4 hours
**Risk:** Low (new route, doesn't touch v1)

## Cursor prompt for Phase 2

```
You are working on the Takeoff codebase. Your job in this session is Phase 2: build the
v2 project workspace shell. Do not migrate any real features yet.

REFERENCE — READ FIRST:
Open and read: docs/v2-reference/takeoff-prototype.jsx
The "view === 'project'" block is the complete reference for what you're building in
this phase. Match its layout exactly — header, tab bar, two-column grid, sidebar.

KEY EXTRACT:
- Header structure: see the <header> at top of the component
- Project header section: search for "Your project" overline rendering
- Tab bar: search for "border-b border-stone-200 mb-8"
- Sidebar layout: search for the right column inside the lg:grid-cols-4
- Sidebar cards (Stack, Personas, Ask Claude CTA): all in the right column rendering

CONTEXT:
Phase 1 built the design system primitives. Phase 2 builds the new project page chrome
at /v2/project/:id using those primitives. Each tab will be a placeholder. Real content
gets migrated in Phases 3-5.

ROUTING:
Add a new route /v2/project/:id that renders V2ProjectPage. This route is gated behind
a feature flag for now (read from src/config/flags.ts USE_V2_PROJECT — default false,
but allow ?v2=true query param to override during development).

PAGE STRUCTURE:
src/pages/v2/Project.tsx should render:

1. Header (sticky, full-width, white bg, stone-200 border-bottom)
   - Takeoff logo + name on left (use Zap icon in stone-900 box)
   - "+ New project" link on right (links to existing intake — don't replace it)
   Match the prototype's <header> exactly.

2. Project header section (max-w-6xl centered, py-12 px-6)
   - "Your project" overline (uppercase tracking-widest text-stone-500 text-xs)
   - Project title (h2, text-4xl, serif font)
   - Right side: "Readiness" label + score number (text-2xl, bold) + "/ 100"
   - Subtitle: project type description

3. Tab bar (use TabBar component from Phase 1)
   - Gaps (icon: AlertOctagon, badge: untriaged count if > 0)
   - Map (icon: Users)
   - Context (icon: FileText)
   - Shipped (icon: GitCommit, badge: this-session-shipped count if > 0,
     badgeColor: 'emerald')

4. Two-column grid below tabs (lg:grid-cols-4, gap-8)
   - Left/main column (col-span-3): Active tab content (placeholder for now)
   - Right sidebar (col-span-1):
     - Stack card (uses MetadataLabel "Stack" + key/value pairs)
     - Personas card (uses MetadataLabel "Personas" + list of icons + names + readiness %)
     - "Ask Claude" CTA button (full-width, dark bg, opens ChatDrawer)

PLACEHOLDER CONTENT FOR EACH TAB:
Each tab renders an EmptyState component (from Phase 1) with:
- Gaps: icon=AlertOctagon, title="Gaps will appear here in Phase 3"
- Map: icon=Users, title="Personas and jobs will appear here in Phase 5"
- Context: icon=FileText, title="Project context will appear here in Phase 5"
- Shipped: icon=GitCommit, title="Shipped commits will appear here in Phase 4"

DATA FETCHING:
For now, fetch project metadata from the existing v1 endpoint (likely /api/projects/:id
or similar — search for the existing Project data fetch). Render: title, type, readiness
score, stack, personas. Don't worry about the real gap/shipped data — those endpoints
will be built in their respective phases.

CHAT DRAWER:
Wire up the ChatDrawer from Phase 1 to the "Ask Claude" button. For now, the chat can be
a stub that returns canned responses based on keyword matching — same as the prototype.
Look at the sendChatMessage function in the prototype for the canned-response pattern.

URL HANDLING:
- Direct nav to /v2/project/:id should work
- Tab state should be in URL hash (#gaps, #map, #context, #shipped) so it's shareable
  and survives refresh
- Default tab: gaps

CRITICAL CONSTRAINTS:
- Do not modify the existing v1 project page
- Do not modify any existing routes
- The v2 page can read from existing APIs but cannot modify their schema
- Use only components from components/v2/

DO NOT:
- Implement any tab's real content (placeholders only)
- Replace v1 anywhere
- Add the v2 link to v1's nav (we'll do this in Phase 6)

DELIVERABLE:
- Commit: "feat(v2): phase 2 - project workspace shell"
- /v2/project/:id loads with project metadata, tabs render, sidebar populates,
  chat drawer opens
- Existing app continues to work unchanged
- Brief summary including the URL to test (e.g., /v2/project/abc123?v2=true)
```

---

# PHASE 3: Migrate Gaps Tab

**Goal:** The hero feature. Migrate Suggestions into the new Gap structure with Accept/Reject/Refine + inline prompt.

**Estimated time:** 2-3 days
**Risk:** Medium (touches the most-used backend data model)

## Cursor prompt for Phase 3

```
You are working on the Takeoff codebase. Your job in this session is Phase 3: migrate
Suggestions into the new Gaps experience. This is the most important phase — take your
time, get the interaction right.

REFERENCE — READ FIRST:
Open and read: docs/v2-reference/takeoff-prototype.jsx
The activeSection === 'gaps' block contains the complete UI reference for this phase.
Read the entire block, including:
- The filter chips (Active / All / Rejected)
- The full gap card rendering with all three states (untriaged / in-progress / rejected)
- The expandable prompt section (Cursor prompt in dark bg block)
- The Accept / Reject / Refine button cluster
- The Refine input flow
- The "Mark committed" green button (only visible when in-progress)
- The empty state

Also read these state functions to understand the full flow:
- acceptGap (line ~120)
- markCommitted (line ~125)
- rejectGap (line ~130)
- restoreGap (line ~135)
- startRefine, submitRefine
- copyPromptForGap

CONTEXT:
The existing Suggestions feature is good but buried. We're promoting it to be the
primary view of a project, restructuring it into three categories, and adding the
accept-reject-refine workflow with inline Cursor prompts.

DATA TRANSFORMATION:
Map existing Suggestion records to Gap records using the schema fields added in Phase 0.

Categorization rules (run as a backend transform — likely in app/server/services/ or
similar):
- Existing severity 'high' AND tag includes ('security', 'bug', 'deployment')
  → category: 'broken'
- Existing severity 'high' or 'medium' AND ties to a persona's job
  → category: 'missing_functionality'
- Existing infrastructure-gap items (Email, Payments, Storage, etc., found in the
  analyzer's "capabilities" output) → category: 'missing_infrastructure'
- Default fallback: 'broken' for severity high, 'missing_functionality' otherwise

Persist this mapping. Existing suggestions get categories assigned via a one-time
migration script.

API ENDPOINTS:
Build these new endpoints (or extend existing ones — your choice based on what already
exists):

GET /api/v2/projects/:id/gaps
Returns: { broken: Gap[], missing: Gap[], infra: Gap[] } with status filtering via query
param ?status=untriaged

POST /api/v2/projects/:id/gaps/:gapId/accept
Sets status to 'in_progress'. Returns the updated gap with the full Cursor prompt.

POST /api/v2/projects/:id/gaps/:gapId/reject
Sets status to 'rejected'. Optional body: { reason: string }.

POST /api/v2/projects/:id/gaps/:gapId/refine
Body: { instructions: string }. Calls Claude to regenerate the gap based on user's
refinement instructions. Returns updated gap.

POST /api/v2/projects/:id/gaps/:gapId/mark-committed
Sets status to 'shipped' and verification to 'pending'. Triggers the verification scan
(see Phase 4 — for now, just mark it pending).

CURSOR PROMPT GENERATION:
Each gap needs a high-quality Cursor prompt. If existing suggestions don't have one,
generate one when the user clicks Accept (call Claude with project context + gap
details). Cache the result so repeated Accepts don't regenerate.

The prompt should include:
- Project context (stack, file structure)
- The specific gap and why it matters
- Concrete requirements with file paths
- Suggested approach
- Verification criteria

Example prompt structure (see the prototype's projectData.gaps[*].prompt fields for the
expected shape and tone — they are intentionally written as if speaking to another AI
agent, not to the user).

UI IMPLEMENTATION:
Replace the placeholder in the Gaps tab from Phase 2 with the real implementation. Use
the GapCard component from Phase 1.

Filter chips at top (matching the prototype):
- Active (default — shows untriaged + in_progress)
- All
- Rejected (only shows if rejected count > 0)

Status indicator on right when in_progress count > 0:
- Pulsing amber dot + "{n} in progress"

Three states for each gap card (match the prototype exactly):
1. Untriaged: full description visible, three buttons: Accept / Reject / Refine
2. In progress: amber ring (ring-2 ring-amber-100 border-amber-300) around card,
   "In progress" badge, prompt section expandable below description, buttons:
   Copy prompt / Open in Cursor / Mark committed
3. Rejected: faded card (opacity 60%), "Rejected" badge, "Restore this gap" link

Refine flow (match the prototype):
- Click Refine → input box appears below description
- User types refinement instructions
- Click "Regenerate" → calls /refine endpoint, shows loading state, replaces gap content
  with regenerated version, status returns to untriaged

Mark committed flow:
- Click Mark committed → status becomes 'shipped', card animates out of Gaps view
- Toast appears: "Marked as committed. Takeoff will verify after your next push." with
  link "View in Shipped →"

EMPTY STATE:
If a filter view has no gaps, render EmptyState component:
- Active: "No active gaps. Switch filters to see others."
- All: "No gaps found. Run analysis again to refresh."
- Rejected: "No rejected gaps."

CRITICAL CONSTRAINTS:
- Existing /api/suggestions endpoints must continue to work (v1 still uses them)
- Do not modify existing Suggestion records irreversibly — the migration must be
  reversible
- All v2 API endpoints under /api/v2/ prefix

DO NOT:
- Touch the v1 Suggestions UI
- Implement verification logic (that's Phase 4)
- Implement Map or Context tabs
- Change v1 project pages

DELIVERABLE:
- Commit: "feat(v2): phase 3 - gaps tab with accept/reject/refine flow"
- Working Gaps tab at /v2/project/:id#gaps
- All three gap categories displaying real data
- Accept/Reject/Refine all functional
- Mark committed works (verification just pends for now)
- Brief summary of: # of suggestions migrated to gaps, # in each category,
  any edge cases found
```

---

# PHASE 4: Migrate Shipped Tab + Verification

**Goal:** Build the verification engine and timeline view.

**Estimated time:** 2-3 days
**Risk:** Medium-high (new backend with webhooks)

## Cursor prompt for Phase 4

```
You are working on the Takeoff codebase. Your job in this session is Phase 4: build the
Shipped tab with commit verification. This is the most novel feature in v2.

REFERENCE — READ FIRST:
Open and read: docs/v2-reference/takeoff-prototype.jsx
The activeSection === 'shipped' block contains the UI reference. Read it including:
- The "Connected to {repo} · Listening for commits" banner with green pulse
- Each shipped item card with verification badge, commit info, and verification detail
- The "Partial" state with the breakdown of remaining files and "Re-open as new gap" button
- The empty state

Also read the projectData.shipped mock data to understand the data shape — specifically
the partialItems field and how it surfaces.

CONTEXT:
When a user marks a gap as committed in Phase 3, it transitions to 'shipped' with
verification 'pending'. Phase 4 builds the system that watches for the actual commit,
matches it to the gap, and verifies whether the gap is genuinely resolved.

GITHUB WEBHOOK:
First, check if a GitHub webhook integration exists. The existing app may have one
(search for /api/github-webhook or webhook handlers).

If it exists: extend it with new event handling. If not, build it:
1. Endpoint: POST /api/v2/webhooks/github
2. Validates signature using HMAC SHA-256 with stored webhook secret
3. Handles 'push' events, extracts commits with their changed file lists
4. Stores raw webhook payload in a webhook_events table for replay/debugging

For each commit in a push event:
1. Look up project by repo URL
2. Run the matcher (see below)
3. If matched, run the verifier
4. Store the result as a ShippedItem record

COMMIT-TO-GAP MATCHER:
Build app/server/services/v2/gap-matcher.ts with:

matchCommitToGap(commit, openGaps) returns: {gapId, confidence} | null

Matching strategy (try in order, take first hit with confidence > 0.7):
1. Conventional commits with gap reference: "fix(gap:b1):" or "[gap-b1]"
   → exact match, confidence 1.0
2. File overlap: if commit touches >50% of files in a gap's "files affected" list
   → confidence 0.9
3. Keyword match: if commit message contains key terms from gap title (using simple
   keyword extraction) AND touches at least one file in scope → confidence 0.8
4. Claude classifier: send commit message + diff summary + open gap titles to Claude,
   ask which gap (if any) this addresses → confidence as returned

Log all matches and confidence scores for tuning later.

VERIFIER:
Build app/server/services/v2/gap-verifier.ts with:

verifyGap(gap, commit) returns: { verification: 'verified' | 'partial', detail: string,
partialItems?: string[] }

Verification logic varies by gap category:

For 'broken' gaps (e.g., "no input validation"):
- Re-run the original detection logic from the analyzer on the affected files
- If detector finds zero issues → 'verified'
- If detector finds some issues → 'partial' with list of files still failing

For 'missing_functionality' gaps:
- Check if the expected files/exports/routes now exist
- Check if relevant tests pass (if test runner is integrated)
- Use Claude as a judge: send the gap description + the diff, ask "does this commit
  address this gap fully, partially, or not at all?"

For 'missing_infrastructure' gaps:
- Check if expected packages/files are now present
- Run capability detection on the new code

If verification is 'partial', extract specific files/lines that still fail. These will
display in the UI as in the prototype's partialItems rendering.

NEW DATA MODEL:
ShippedItem table:
- id, project_id, gap_id, commit_sha, commit_message
- files_changed, files_changed_count
- verification (verified | partial | pending)
- verification_detail
- partial_items (json array of remaining issues)
- shipped_at, deployed_to (nullable)

API ENDPOINTS:
GET /api/v2/projects/:id/shipped
Returns: ShippedItem[] sorted by shipped_at desc

POST /api/v2/projects/:id/gaps/:gapId/reopen
Reopens a partial-verification gap as a new gap with scope narrowed to the still-failing
items.

UI IMPLEMENTATION:
Replace the Shipped tab placeholder. Use the ShippedItem component from Phase 1.

Top of page:
- Connection status banner: "Connected to {repo} · Listening for commits" with green
  pulse if webhook is healthy (match the prototype's banner styling exactly)

Timeline of shipped items:
- Group by day (TODAY, YESTERDAY, then date) — see the prototype for the visual pattern
- Each item shows: verification badge, title, commit SHA, commit message, files changed
  count, verification detail, deploy status if known
- For 'partial' items: amber callout listing partial_items, with "Re-open as new gap"
  button — match the prototype's partial state styling

Empty state if no shipped items: "Nothing shipped yet. Accept a gap, commit your work,
and it'll appear here verified."

DEPLOY DETECTION (optional but recommended):
If the project has a Railway connection, listen for Railway webhook events too. Mark
ShippedItems as deployed_to: 'Railway' when their commits land in production.

CRITICAL CONSTRAINTS:
- Webhook endpoint must validate signatures or it's a security hole
- Verifier should fail safe (mark as 'pending' if it can't run, never falsely mark
  verified)
- Match confidence < 0.7 should NOT auto-create a ShippedItem — surface to user as
  "we think commit X might be related to gap Y, confirm?"

DO NOT:
- Modify the v1 Suggestions or BuildStory features
- Change Phase 3's Gaps logic
- Touch Map or Context

DELIVERABLE:
- Commit: "feat(v2): phase 4 - shipped tab with commit verification"
- Working Shipped tab at /v2/project/:id#shipped
- Webhook receives pushes, matcher runs, verifier runs, items appear in UI
- Manual test: accept a gap in Phase 3, commit a real fix, see it verified
- Brief summary including any matching/verification edge cases discovered
```

---

# PHASE 5: Map and Context Tabs + Kill the Wizard

**Goal:** Migrate persona/jobs and project context into the new layout. Delete the 5-step onboarding wizard.

**Estimated time:** 1-2 days
**Risk:** Low (mostly UI work)

## Cursor prompt for Phase 5

```
You are working on the Takeoff codebase. Your job in this session is Phase 5: migrate
Map and Context tabs, and remove the product-map onboarding wizard.

REFERENCE — READ FIRST:
Open and read: docs/v2-reference/takeoff-prototype.jsx
Two sections of the prototype matter for this phase:

1. activeSection === 'map' block — the Map tab UI:
   - Persona grid layout
   - PersonaCard rendering with readiness bar
   - The amber "Tech Lead is your weakest persona" insight callout
   - The "+ Add persona" empty card

2. activeSection === 'context' block — the Context tab UI:
   - "In a nutshell" card with serif body text
   - Tech stack key/value rows
   - Build history placeholder

CONTEXT:
The existing app has a 5-step onboarding wizard for personas/jobs (ProductMapOnboarding)
plus a separate /map view. We're collapsing both into the v2 Map tab with inline editing.

MAP TAB IMPLEMENTATION:
Replace the placeholder in the Map tab. Render persona data using PersonaCard from Phase 1.

Layout: 2-column grid of persona cards on desktop, single column on mobile.

Each PersonaCard shows (per prototype):
- Persona icon + name
- "{n} jobs to be done" subtitle
- Readiness % (large number)
- Color-coded progress bar (red < 75, amber 75-89, emerald >= 90)
- "Edit jobs" link → opens an inline edit drawer (NOT a 5-step wizard)

After the persona grid, add an insight callout (amber bg) — see prototype:
- Identifies the lowest-readiness persona dynamically
- Suggests "The Missing Functionality gaps that affect them are likely your highest-
  impact fixes"
- Links to Gaps tab filtered by that persona

Add a "+ Add persona" card at the end of the grid. Clicking it opens a simple modal:
name + description + emoji icon.

INLINE JOBS EDITOR:
When user clicks "Edit jobs" on a persona, open a side drawer (not a full-page wizard) with:
- Persona name + description (editable)
- List of jobs with priority (HIGH/MEDIUM/LOW) and completion %
- Each job: editable inline (click to edit text, dropdown for priority)
- Add new job button
- Save/Cancel at bottom

This replaces the entire "Step 3: What do they need to do?" wizard step.

CONTEXT TAB IMPLEMENTATION:
Replace the placeholder in the Context tab. Three cards in a vertical stack:

1. "In a nutshell" card
   - MetadataLabel: "In a nutshell"
   - Plain-English summary in serif font
   - Source: existing /api/projects/:id/summary or generate via Claude if missing
   - Edit button (admin-only)

2. "Tech stack" card
   - MetadataLabel: "Tech stack"
   - Key-value rows: Runtime, Backend, Frontend, Database, Deploy
   - Source: from analyzer output

3. "Build history" card
   - MetadataLabel: "Build history"
   - Timeline of recent commits + milestones (reuse existing Build Story data)
   - Latest 10 events
   - "View full history" link

KILL THE WIZARD:
Once Map tab is functional with inline editing:

1. Delete the routes /product-map/* including all 5 steps (ProductMapOnboarding,
   persona setup, jobs, mapping, roadmap)
2. Add 301 redirects from these routes to /v2/project/:id#map for any user who lands
   there from old links
3. Delete the source files:
   - pages/ProductMapOnboarding.tsx (or equivalent)
   - All wizard step components
   - Wizard-specific styles
4. Remove any nav links pointing to /product-map

KILL THE OLD MAP:
Same treatment for the existing /map/:id route — redirect to v2 and delete the source.

ANALYSIS TAB CONSOLIDATION:
The current app has separate "Analysis" and "takeoff/map" pages with overlapping data.
Consolidate into the v2 Map tab. The single readiness score (computed once on the
backend) should appear in the project header — kill any duplicate calculation in the
old Analysis tab path.

CRITICAL CONSTRAINTS:
- Do not delete BuildStory yet — it's still used by v1
- Existing /api/personas, /api/jobs endpoints continue to work (now serve both v1 and v2)
- No data loss — verify all existing user personas/jobs still appear in the new view

DO NOT:
- Touch Gaps or Shipped tabs
- Modify v1 dashboard or intake flow
- Change ShareableStory (used by external links)

DELIVERABLE:
- Commit: "feat(v2): phase 5 - map and context tabs, remove wizard"
- Working Map and Context tabs
- Wizard routes redirect to v2 and source files deleted
- Brief summary: files deleted, redirects added, any data discrepancies found
```

---

# PHASE 6: Cutover and Cleanup

**Goal:** Make v2 the default. Remove v1.

**Estimated time:** Half a day to switch + 1-2 weeks of monitoring before deletion
**Risk:** Highest (this is the irreversible step)

## Cursor prompt for Phase 6a (Switch)

```
You are working on the Takeoff codebase. Your job in this session is Phase 6a: switch
v2 to default. ONLY run this phase after all of Phase 0-5 are merged and the team has
been using v2 via the feature flag for at least 1 week without major issues.

REFERENCE:
This phase has no visual component. The prototype is no longer needed.

CONTEXT:
v2 is now feature-complete. Time to make it the default. We are NOT deleting v1 in this
session — that's Phase 6b, after a wait period.

PRE-FLIGHT CHECKS:
Before any code changes, verify:
1. /v2/project/:id has been used by real users for at least 1 week
2. No critical bugs reported in v2
3. All major flows tested: gap accept/reject/refine, mark committed, verification,
   persona editing
4. The webhook + verification system is healthy in production

If any of the above fail, STOP and report. Do not proceed.

ROUTE SWITCH:
1. Set the USE_V2_PROJECT feature flag to default true in src/config/flags.ts
2. Make /project/:id render the v2 Project component (not v1)
3. Add /project/:id?v1=true escape hatch that renders v1 (for emergency rollback)
4. /v2/project/:id continues to work (unchanged) for any direct links out there

NAV UPDATES:
- Dashboard project links now point to /project/:id (which is v2)
- Any internal links to /map/, /product-map/, /story/ already redirect (Phase 5 work)
- Update intake flow's success redirect to /project/:id (will be v2 by default)

V1 DEPRECATION NOTICE:
Add a small banner on the v1 escape route (/project/:id?v1=true): "You're viewing the
old version. Click here to switch to the new version permanently." With a link that
removes the ?v1 param and clears localStorage if used.

CRITICAL CONSTRAINTS:
- This commit must be revertable — don't delete anything
- Backup the production database before merging this commit

DELIVERABLE:
- Commit: "feat(v2): phase 6a - switch v2 to default"
- Default project page is now v2
- /project/:id?v1=true escape hatch works
- All redirects functional
```

## Cursor prompt for Phase 6b (Deletion)

**Run this only after at least 1 week of v2 being default, with no critical issues.**

```
You are working on the Takeoff codebase. Your job in this session is Phase 6b: delete
v1 source code and promote v2 out of /v2/ subdirectories.

PRE-FLIGHT CHECKS:
1. Phase 6a has been live for at least 1 week
2. No users have reported needing the v1 escape hatch
3. Error rates are stable

If any check fails, STOP.

DELETION:
1. Delete the v1 escape route handler (?v1=true no longer works)
2. Delete v1 source files:
   - src/pages/Project.tsx (the old one) and all v1 sub-components used only by it
   - components used only by v1 (audit imports first — search for usages)
   - v1-specific styles
3. Move v2 components out of /v2/ subdirectories:
   - src/pages/v2/Project.tsx → src/pages/Project.tsx
   - src/components/v2/* → src/components/*
   - Update all imports
4. Remove the USE_V2_PROJECT feature flag (no longer needed)
5. Remove /v2/project/:id route (replaced by /project/:id)
6. Update tests to point to new paths
7. Delete docs/v2-reference/ — the prototype reference is no longer needed

Final cleanup:
- Run linter
- Run full test suite
- Run a fresh self-audit on Takeoff — v2 should now be ~50% smaller than v1 was

CRITICAL CONSTRAINTS:
- Do not delete anything that's still imported (search before deleting)
- Backup database before merging

DELIVERABLE:
- Commit: "feat(v2): phase 6b - remove v1, promote v2 out of /v2/"
- v1 source files deleted
- v2 components moved to canonical locations
- Feature flag removed
- File count reduction summary
```

---

## What to do if something goes wrong

**During a phase:**
- Don't push partial work to main. Use a feature branch per phase.
- If the agent makes destructive changes you didn't expect, revert and re-run with stricter constraints.

**Between phases:**
- Each phase commit should be revertable in isolation. If Phase 4 breaks something, revert just Phase 4 and the others still work.

**After Phase 6a switch:**
- Keep the v1 escape hatch (?v1=true) for at least a week
- Watch error rates and user feedback
- If anything is wrong, revert Phase 6a and stay on v1 until fixed

## Tracking progress

Use a simple checklist somewhere visible:

```
[ ] Phase -1: Save prototype + instructions to docs/v2-reference/
[ ] Phase 0: Cleanup
[ ] Phase 1: Design system
[ ] Phase 2: Project shell
[ ] Phase 3: Gaps tab
[ ] Phase 4: Shipped tab
[ ] Phase 5: Map + Context, kill wizard
[ ] Phase 6a: Switch to v2 default
[ ] Phase 6b: Delete v1 (after wait)
```

## Final reminder

Each prompt above is designed to be **the entire input** to a Cursor agent session. Copy it as-is, including the rules at the top of this document. The agent will have everything it needs — including the prototype reference at `docs/v2-reference/takeoff-prototype.jsx`.

If you find a phase too large in practice, split it into a-b-c sub-phases — but don't try to combine phases. Smaller commits = clearer reviews = lower regression risk.
