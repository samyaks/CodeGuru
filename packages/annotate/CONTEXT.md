# Takeoff Annotate — Build Context

## What this is

A standalone, zero-backend feedback/annotation layer that can be dropped onto
any web app (React component or script tag). Users pin comments to specific
elements, organize feedback into named sessions, and share via URL-encoded
state. No accounts, no database, no server — the URL is the database.

This package lives at `packages/annotate/` inside the CodeGuru monorepo,
alongside `packages/auth/` and `packages/sse/`.

## Who it's for

Non-technical builders (PMs, designers, founders) who build frontend
prototypes with Cursor, Bolt, Lovable, or Claude Code and need a way to
collect structured feedback from teammates before wiring up the backend.

## Why it exists

1. It solves a real pain point — there's no Figma-style commenting for
   live web prototypes
2. It's the top-of-funnel wedge for Takeoff — every reviewer sees the
   Takeoff brand, and when the builder needs auth/db/deploy, Takeoff is
   already there
3. It validates Takeoff's packaging model — if we can ship a clean,
   standalone npm package, that proves the `packages/` architecture works

---

## Architecture

```
packages/annotate/
├── src/
│   ├── core/
│   │   ├── types.ts            ← Shared types (Pin, Session, Reply, etc.)
│   │   ├── session.ts          ← Session engine: create, encode, decode, merge
│   │   ├── pins.ts             ← Pin CRUD: add, reply, resolve, delete
│   │   └── element-context.ts  ← DOM element capture: tag, classes, selector path
│   ├── react/
│   │   ├── TakeoffAnnotate.tsx  ← Main wrapper component (provider)
│   │   ├── FloatingPill.tsx     ← Mode switcher (clean/review/annotate)
│   │   ├── Pin.tsx              ← Individual pin marker
│   │   ├── CommentBubble.tsx    ← Thread popup (comment + replies)
│   │   ├── NewCommentInput.tsx  ← Textarea for new comments
│   │   ├── FeedbackPanel.tsx    ← Side panel listing all threads
│   │   ├── SessionBar.tsx       ← Session name, share button, new round
│   │   ├── NamePrompt.tsx       ← One-time name capture modal
│   │   ├── ShareModal.tsx       ← Share URL modal with copy button
│   │   └── AnnotateIndicator.tsx← Top bar in annotate mode
│   ├── vanilla/
│   │   ├── mount.ts             ← Auto-mount for script tag usage
│   │   └── wrapper.tsx          ← Thin React wrapper that mounts to a shadow DOM
│   └── index.ts                 ← Package exports
├── package.json
├── tsconfig.json
├── vite.config.ts               ← Dual build: ESM + UMD
├── README.md
└── .context.md                  ← This package's own context file
```

### Key design decisions

1. **Core is framework-agnostic.** `core/` has zero React imports. It's pure
   TypeScript — session encoding, pin CRUD, element context capture. This
   means we can later wrap it for Vue, Svelte, or a browser extension without
   rewriting logic.

2. **React components are the primary distribution.** Most Takeoff users build
   with Next.js in Cursor. The React component is what they'll import.

3. **Vanilla wrapper uses Shadow DOM.** The script-tag version mounts a React
   root inside a shadow DOM container so it doesn't inherit or leak styles
   from the host page. This is critical — the annotation layer must look
   consistent regardless of what CSS the host app has.

4. **State lives in URL hash.** All session state (pins, replies, session name)
   is compressed and stored in the URL hash fragment. This means:
   - No backend needed
   - Sharing = copying a URL
   - Browser back button navigates session history
   - Hash changes don't trigger page reloads

5. **Three modes, not two.** Clean (invisible), Review (read-only + reply),
   Annotate (full creation). This maps to three real use cases: stakeholder
   demo, morning review, active feedback session.

6. **Name prompt fires once, stores in localStorage.** When someone first
   tries to annotate, they enter their name. It persists across sessions on
   that device. Key: `takeoff_annotate_username`.

---

## Core: types.ts

