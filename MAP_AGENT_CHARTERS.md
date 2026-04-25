# Product map — parallel agent charters

Use this doc to spin up **four workers** on the Takeoff product map feature without overlapping edits. Each charter lists **owned files**, **reads**, and **done criteria**.

**Product spec (human):** If you keep a frozen copy in-repo, use `MAP_CONTEXT.md` (from the external `CONTEXT.md` “Takeoff Product Map” artifact). Otherwise point agents at your canonical path for that file plus `QUICKSTART.md` and the two JSX prototypes (onboarding + dashboard).

**Integration order:** Agents **1** and **2** can run in parallel. **3** depends on stable exports from 1–2 (or stubs that match the planned API). **4** depends on **3**’s HTTP contract (or documented request/response shapes).

---

## Agent 1 — Foundation (pure server)

**Owns only:**

- `app/server/services/code-entities.js`
- `app/server/services/job-scorer.js`

**Reads:**

- `MAP_CONTEXT.md` (or equivalent): sections *code-entities.js*, *job-scorer.js*, *Data model* entity shapes
- `QUICKSTART.md` — Steps 1–2
- `app/server/services/analyzer.js` — real `codebaseModel` shape (`fileTree`, `fileContents`, `gaps`, etc.)

**Delivers:**

- `extractCodeEntities(codebaseModel)` — pages, routes (+ methods), components, capabilities (gaps + heuristics), tables; dedupe by `id`
- Pure scoring: `getEntityStatus`, `scoreJob`, `scoreApp`, `scorePersona`, `simulateModule`, `rankModules`
- CommonJS (`module.exports`), no DB or HTTP

**Verify:** `node -e` smoke with a tiny mock `codebaseModel` and mock jobs/edges (see QUICKSTART Step 2 expectations).

---

## Agent 2 — AI + linking

**Owns only:**

- `app/server/services/map-extractor.js`
- `app/server/services/map-linker.js`

**Reads:**

- Same product spec: *map-extractor.js*, *map-linker.js*
- `QUICKSTART.md` — Steps 3–4
- `app/server/services/context-generator.js` + `app/server/lib/anthropic-tracked.js` — tracked Claude pattern

**Delivers:**

- `extractProductIntent(description)` → `{ domain, personas, jobs }` with stable ids and weights from priority
- `heuristicLink`, `claudeLink`, `linkCodeEntities`, `linkAll` with dedupe; Claude only for jobs with fewer than two heuristic `needs` edges
- Entity id conventions aligned with Agent 1 (`cap:auth`, `page:/…`, `route:METHOD /path`, etc.)

**Verify:** JSON parse errors handled; optional manual run with `ANTHROPIC_API_KEY` and sample descriptions from QUICKSTART.

---

## Agent 3 — Persistence + orchestrator + API

**Owns:**

- New SQL under `app/server/migrations/` (e.g. `005_product_map.sql`) **or** the repo’s established migration mechanism
- `app/server/lib/db-map.js` (or equivalent) + exports wired from `app/server/lib/db.js`
- `app/server/services/product-map.js`
- `app/server/routes/product-map.js`
- Mount + auth wiring in `app/server/app.js`

**Reads:**

- Product spec: orchestrator, API routes, SQL tables
- `QUICKSTART.md` — Steps 5–6
- `app/server/lib/migrate.js`, `app/server/lib/db.js`, existing project/deployment IDs (this repo uses **deployments** as projects where noted)

**Delivers:**

- Tables: `product_maps`, `map_personas`, `map_jobs`, `map_entities`, `map_edges` per spec
- `createProductMap` / `updateProductMap` wiring: analysis → `extractProductIntent` → `extractCodeEntities` → `linkAll` → score → persist
- Routes: `POST /api/product-map/:projectId`, `GET` latest by project, `PATCH /api/product-map/:mapId`, `GET …/scores`, `GET …/simulate/:moduleId`

**Verify:** Migration applied against dev DB; one E2E curl/script: POST → GET → PATCH → simulate.

---

## Agent 4 — Client + prototype mirrors

**Owns:**

- `prototypes/product-map-onboarding.jsx` (copy of reference onboarding)
- `prototypes/map-readiness-dashboard.jsx` (copy of reference dashboard)
- `app/client/src/pages/ProductMap.tsx` (+ optional `ProductMapOnboarding.tsx`)
- `app/client/src/components/ReadinessRing.tsx`, `ModuleImpact.tsx`, `JobList.tsx` (names may vary if split differently)
- `app/client/src/services/productMapApi.ts` (or equivalent fetch helpers)
- Route entries in `app/client/src/App.tsx`

**Reads:**

- Product spec: *Client: ProductMap.tsx* section
- `QUICKSTART.md` — Step 7
- Prototype JSX files (visual source of truth): DM Sans + DM Mono, `#0c0c14`, `#f43f5e`, three tabs, readiness ring, module hover simulation

**Delivers:**

- Three views (Readiness / Jobs / Technical), loading + error + empty states
- Optional onboarding route wired to `POST` create map
- `npm run build` (client) passes

**Verify:** Build; manual click-through on `/projects/:id/map` with mock or real API.

---

## Conflict avoidance

| Agent | Do **not** edit |
|-------|------------------|
| 1 | Anything outside the two service files above unless a one-line export is unavoidable |
| 2 | DB, routes, `app.js`, client |
| 3 | Prototype copies only if needed for path docs — prefer not touching client |
| 4 | `packages/auth/` — unchanged; server files only if fixing a documented API typo |

If two runs both touch **Agent 3** and **Agent 1** on the same branch, reconcile **services** in Agent 1’s files and **imports** in Agent 3 — avoid duplicating full service implementations inside `product-map.js`.

---

## Quick re-run checklist

1. [ ] DB migrated (`migrate` / deployment process)
2. [ ] `ANTHROPIC_API_KEY` set for extract + link
3. [ ] Analysis with populated `codebase_model` (ideally `fileContents`) for linking quality
4. [ ] Client env points API at same origin as server

Last updated from the initial four-agent product map rollout (Takeoff / CodeGuru `app/`).
