# CLAUDE.md

## Roadmap

[ROADMAP.md](ROADMAP.md) is the source of truth for priorities. Read it before
starting work. When work ships or priorities change, update it in the same
commit: tick the item, move it to Shipped with the date and PR number, and keep
Now at three items or fewer.

Older plan docs (`TAKEOFF_PLAN.md`, `TAKEOFF_NEXT_PHASE_SPEC.md`, the build
order in `CONTEXT.md`, `docs/v2-reference/followups.md`) are historical.

## Commands

- `npm run dev` — server and client together
- `npm test --prefix app` — server tests
- `npm run typecheck` — client TypeScript
- `npm run migrate --prefix app` — apply SQL migrations