```typescript
export interface Pin {
  id: string;
  x: number;              // px from left edge of annotate surface
  y: number;              // px from top edge of annotate surface
  text: string;           // comment body
  author: string;         // display name
  timestamp: number;      // Date.now() when created
  elementContext: ElementContext | null;
  replies: Reply[];
  resolved: boolean;
}

export interface Reply {
  author: string;
  text: string;
  timestamp: number;
}

export interface ElementContext {
  tag: string;            // e.g. "div"
  classes: string[];      // e.g. ["stat-card", "p-4"]
  selector: string;       // e.g. "div.stat-card > h3"
  textContent: string;    // first 50 chars of innerText (for identification)
  rect: {                 // bounding rect at time of capture
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface Session {
  id: string;
  name: string;
  created: number;
  pins: Pin[];
}

export type AnnotateMode = "clean" | "review" | "annotate";

export interface AnnotateConfig {
  projectId?: string;       // optional — for future Takeoff cloud linking
  theme?: "dark" | "light" | "auto";
  defaultMode?: AnnotateMode;
  position?: "bottom-right" | "bottom-left";
  onShare?: (url: string) => void;   // callback when share is triggered
  onExport?: (session: Session) => void; // callback for custom export
}
```

## Core: session.ts

The session engine handles encoding/decoding state to/from URL hash,
and merging two sessions (when two reviewers share their URLs back).

### Encoding strategy

Session state → JSON → compress → base64url → URL hash fragment.

For v1, use a simple approach:
- `JSON.stringify()` the session
- Minify keys to save space (map to single chars)
- `btoa(encodeURIComponent(json))` for encoding
- Prefix with `tf=` in the hash: `#tf=eyJu...`

Key minification map:
```
Session: { n: name, c: created, p: pins[] }
Pin:     { x, y, t: text, a: author, s: timestamp, e: elementContext, r: replies[], d: resolved }
Reply:   { a: author, t: text, s: timestamp }
Element: { g: tag, l: classes[], q: selector, x: textContent }
```

This gets a typical 10-pin session to ~2-3KB encoded, well within URL limits.

### Session merge

When two reviewers annotate separately, they each get a URL with different pins.
The merge function combines them:

```typescript
function mergeSessions(a: Session, b: Session): Session {
  // 1. Deduplicate by pin ID
  // 2. For pins that exist in both, merge replies (union by timestamp+author+text)
  // 3. If resolved status differs, prefer resolved=true (once resolved, stays resolved)
  // 4. Session name comes from whichever was created first
  // 5. Return combined session
}
```

### URL read/write

```typescript
// On page load: check for #tf= in hash → decode → hydrate state
function readSessionFromURL(): Session | null

// After any state change: encode → write to hash (replaceState, not pushState)
function writeSessionToURL(session: Session): void

// Generate a full shareable URL (current origin + path + #tf=...)
function getShareableURL(session: Session): string
```

## Core: pins.ts

Pure functions for pin manipulation:

```typescript
function createPin(x, y, text, author, elementContext): Pin
function addReply(pin, text, author): Pin
function resolvePin(pin): Pin
function reopenPin(pin): Pin
function deletePin(pins, pinId): Pin[]
```

## Core: element-context.ts

When the user clicks to place a pin, capture info about the DOM element:

```typescript
function captureElementContext(
  event: MouseEvent,
  surfaceElement: HTMLElement
): ElementContext | null {
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (!target || target === surfaceElement) return null;

  return {
    tag: target.tagName.toLowerCase(),
    classes: Array.from(target.classList).slice(0, 5),
    selector: buildSelector(target),  // e.g. "div.card > h3.title"
    textContent: (target.textContent || "").trim().slice(0, 50),
    rect: target.getBoundingClientRect().toJSON(),
  };
}
```

The `buildSelector` function walks up the DOM (max 3 levels) building a
CSS-like path: `tag.firstClass > tag.firstClass > tag.firstClass`.
This is displayed in the comment bubble as the element badge and is
useful for the builder to know exactly what UI element was referenced.

---

## React: TakeoffAnnotate.tsx (main component)

This is the wrapper component users import. It provides context and
renders the overlay layer on top of children.

