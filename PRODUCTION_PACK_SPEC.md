# Production Packs — Product & Technical Spec

## Read this entire file before writing any code

---

## The strategic case

Jibe tells users what their app is missing: no auth, no RBAC, no deploy
config, no DB health check. Today the fix is a generated `.context.md` that an
AI agent turns into code. For the capabilities where mistakes are expensive
(auth, permissions, deploy, hardening), that means agent-improvised code in
exactly the places where it is most likely to be subtly wrong.

A **Production Pack** is the fix side of the detect → fix loop: a versioned,
human-reviewed module that is applied to the user's repo. Where something
needs config rather than logic, the pack provides the logic and the user or
agent supplies only the config.

Principles:

1. **Config, not generated code.** Packs ship real, tested source. Agents fill
   in a small, declared set of values and nothing else.
2. **Integrate providers, don't reimplement them.** Auth/RBAC wraps WorkOS;
   deploy wraps Railway. We maintain a thin integration layer, not an auth
   system.
3. **Applied as a PR, never a direct write.** The user reviews before merge.
4. **Proven by the detectors.** A pack isn't "done" until the matching
   capability detector reports it present.
5. **Refuse over guess.** If the project's shape doesn't match the pack's
   assumptions, say so and don't apply.

---

## What we already have (don't rebuild)

| Existing capability | Where | Reuse strategy |
|---|---|---|
| Capability detectors (auth, database, deployment, env-config, error-handling, permissions, testing) | `app/server/services/capability-detectors/` | Trigger (gap found) and verify (gap closed) |
| Security detectors (helmet, CORS, cookies, secrets, …) | `app/server/services/security/detectors/` | Trigger and verify for the Hardening pack |
| Stack detection | `analyzer.js → detectStack()` | Pack compatibility matching |
| Readiness scorer | `readiness-scorer.js` | Show the score change a pack caused |
| Spec / intent | `services/intent/spec-generator.js` | Suggest packs from what the app is meant to do |
| GitHub integration | `packages/github` | Open the PR |
| Railway integration | `packages/railway`, `railway.toml` | Deploy pack reference implementation |
| Cursor extension | `cursor-extension/` | Agent-facing entry point |

The detector contract (`run(input) => { exists, confidence, status,
evidence }`) is the verify contract. Do not invent a second one.

---

## Pack anatomy

```
packs/
  auth-workos/
    pack.json            # manifest
    templates/
      express/...        # files added or patched, per stack
      nextjs/...
    verify.js            # extra checks beyond the detector (optional)
    README.md            # human-facing: what it does, cost, credentials
```

### Manifest (`pack.json`)

```json
{
  "id": "auth-workos",
  "version": "0.1.0",
  "capability": "auth",
  "provider": { "name": "WorkOS", "docs": "https://workos.com/docs", "pricing_note": "Free tier; SSO connections are billed per connection." },
  "stacks": ["express", "nextjs"],
  "requires": { "node": ">=18" },
  "provides": ["auth", "permissions"],
  "conflicts": ["auth-clerk"],
  "inputs": [
    { "key": "roles", "type": "string[]", "default": ["admin", "member"], "prompt": "Role names" }
  ],
  "env": [
    { "key": "WORKOS_API_KEY", "source": "provider-dashboard", "secret": true },
    { "key": "WORKOS_CLIENT_ID", "source": "provider-dashboard", "secret": false },
    { "key": "WORKOS_REDIRECT_URI", "source": "derived" }
  ],
  "dependencies": { "@workos-inc/node": "^x.y.z" },
  "verify": { "detectors": ["auth", "permissions"], "checks": ["protected-route-returns-401"] }
}
```

Rules:

- `inputs` are the only values an agent or user may choose. Everything else is
  fixed template.
- `env` entries with `"secret": true` are **listed, never generated or
  filled**. The user gets them from the provider dashboard.
- `conflicts` stops two packs of the same capability being applied.

---

## Apply flow

1. **Match.** Run detectors + `detectStack()`. A pack is *eligible* if its
   capability is `missing` or `partial` and its `stacks` match.
