# Takeoff: design rules for the client

How every user-facing screen should look, read and be built. Follow it for any
UI work. The full reference, with live previews of every component, is the
Takeoff design system: https://claude.ai/artifact/TEoVKgM6TxbzCMwSjqLMau
(private; ask Samyak if you can't open it). When this file and the artifact
disagree, this file wins.

The product is still called Takeoff here. Jibe was chosen on 2026-10-23, but
the rename hasn't started; keep "Takeoff" until told otherwise.

## Who the screens are for

- **Non-technical surfaces** (the web app: writing a plan, reading results, the roadmap, onboarding, marketing pages) are for people who build with AI but don't read code. Everything below applies in full.
- **Technical surfaces** (the CLI, the GitHub check output, the Claude Code hook, developer docs) may be denser: smaller radii, sans and mono led, real diffs and file paths. They still use the same colour tokens, the three status words, and `beacon` only for the brand.
- If you're unsure which kind a screen is, treat it as non-technical.

## Hard rules

These apply to new screens and to screens moved over to the system. Older
screens keep their slate/sky classes and `components/ui`, `components/v2` until
they move; don't mix the two systems inside one component.

1. Never write a raw colour (hex, `rgb()`, Tailwind palette classes like `gray-500` or `blue-600`). Use the CSS variables in `src/styles/tokens.css`, or the Tailwind names mapped to them.
2. Never hard-code spacing, radius or shadow values that exist as tokens (`--space-*`, `--radius-*`, `--shadow-card`).
3. Use the components in `src/components/takeoff/` before writing new UI. If a screen needs something they don't cover, build it from tokens and say so in your summary.
4. Status is always one of exactly three words: **Cleared**, **Holding**, **Grounded**. Always shown with its word and icon, never colour alone.
5. `beacon` (terracotta) is the brand colour: the one primary button per view, the progress ring's arc, keyboard focus. It never means a status or an error.
6. Code is never the first thing on a non-technical screen. It sits behind "Show the code", collapsed by default.
7. Both themes must work. Test light and dark (`data-theme` on `<html>` or the screen root, falling back to `prefers-color-scheme`).

## How it's set up here

The client is Vite, React and Tailwind 4, so the setup differs from a Next.js one.

- **Tokens** live in `src/styles/tokens.css`, imported first in `src/main.tsx`. They are scoped to the `.takeoff` class, not `:root`, while screens move over: Tailwind already uses `--radius-sm/md/lg` and `--font-sans/serif/mono` on `:root`, and changing them there would restyle every older screen. **Put `className="takeoff"` on a migrated screen's root, once.** Don't nest it (SocialCard is the one exception: it pins the light palette). When every screen has moved, the selectors can become `:root`.
- **Themes:** inside `.takeoff`, `data-theme="light"` or `"dark"` on `<html>`, the root or any inner element overrides the system setting.
- **Fonts** load from the Google Fonts link in `index.html`: Newsreader (300, 400, 500, 600, italics), Schibsted Grotesk (400, 500, 600), IBM Plex Mono. Inside `.takeoff`, `--font-serif`, `--font-sans` and `--font-mono` point at them.
- **Type styles** are global classes in `tokens.css`: `type-display`, `type-title`, `type-intent`, `type-numeral`, `type-heading`, `type-body`, `type-small`, `type-eyebrow`, `type-button`, `type-code`.
- **Tailwind** (inside `.takeoff` only): colours are `bg-paper`, `bg-paper-raised`, `bg-paper-sunk`, `text-ink`, `text-ink-muted`, `border-line`, `border-line-strong`, `bg-beacon`, `text-on-beacon`, `bg-night`, `text-on-night`, `text-night-muted`, `border-line-night`, `text-title-accent`, and `cleared`/`holding`/`grounded` with `-soft` and `-glow`. `rounded-sm/md/lg` and `font-sans/serif/mono` switch to the tokens automatically. Spacing has no class of its own, so write `p-(--space-5)`, `gap-(--space-3)`; pill corners are `rounded-full`; the card shadow is `shadow-(--shadow-card)`. Don't use the default palette.
- **Components** are typed React with CSS Modules, one file each, exported from `src/components/takeoff/index.ts`. No new UI libraries.
- **Review page:** `/design` renders every component in every state, with a System / Light / Dark switch (`?theme=dark` also works). It exists only in development; the import is dropped from production builds.
- **App chrome:** `<Header variant="takeoff">` and `<UserMenu variant="takeoff">` are the token-styled header and account menu for moved screens. The other variants stay for screens that haven't moved.
- **Screen previews:** a moved screen that needs a signed-in API gets a presentational view (for example `DashboardView`) and a dev-only preview with made-up data, such as `/design/dashboard` (`?state=projects|empty|error|loading|legacy`).
- **Moved so far:** Dashboard (`pages/Dashboard.tsx`, card in `pages/dashboard/ProjectCard.tsx`).

## Three voices, three typefaces

| Voice | Who's speaking | Font variable | Family |
| --- | --- | --- | --- |
| Intent | The person: their plan, their words | `--font-serif` | Newsreader |
| Takeoff | Explanations, labels, buttons | `--font-sans` | Schibsted Grotesk |
| Code | What the AI wrote | `--font-mono` | IBM Plex Mono |

- Anything the person wrote is shown in the serif, verbatim. Never paraphrase or truncate it.
- Takeoff's explanations are sans, in `--ink-muted` when they sit under an intent.

| Style | Family | Size / line height | Weight | Use |
| --- | --- | --- | --- | --- |
| `display` | serif | 56px / 60px | 300 · -0.01em | Page titles and the verdict word. One per screen. |
| `title` | serif | 32px / 38px | 400 | Section titles. |
| `intent` | serif | 20px / 30px | 400 | Anything the person wrote: their plan, each intent. |
| `numeral` | serif | 40px / 44px | 300 | The ring's count and other big numbers. |
| `heading` | sans | 17px / 24px | 600 | Card headings, panel row labels. |
| `body` | sans | 15px / 24px | 400 | Takeoff's own explanations. |
| `small` | sans | 13px / 18px | 400 | Metadata and hints. |
| `eyebrow` | sans | 11px / 16px | 600 · 0.16em | Uppercase labels above a block, capitalised by CSS. |
| `button` | sans | 14px / 20px | 600 · 0.02em | Button labels. |
| `code` | mono | 13px / 20px | 400 | Code, only inside a ChangeNote peek, collapsed by default. |

- One `display` per screen. Uppercase labels use `eyebrow`; write the text in sentence case and let `text-transform` capitalise it.
- Number things ("Intent 02", "02 / 05") only when order means something.
- Big numbers use tabular figures (`font-variant-numeric: tabular-nums`).

## Colour

- Page background `--paper`; cards `--paper-raised` with `--shadow-card`; tracks and wells `--paper-sunk`.
- Text `--ink`; secondary text `--ink-muted`.
- Hairlines `--line`; visible control edges (inputs, quiet buttons) `--line-strong`.
- Text on a beacon fill is `--on-beacon`, never white.
- `--title-accent` (ink blue) is for project and repo names used as titles, like the dashboard's card titles, so they stand out from the card's text. It is never a status, a button, a link or an error. Added 2026-10-29; the design system artifact doesn't have it yet.
- Status pairs: `--cleared` on `--cleared-soft`, `--holding` on `--holding-soft`, `--grounded` on `--grounded-soft`.
- `--night` is reserved for the VerdictPanel, the one dark block on a light page. Text on it is `--on-night` / `--night-muted`; status marks on it use `--cleared-glow`, `--holding-glow`, `--grounded-glow`.
- Focus: `outline: 2px solid var(--focus); outline-offset: 2px;` on every interactive element. `tokens.css` already applies it to `.takeoff :focus-visible`.

## Words

Write as Takeoff speaking to "you". Short sentences, sentence case, no exclamation marks, no emoji. Buttons start with a verb and say exactly what happens ("Approve and merge", "See what changed").

| Say | Not |
| --- | --- |
| change | diff, commit, PR |
| your plan, flight plan | spec, `takeoff.yaml`, config |
| check | CI, run, job |
| goes live | deploy, merge to main |
| Cleared / Holding / Grounded | passed, warning, failed, error |

- Status hints on first use in a screen: Cleared "Matches your plan", Holding "Partly matches. Take a look", Grounded "Doesn't match your plan" (`<StatusMark showHint />`).
- Explanations describe what someone would notice in the app ("Guests are not offered the option"), never what the code does ("saveCard() is gated on session").
- Flight language stops at Cleared, Holding, Grounded, "flight plan" and "takeoff". No "turbulence", "landing", "co-pilot".
- Marketing uses real quotes and real figures only. Never invent testimonials or statistics, including as placeholder copy that could ship.

## Components (`src/components/takeoff/`)

Props here are the contract. Keep names and values exactly.

| Component | Props | Notes |
| --- | --- | --- |
| `Button` | `variant: 'primary' \| 'quiet' \| 'night'` (required), `size?: 'md' \| 'sm'`, `wide?`, button attrs | Pill. 44px tall (36px `sm`). One `primary` per view; `night` only inside VerdictPanel. |
| `ButtonLink` | Same as `Button`, plus react-router `Link` props (`to`, …) | A link that looks like a Button, for actions that go to another page. Same one-primary rule. |
| `StatusMark` | `status: 'cleared' \| 'holding' \| 'grounded'`, `showHint?`, `hint?` | Chip: icon + word on the `-soft` ground, pill radius, 13px semibold. |
| `IntentCard` | `intent`, `status`, `explanation?`, `changes?`, `index?` | Eyebrow "Intent 02", intent in serif 20/30, explanation muted, footer "Checked against N changes" + StatusMark. `radius-lg`, `space-5` padding. |
| `ConformanceRing` | `cleared`, `total`, `label?` (default "Intents cleared"), `size?` (200), `strokeWidth?` (12) | Beacon arc on `paper-sunk` track, starts at 12 o'clock, knob at the arc end, fills on load. Count "5 of 6" in serif at ~20% of diameter, shrinking for long counts; label scales 9 to 16px. Under 96px, shows text instead. |
| `ChangeNote` | `summary`, `status?`, `where?`, `code?`, `defaultOpen?` | Plain sentence first; `where` is a place in the app, never a file path; "Show the code" toggles a mono block on `paper-sunk`. |
| `VerdictPanel` | `status`, `summary?`, `counts?: {cleared, holding, grounded}`, `eyebrow?`, children (Buttons) | `night` surface, `radius-lg`, `space-6` padding, max 360px. Status word in serif 44px with icon; count rows with glow dots; max two actions. |
| `PlanInput` | `label?` (default "Your flight plan"), `hint?`, textarea attrs | Serif 20/30 textarea, `radius-md`, `line-strong` border. One intent per line; never ask for YAML. |
| `Roadmap` | `stages: {kind: 'live' \| 'now' \| 'next' \| 'later', name?, when?, items: {title, note?, status?}[]}[]`, `title?`, `eyebrow?` | Always renders all four stages in order, "Nothing here yet" when empty. Line is solid beacon through Live, dashed through Now, then neutral. Live/Now items are raised cards with status; Next/Later are outlined and never show a status. Stacks on a vertical line under 720px. |
| `SocialCard` | `format: 'square' \| 'portrait' \| 'story' \| 'landscape'`, `kind: 'quote' \| 'versus' \| 'stat' \| 'tip' \| 'feature' \| 'screen'`, `tone: 'paper' \| 'night' \| 'beacon'`, content props, `scale?` | Drawn at export size (1080×1080, 1080×1350, 1080×1920, 1200×627) and scaled for display; always the light palette. Story keeps text out of the top 250px and bottom 340px. Marketing only. Its export-pixel sizes are the one place off-scale values are allowed. |

Status icons (`StatusIcon`) are inline 16px SVGs with a 2px round stroke: a check (cleared), a looping holding line (holding), a cross (grounded). Draw any new icon the same way. There is no logo yet: set "Takeoff" in Newsreader.

## Screen patterns

- **Results:** narrow left rail; a reading column about 640px wide with the ConformanceRing, then IntentCards in plan order, each followed by its ChangeNotes; the VerdictPanel in a right column. On phones the VerdictPanel moves to the top and everything stacks.
- **Plan:** PlanInput with a hint, one primary "Check my plan" button.
- **Roadmap:** Roadmap full width, stages in order Live, Now, Next, Later, all four shown even when empty.
- Spacing: cards pad `--space-5`, panels `--space-6`, sections sit `--space-7` apart, page gutter at least `--space-4`.
- Motion: only the ring filling on load and button hover states. Respect `prefers-reduced-motion`.

## Moving existing screens over

- One screen per task. Order: results, plan, roadmap, then everything else non-technical. Technical surfaces last.
- For each screen: add `className="takeoff"` to its root; replace hard-coded colours and sizes with tokens (search for `#`, `rgb(`, `hsl(`, and Tailwind palette classes); swap ad-hoc UI for the components; rewrite copy with the glossary above; then check both themes and a 400px-wide viewport.
- A moved screen follows the system's dark mode. If the app shell around it is still light-only, say so in your summary.
- Don't change behaviour or data flow while restyling. If the design needs a behaviour change, stop and ask.

## Before you finish any UI task

- [ ] No raw colours or off-scale spacing in the diff.
- [ ] Person's words in serif, Takeoff's in sans, code only behind "Show the code".
- [ ] Status only as Cleared / Holding / Grounded, with word and icon.
- [ ] At most one primary (beacon) button in the view.
- [ ] Copy uses the glossary; no jargon on non-technical screens.
- [ ] Works in light and dark, at 400px wide, with keyboard focus visible.
- [ ] Text contrast at least 4.5:1 (3:1 for 24px+ text, borders and icons). The token pairs listed under Colour already meet this; new pairings must be checked.