```tsx
export function TakeoffAnnotate({
  children,
  projectId,
  theme = "auto",
  defaultMode = "clean",
  position = "bottom-right",
  onShare,
  onExport,
}: PropsWithChildren<AnnotateConfig>) {
  // State
  const [mode, setMode] = useState<AnnotateMode>(defaultMode);
  const [session, setSession] = useState<Session>(() =>
    readSessionFromURL() || createSession("Feedback Round 1")
  );
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [userName, setUserName] = useState<string | null>(
    () => localStorage.getItem("takeoff_annotate_username")
  );

  // Sync state to URL hash on every change
  useEffect(() => {
    writeSessionToURL(session);
  }, [session]);

  // On mount: read session from URL if present, set mode to review
  useEffect(() => {
    const fromURL = readSessionFromURL();
    if (fromURL) {
      setSession(fromURL);
      setMode("review"); // arriving via shared link → show pins
    }
  }, []);

  return (
    <AnnotateContext.Provider value={{ session, mode, userName, ... }}>
      <div ref={surfaceRef} style={{ position: "relative" }}
           onClick={handleSurfaceClick}>
        {children}
        {/* Overlay layer — pins, bubbles, input */}
        <PinLayer />
      </div>
      {/* Outside the surface — not affected by clicks */}
      <FloatingPill />
      {mode !== "clean" && <SessionBar />}
      {mode === "annotate" && <AnnotateIndicator />}
      <FeedbackPanel />
      {showNamePrompt && <NamePrompt />}
      {showShareModal && <ShareModal />}
    </AnnotateContext.Provider>
  );
}
```

### Mode behaviors

| Action                    | Clean     | Review       | Annotate        |
|---------------------------|-----------|-------------|-----------------|
| Pins visible              | No        | Yes          | Yes             |
| Click pin to open thread  | —         | Yes          | Yes             |
| Reply to thread           | —         | Yes          | Yes             |
| Resolve/reopen            | —         | No           | Yes             |
| Click surface to place    | Pass-thru | Deselect pin | New pin         |
| Session bar visible       | No        | Yes          | Yes             |
| Feedback panel accessible | No        | Yes          | Yes             |
| Cursor style              | Default   | Default      | Crosshair       |
| Annotate indicator bar    | No        | No           | Yes             |
| Pill appearance            | Tiny dot  | Full pill    | Full pill       |

### Keyboard shortcuts (optional, add if time)

- `Escape` — deselect pin / cancel pending comment / close panel
- `1` / `2` / `3` — switch modes (clean/review/annotate)

---

## React: FloatingPill.tsx

The mode switcher lives in the bottom-right corner.

**In Clean mode:** Renders as a tiny semi-transparent dot (30×30px, 45% opacity,
subtle hover → 100% opacity + scale). Clicking expands to the full pill.

**In Review/Annotate mode:** Full pill with:
- Takeoff logo (T in red circle)
- Three mode buttons: Clean (◯), Review (◉), Annotate (✎)
- Divider
- Feedback panel toggle with open-count badge

Switching to Clean collapses back to the dot.

**Positioning:** Fixed to bottom-right (or bottom-left via config). 16px inset.
z-index: 10010 (above everything else).

---

## React: SessionBar.tsx

Thin bar at the top of the viewport (sticky). Only visible in review/annotate.

Contents:
- Green dot (live indicator) + session name (click to rename inline)
- Pin count
- "⤴ Share Session" button → opens ShareModal
- "+ New Round" button → prompts for name, clears pins, starts fresh session

When "+ New Round" is clicked:
1. If current session has pins, encode it to URL and offer to copy first
2. Create new session with user-provided name
3. Clear all pins
4. Keep the same user name

---

## React: ShareModal.tsx

Modal overlay with:
- Title: `Share "{session.name}"`
- Subtitle: "Anyone with this link can view and add feedback"
- URL display (monospace, truncated with ellipsis)
- Copy button (→ "Copied!" state for 2.5s)
- "How sharing works" explainer (4 steps)
- Upgrade teaser: "No backend needed. For persistent sync, connect a
  Takeoff project." (links to takeoff.dev when it exists)

