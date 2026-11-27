# @takeoff/cli

`takeoff.yaml` is where a team writes down what the product should do. The CLI checks it and turns it into the instruction files coding agents read.

```
takeoff validate [file] [--strict]   check takeoff.yaml; errors show file:line:col
takeoff sync [file] [--check] [--dry-run]   write CLAUDE.md, AGENTS.md, .cursor/rules/takeoff.mdc
takeoff migrate [file] [--dry-run]   upgrade a v1 file to v2
takeoff notes [--branch <name>] [--repo <owner/name>] [--json]   reviewers' send-back notes for this branch's PR
takeoff hook install [--local] [--command <cmd>] [--mcp]   add Takeoff's Claude Code hooks (and, with --mcp, its plan tools)
takeoff mcp   serve the plan to a coding agent over MCP
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

## Claude Code hook

`takeoff hook install` adds three hooks to `.claude/settings.json` (`--local` writes `.claude/settings.local.json` instead, which isn't committed; `settings.json` is shared with everyone who clones the repo). It keeps everything already in the file, adds each hook once (running it again updates Takeoff's own hooks in place), and changes nothing if the file isn't valid JSON. Each hook first checks that the program is on PATH, so a teammate without Takeoff runs nothing. `--command "npx --no-install takeoff"` sets how the hooks call Takeoff when it isn't installed globally; `--no-install` keeps npx from downloading a package on every prompt.

- **Each prompt** (`UserPromptSubmit`): the agent gets the rules, nevers and agreements for the areas this branch changes (committed since it left the default branch, plus uncommitted and new files), and any send-back notes reviewers left on the open PR for the branch it pushes to. The rules come from `takeoff.yaml` on the default branch; changes the branch makes to `takeoff.yaml` are shown as proposals, not as agreed. A session gets this once, and again when it changes.
- **After an edit** (`PostToolUse` on Edit, Write, MultiEdit and NotebookEdit): when the file is in an area with Creators and your `git config user.email` isn't one of them, you see one line, once per area per session: `Takeoff: this edit is in Billing (Creator: saagar@example.com), which you aren't a Creator of. It'll be flagged on the PR if it drifts.` The agent gets the area's rules with it. An area with rules and no Creators tells only the agent.
- **A new session** (`SessionStart`, including after `/clear` or a compact): the session hears the context again.

The hooks never block the agent and never show an error. In a repo without `takeoff.yaml` they do nothing. Notes are read only for a branch with an upstream on GitHub. They're cached in `.git/takeoff/` and refreshed in the background every two minutes, so a prompt only waits on GitHub the first time on a branch (about two seconds at most). Offline, the last notes it read stay. Anything that went wrong is written to `.git/takeoff/hook.log`. Reading notes needs `GITHUB_TOKEN` or the gh CLI's sign-in, like `takeoff notes`; set `TAKEOFF_APP_SLUG` to trust only the Takeoff App's comments (without it, each note says which App posted it).

The library is exported too (`require('@takeoff/cli')`): `validateText`, `migrateData`, `renderBlock`, `applyBlock`, `sync`.

## Plan tools for coding agents (MCP)

`takeoff mcp` is a Model Context Protocol server on stdin and stdout. The hook tells the agent the plan once per prompt; with the server, the agent can also look things up while it works. Every tool only reads, and none runs anything but git (and GitHub's API for notes):

- `get_plan({ area?, version? })`: the product, each area with its paths, rules and nevers, and the agreements.
- `rules_for_path({ path, version? })`: the areas that cover a file, matched the way the pull request check matches them, with their rules and agreements, plus the product-wide agreements. Takes a repo-relative path or an absolute path inside the repo.
- `get_send_back_notes({ branch? })`: reviewers' send-back notes on the open PR for the branch this one pushes to, newest first. Needs `GITHUB_TOKEN` or the gh CLI's sign-in, like `takeoff notes`.
- `recent_plan_changes({ limit? })`: the latest commits on this branch that changed `takeoff.yaml`, each with a short diff.

`version` is `"agreed"` by default, which reads `takeoff.yaml` on the default branch (what pull requests are checked against), or `"working"` for the file on disk, which may hold this branch's unreviewed proposals. When a tool can't answer (no `takeoff.yaml`, a file with errors, no git, GitHub unreachable) it returns `available: false` and a reason instead of an error. A symlinked `takeoff.yaml`, or one over 1 MB, is never read. git and gh are only run from absolute PATH entries outside the repo, and repo git settings that would run a program on a read (signature checks, fsmonitor) are switched off. Without `TAKEOFF_APP_SLUG`, notes come back with `verified_app: false`, since any GitHub App on the repo could have posted them.

`takeoff hook install --mcp` adds the server to `.mcp.json` at the repo root, which is shared with everyone who clones the repo; Claude Code asks each person to approve it the first time. It keeps other servers in the file, and refuses to replace a `takeoff` server it didn't write (one with its own `env`, say), in which case neither file changes. Anyone without @takeoff/cli installed sees the server as failed. With `--local` it writes nothing and prints the `claude mcp add --scope local` command instead.
