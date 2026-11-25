# @takeoff/cli

`takeoff.yaml` is where a team writes down what the product should do. The CLI checks it and turns it into the instruction files coding agents read.

```
takeoff validate [file] [--strict]   check takeoff.yaml; errors show file:line:col
takeoff sync [file] [--check] [--dry-run]   write CLAUDE.md, AGENTS.md, .cursor/rules/takeoff.mdc
takeoff migrate [file] [--dry-run]   upgrade a v1 file to v2
```

Exit codes: 0 ok, 1 problems found, 2 usage error. `--dir` and `--file` pick another folder or filename.

## Schema (v2)

```yaml
version: 2
product:
  name: Delta-V
  summary: "What the product does and for whom."
areas:
  - id: billing                 # lowercase, unique
    name: Billing & pricing
    paths: ["src/billing/**"]   # repo-relative globs, at least one
    creators: ["a@example.com"] # notified about drift here (optional)
    rules: ["Stripe holds all billing data."]   # a string, or { id, text }
    never: ["Never store card numbers."]
    screens:                    # optional: screens captured for UAT when this area changes
      - { name: Checkout, route: /checkout }
agreements:                      # added by Takeoff when members agree
  - id: agr_2026_11_24_annual_plan
    area: billing                # optional, must be an area id
    text: "Offer an annual plan at 20% off monthly."
    agreed_by: ["a@example.com"]
    agreed_on: 2026-11-24
    source: "https://..."        # optional
```

Unknown keys are warnings, so a file written for a newer version still loads.

## sync

Writes only between `<!-- takeoff:start -->` and `<!-- takeoff:end -->`; everything else in the file is left alone. A missing file is created, an existing file without markers gets the block appended. Running it twice changes nothing. A marker counts only when it stands alone on its own line outside a code block, so mentioning one in prose is safe. Marker text inside `takeoff.yaml` is escaped. Sync refuses to write through a symlink. If the markers are broken, nothing is written. Use `sync --check` in CI to fail when the files are stale.

## v1

There was no v1 schema in the repo, so `migrate` accepts the plain shapes a hand-written file would use (`name`/`product`, `summary`/`description`, top-level `rules`/`never`, `areas` with `path`/`paths`). Top-level rules move into a "General" area covering every path. Where v2 is stricter, it adjusts and says so: an area with no paths covers `**`, creators that aren't email addresses are dropped, and invalid or repeated rule ids are removed (the rule stays). Anything it can't carry over is listed, not dropped silently. Comments are not kept.

The library is exported too (`require('@takeoff/cli')`): `validateText`, `migrateData`, `renderBlock`, `applyBlock`, `sync`.