The URL is generated by `getShareableURL(session)`.

---

## React: Pin.tsx

Visual pin marker. Teardrop shape (CSS border-radius trick or SVG path).

- 26×26px, rotated 45deg for the teardrop effect
- Numbered (index + 1) in white text centered inside
- Red (#f43f5e) for open, gray (#4b5563) for resolved
- Reply count badge (top-right circle) when replies > 0 and not active
- Scale 1.18× when active, with box-shadow ring
- opacity 0.4 when resolved
- Hidden entirely in Clean mode
- onClick → setActivePinId (only in review/annotate)

---

## React: CommentBubble.tsx

Popup anchored to the active pin (pin.x + 16, pin.y + 6).

Contents:
- Header: avatar circle (color from author name hash) + author + timestamp + close ×
- Comment body
- Element context badge (if captured): `◎ <div>.stat-card`
- Reply thread (if replies exist)
- Reply input (text input + Send button)
- Resolve/Reopen button (only in Annotate mode)

Animation: scale from 0.92 + translateY(6px) → 1,0 over 180ms cubic-bezier.

**Reply handling:** When user submits a reply:
1. Check userName exists (should always be set by this point)
2. Add reply to pin via `addReply()`
3. Update session state → triggers URL hash update
4. Clear input

---

## React: NewCommentInput.tsx

Appears at the click position when user clicks surface in Annotate mode.

Shows:
- Floating pin preview (the next number)
- Author avatar + name
- Textarea (autoFocus, 2 rows)
- Element context badge
- Cancel + Comment buttons

On submit:
1. Create pin via `createPin()`
2. Add to session
3. Set as active pin
4. Clear pending click state

On cancel or Escape:
1. Clear pending click state

---

## React: FeedbackPanel.tsx

Slide-in panel from the right edge. Width: 270px. Transition: 220ms.

Sections:
- Open threads (sorted by timestamp, newest first)
- Resolved threads (collapsed, lower opacity)
- Empty state when no pins

Each thread row shows:
- Pin number badge
- Author name
- Comment text (truncated, single line)
- Reply count
- Click → set active pin + scroll to it (if possible)

---

## React: NamePrompt.tsx

Full-screen modal overlay (backdrop blur). Appears once on first annotate click.

Fields:
- Name input (autoFocus)
- "Start reviewing" button (disabled until name entered)
- Subtext: "Stored locally — never leaves your device"

On submit:
1. Save to localStorage: `takeoff_annotate_username`
2. Set userName in state
3. Dismiss modal
4. Continue with the click that triggered it (the pending annotate click
   should be preserved, not lost)

---

## React: AnnotateIndicator.tsx

Slim bar (sticky top, below session bar). Only in Annotate mode.

Contents:
- Pulsing red dot (CSS animation)
- "Click anywhere to leave feedback"
- "as **{userName}**" (if set)

Background: rgba(244,63,94,0.05) with bottom border.

---

## Vanilla: mount.ts

For script-tag usage. Auto-initializes from data attributes:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@takeoff/annotate/dist/annotate.min.js"
  data-project="optional-project-id"
  data-theme="dark"
  data-mode="clean"
  data-position="bottom-right"
  defer
></script>
```

On DOMContentLoaded:
1. Read data attributes from the `<script>` tag
2. Create a shadow DOM container appended to `<body>`
3. Mount `<TakeoffAnnotate>` wrapping `document.body` equivalent
4. The annotation layer sits on top of the entire page

The vanilla version wraps the entire page in an overlay div that captures
clicks in Annotate mode. It doesn't wrap `<body>` children — it layers
on top with `position: fixed; inset: 0; pointer-events: none` and enables
pointer-events only in annotate mode.

---

## Build configuration

### package.json

```json
{
  "name": "@takeoff/annotate",
  "version": "0.1.0",
  "description": "Drop-in feedback and annotation layer for web prototypes",
  "main": "dist/index.cjs.js",
  "module": "dist/index.esm.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.esm.js",
      "require": "./dist/index.cjs.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "peerDependencies": {
    "react": ">=17.0.0",
    "react-dom": ">=17.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true }
  },
  "devDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vite-plugin-dts": "^3.0.0"
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit"
  }
}
```

### vite.config.ts

Dual build:
- **ESM** (for React import): tree-shakable, react as external
- **UMD** (for script tag): bundles React, self-contained, global `TakeoffAnnotate`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [react(), dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        vanilla: "src/vanilla/mount.ts",
      },
      formats: ["es", "cjs", "umd"],
      name: "TakeoffAnnotate",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
});
```

