# .context.md Specification

**Version:** 0.1.0
**Status:** Draft
**License:** MIT

## Overview

`.context.md` is an open specification for embedding human-and-AI-readable context
directly in your codebase. Each `.context.md` file lives alongside the code it
describes and serves as the source of truth between humans and AI tools.

The goal: any AI tool that touches a directory can read its `.context.md` and
understand *why* the code exists, *what constraints* apply, and *what decisions*
were made — not just *what the code does*.

## Why

Today, the context behind code lives in Slack threads, Figma comments, meeting
notes, and people's heads. When an AI tool generates code, it works without that
context. When a new engineer joins, they reverse-engineer intent from
implementation. When an engineering leader asks "why was it built this way," the
answer is often lost.

`.context.md` captures context at the point of decision, right next to the code
it affects, versioned by git, readable by humans and machines alike.

## File Placement

Place a `.context.md` file in any directory where context would be valuable:

```
src/
├── auth/
│   ├── .context.md      ← context for the auth module
│   ├── login.ts
│   └── session.ts
├── api/
│   ├── .context.md      ← context for the API layer
│   ├── routes.ts
│   └── middleware.ts
└── .context.md           ← top-level project context
```

A `.context.md` applies to all files in its directory and subdirectories,
unless a subdirectory has its own `.context.md` (which takes precedence for
that subtree).

## Sections

All sections are optional. Use what's relevant. The format is standard Markdown
with specific heading conventions.

### `## owner`

Who is responsible for this module. Use GitHub handles when possible.

```markdown
## owner

@samyak (PM) · @chen (tech lead)
```

### `## purpose`

What this module does and why it exists. Write for a new team member or an
AI tool that has never seen this code before.

```markdown
## purpose

Public-facing portal for submitting and tracking FOIA requests. Handles
unauthenticated submissions, automated acknowledgment emails, and status
tracking with estimated response dates.
```

### `## constraints`

Hard rules that must not be violated. These are the guardrails for any human
or AI working in this module.

```markdown
## constraints

- Must comply with 5 USC 552 response timelines
- No PII stored in browser — server-side sessions only
- Accessible to WCAG 2.1 AA
- All endpoints must be rate-limited (see src/api/.context.md)
```

### `## decisions`

Architectural and design decisions with rationale. This is the highest-value
section — it captures knowledge that is almost always lost.

Each decision is a block with a title, rationale, who made it, and when.

```markdown
## decisions

### Use server-side rendering for submission form
Rejected SPA approach — accessibility audit flagged client-side validation
as unreliable with screen readers.
@chen · 2026-02-14

### Queue-based email delivery, not inline
Inline sending caused 2s+ submission latency in load testing. Moved to
Redis queue with retry logic.
@chen · 2026-03-01
```

### `## ai-log`

A chronological record of AI-assisted code generation in this module.
This section can be maintained manually or appended by tooling
(e.g., `updateai log`).

Each entry records: the tool used, the date, what was generated, the context
quality, what a human modified, and a confidence assessment.

```markdown
## ai-log

### 2026-03-15 · claude-code
Generated submission form validation + endpoint.
Context: full spec provided.
Human modified: error message copy.
Confidence: high.

### 2026-03-22 · cursor
Generated status tracking polling logic.
Context: partial — no rate limiting spec provided.
Human modified: added exponential backoff.
Confidence: medium.
```

**Confidence levels:**
- **high** — Full context provided, minimal human modification needed
- **medium** — Partial context, some human modification required
- **low** — Thin context, significant human rework needed

### `## dependencies`

What this module depends on and what depends on it. Helps AI tools understand
blast radius and helps engineers understand impact of changes.

```markdown
## dependencies

Upstream: src/auth (session management) · src/email (queue)
Downstream: src/admin (request review dashboard)
```

### `## status`

Current state of the module. Useful for dashboards and reporting.

```markdown
## status

Stage: production
Last reviewed: 2026-03-20
Coverage: 84%
```

### Custom sections

Teams can add any additional `##` sections relevant to their workflow.
The spec defines the sections above as conventional, but `.context.md` is
Markdown — extend it as needed.

## Design Principles

1. **Human-first, machine-readable.** If it's not useful to read in a text
   editor, it doesn't belong in the spec.

2. **Captured at the point of decision.** Context should be written when
   the decision is made, not reconstructed later.

3. **Versioned with the code.** `.context.md` files are tracked by git.
   The history of context changes is as valuable as the current state.

4. **Tool-agnostic.** The spec works with any AI coding tool — Cursor,
   Claude Code, Copilot, or whatever comes next. The context lives in
   the repo, not in a vendor's database.

5. **Lightweight by default.** Start with `## purpose` and one constraint.
   Add sections as they become relevant. An empty template is worse than
   no file at all.

## Parsing Rules

For tools that need to parse `.context.md` programmatically:

- Sections are identified by `## heading` (h2 level), lowercased and trimmed
- Section content is everything between one `## heading` and the next
- The `## decisions` and `## ai-log` sections contain sub-entries delimited
  by `### sub-heading` (h3 level)
- All other content is treated as freeform Markdown
- Files must be valid UTF-8
- Files should be under 10KB (if it's longer, the module is too complex —
  consider splitting)