2. **Preflight.** Check the pack's assumptions against the repo (entry file
   found, router found, no conflicting auth already present). Any failure →
   **refuse** with a specific reason. No partial application.
3. **Collect inputs.** Prompt for `inputs` only.
4. **Render.** Copy/patch template files into a branch. Patches use anchored
   insertions (e.g. before `app.listen`), never whole-file rewrites of user
   files.
5. **Open PR.** Description lists: files changed, dependencies added, env
   vars the user must set (with where to get them), provider cost note, and
   manual steps.
6. **Verify.** After the user merges or on the branch preview, re-run the
   capability detectors plus `verify.checks`. Record the result and the
   readiness score delta on the project.

---

## Initial packs (v0)

| Pack | Capability | Stacks | Contents |
|---|---|---|---|
| `auth-workos` | auth + permissions | Express, Next.js | SDK wiring, callback route, session middleware, `requireRole` helper mapped to WorkOS roles, protected-route example |
| `deploy-railway` | deployment | Node (Express/Next.js) | `railway.toml`, Dockerfile, `/health` liveness endpoint, boot-time env validation |
| `hardening-express` | security | Express | Helmet, CORS allowlist, rate limit, error-detail scrubbing, secure cookie flags (maps to existing security detectors) |
| `db-check` | database | Postgres | Migration runner, connection/health check script, backup reminder. A verification, not a provider |

Out of scope for v0: alternative providers (Clerk, Auth0), non-Node stacks,
billing, email.

---

## Verification

`verify.checks` are small, deterministic checks run against the applied
branch, for example:

- `protected-route-returns-401`: start the app with test env, call the
  protected example route without a session, expect 401.
- `health-endpoint-ok`: `/health` returns 200 without a DB call.
- `env-validation-fails-fast`: app exits with a clear message when a required
  env var is missing.

Each pack must ship with a **fixture app per supported stack** in CI. A pack
version is not releasable unless it applies cleanly to its fixtures and its
verify checks pass.

---

## Surfaces

- **Web:** a "Fix with a pack" action on gap cards and suggestions, showing
  the pack README, inputs form and the resulting PR.
- **Spec-driven suggestion:** when the spec implies a capability ("users only
  see their own data" → permissions), suggest the matching pack.
- **Agent (Cursor extension / MCP):** `list_packs`, `apply_pack(id, inputs)`,
  `verify_pack(id)`. Agents are directed to use these instead of writing auth
  or deploy code themselves.

---

## Data model (sketch)

`project_packs`: `project_id`, `pack_id`, `pack_version`, `status`
(`proposed | applied | verified | failed | refused`), `inputs` (jsonb, no
secrets), `pr_url`, `refusal_reason`, `score_before`, `score_after`,
timestamps. Reuse the `project_events` pattern for activity.

---

## Risks and decisions

- **Adapting to existing code** is the hardest part. Mitigation: small packs,
  explicit extension points, preflight that refuses.
- **Provider cost and lock-in.** Every pack README states pricing up front.
  Recommendations must say when a provider is *not* the right fit.
- **Secrets.** Never written by us; PR lists them for the user to set.
- **Template drift.** Pinned provider SDK versions; a scheduled CI job
  re-runs fixtures against latest SDKs and opens an issue on failure.
- **Open question:** distribution. Packs live in this repo for v0; revisit a
  separate `packages/packs` or registry only if third parties contribute.

---

## Build order

1. Pack format + loader + preflight/render engine, with the Express fixture
   and CI harness.
2. `hardening-express` (no provider, fastest end-to-end proof of
   apply → PR → verify).
3. `deploy-railway`.
4. `auth-workos` (Express, then Next.js).
5. `db-check`.
6. Web "Fix with a pack" UI, then agent/MCP tools.

---

## Done when

- A user with an Express app missing helmet/CORS/rate-limit clicks one
  action, gets a reviewable PR, merges it, and the security detectors and
  readiness score reflect the change.
- Applying a pack to an unsupported or conflicting repo refuses with a clear
  reason and changes nothing.