Note: The UMD build for vanilla usage needs to INCLUDE React (not external).
This requires a separate build config or a dedicated vanilla entry that
bundles react + react-dom. Size target: < 80KB gzipped for the vanilla bundle.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "declaration": true,
    "declarationDir": "dist",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

---

## Styling approach

All styles are inline via `style={{}}` props — no external CSS files.
This ensures the component works without any build configuration and
doesn't conflict with host app styles.

For the vanilla/shadow-DOM version, styles are injected into the shadow root.

Color values should support both light and dark themes. For v1, use
hardcoded dark theme values (matching the prototype) with a plan to
add light theme in v2.

---

## What NOT to build yet

- **Takeoff cloud sync** — no backend, no persistence beyond URL state
- **Real-time collaboration** — not needed until cloud tier
- **Export to Linear/GitHub Issues** — add via `onExport` callback for now
- **Screenshot capture** — complex, deferred to v2
- **Cursor extension integration** — separate package, later
- **Light theme** — dark-only for v1, add light theme in v2
- **Pin position anchoring to elements** — pins use absolute x/y for v1;
  anchoring to specific DOM elements (so pins survive layout changes)
  is a v2 feature
- **Session history / undo** — v2

---

## Testing strategy

Manual testing for v1:
1. Import in a Next.js app, verify three modes work
2. Place 10+ pins, verify URL encoding stays under 4KB
3. Share URL to a different browser, verify session loads
4. Two people annotate separately, verify merge works
5. Test on mobile viewport (pill should be touchable)
6. Test with Tailwind CSS app (no style leaking)
7. Test script tag on a static HTML page

---

## Build order

### Step 1: Core engine (no UI)
Build `core/types.ts`, `core/session.ts`, `core/pins.ts`, `core/element-context.ts`.
Test with plain TypeScript — create sessions, encode/decode, merge.

### Step 2: React components (the UI)
Build each component from the prototype. Start with TakeoffAnnotate.tsx
(the wrapper), then FloatingPill, then Pin + CommentBubble, then the rest.
Use the v3 prototype artifact as the visual reference — the styling is
already dialed in.

### Step 3: Session <-> URL wiring
Wire up the URL hash read/write. On mount, check for #tf= and hydrate.
On every state change, write to hash. Test sharing between tabs.

### Step 4: Vanilla wrapper
Build mount.ts and wrapper.tsx. Test with a plain HTML page and a
<script> tag. Verify shadow DOM isolation.

### Step 5: Build + publish
Configure Vite for dual build. npm publish as @takeoff/annotate.
Host UMD bundle on CDN (jsdelivr picks up npm packages automatically).

---

## Reference prototype

The v3 prototype artifact (takeoff-annotate-v3.jsx) is the visual
specification. Every component's appearance, animation, interaction,
and layout is defined there. When building the React components, match
the prototype's styling exactly — same colors, same border-radius,
same font sizes, same animations.

Key visual specs from the prototype:
- Pin: #f43f5e (open), #4b5563 (resolved), teardrop via border-radius
- Bubble: #181825 background, 12px border-radius, 268px width
- Pill: rgba(24,24,37,0.92) background, 28px border-radius, backdrop-blur
- Session bar: rgba(255,255,255,0.02) background
- Panel: #111120 background, 270px width
- Font: DM Sans (body), DM Mono (code/labels)
- Accent: #f43f5e (Takeoff red)
- Animations: cubic-bezier(0.34, 1.56, 0.64, 1) for popups, 180ms duration
