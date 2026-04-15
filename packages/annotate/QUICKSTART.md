# Quickstart — Building packages/annotate

## Setup

1. In your CodeGuru repo, create the package directory:
   ```
   mkdir -p packages/annotate/src/{core,react,vanilla}
   ```

2. Copy the spec files into `packages/annotate/`:
   - `CONTEXT.md` → the full build plan
   - `.cursorrules` → tells Claude Code / Cursor how to behave

3. Copy `takeoff-annotate-v3.jsx` into `packages/annotate/` as
   `PROTOTYPE_REFERENCE.jsx` — this is the visual spec.

## Build sequence

Work through these prompts one at a time. Each step builds on the previous.
Don't skip ahead.

---

### Step 1 — Core engine

```
Read CONTEXT.md in packages/annotate/. Build the core engine with zero
React dependencies:

1. Create src/core/types.ts with all the types from CONTEXT.md
   (Pin, Reply, ElementContext, Session, AnnotateMode, AnnotateConfig)

2. Create src/core/session.ts with:
   - createSession(name): creates a new empty session
   - encodeSession(session): compresses to base64url string using the
     minified key map from CONTEXT.md
   - decodeSession(encoded): reverse of encode, returns Session or null
   - mergeSessions(a, b): combines two sessions, deduplicating by pin ID
   - readSessionFromURL(): reads #tf= from window.location.hash
   - writeSessionToURL(session): writes to hash with replaceState
   - getShareableURL(session): returns full URL with encoded session

3. Create src/core/pins.ts with pure functions:
   - createPin(x, y, text, author, elementContext)
   - addReply(pin, text, author)
   - resolvePin(pin) / reopenPin(pin)
   - deletePin(pins, pinId)

4. Create src/core/element-context.ts with:
   - captureElementContext(event, surfaceElement): returns ElementContext
   - buildSelector(element): builds a CSS-like path (max 3 levels)

Test by importing into a scratch file and running encode/decode round trips.
```

---

### Step 2 — React wrapper + FloatingPill

```
Read CONTEXT.md in packages/annotate/. Now build the main React components.
Use PROTOTYPE_REFERENCE.jsx as the visual spec — match its styling exactly.

1. Create src/react/AnnotateContext.tsx:
   - React context providing: session, setSession, mode, setMode, userName,
     setUserName, activePinId, setActivePinId, panelOpen, setPanelOpen

2. Create src/react/TakeoffAnnotate.tsx:
   - The main wrapper component from CONTEXT.md
   - Accepts children + AnnotateConfig props
   - On mount: reads session from URL, if found sets mode to "review"
   - On session change: writes to URL hash
   - Renders children inside a relative-positioned surface div
   - onClick on surface: behavior depends on mode (see mode table in CONTEXT.md)

3. Create src/react/FloatingPill.tsx:
   - In clean mode: tiny 30x30 dot, 45% opacity, hover to reveal
   - Expanded: pill with T logo + Clean/Review/Annotate buttons + panel toggle
   - Switching to Clean collapses back to dot
   - Match prototype styling exactly: rgba(24,24,37,0.92), border-radius 28

4. Create src/index.ts exporting TakeoffAnnotate and types.
```

---

### Step 3 — Pin, CommentBubble, NewCommentInput

```
Read CONTEXT.md. Build the pin and comment components.
Match PROTOTYPE_REFERENCE.jsx styling exactly.

1. Create src/react/Pin.tsx:
   - Teardrop shape (border-radius trick: 50% 50% 50% 0 + rotate -45deg)
   - 26x26px, numbered, red when open, gray when resolved
   - Reply count badge when replies > 0 and not active
   - Scale 1.18x when active
   - Hidden in clean mode
   - onClick calls setActivePinId

2. Create src/react/CommentBubble.tsx:
   - Positioned at pin.x + 16, pin.y + 6
   - Shows: header (avatar + author + time + close), body, element badge,
     reply thread, reply input, resolve button (only in annotate mode)
   - Reply submission: adds reply to pin, updates session
   - Animation: bIn keyframe from prototype

3. Create src/react/NewCommentInput.tsx:
   - Appears at click position when user clicks surface in annotate mode
   - Shows: pin preview number, author info, textarea (autoFocus), element
     badge, cancel + comment buttons
   - On submit: creates pin, adds to session, sets as active
   - On cancel/escape: clears pending click

4. Wire Pin, CommentBubble, and NewCommentInput into TakeoffAnnotate.tsx.
   Pins should render as an overlay on top of children. CommentBubble
   appears when activePinId is set. NewCommentInput appears when there's
   a pendingClick in annotate mode.
```

---

### Step 4 — SessionBar, FeedbackPanel, modals

```
Read CONTEXT.md. Build the remaining UI components.

1. Create src/react/SessionBar.tsx:
   - Sticky top bar: green dot + session name (click to rename) + pin count
   - "Share Session" button → triggers share modal
   - "+ New Round" → prompts for name, creates new session, clears pins
   - Only visible in review + annotate modes

2. Create src/react/FeedbackPanel.tsx:
   - Slides in from right, 270px wide
   - Lists open threads (newest first) then resolved (lower opacity)
   - Each row: pin number badge, author, truncated text, reply count
   - Click row → set active pin
   - Empty state with icon + text

3. Create src/react/NamePrompt.tsx:
   - Full-screen modal with backdrop blur
   - Name input + "Start reviewing" button
   - On submit: save to localStorage (takeoff_annotate_username), set state
   - IMPORTANT: preserve the pending annotate click — don't lose it

4. Create src/react/ShareModal.tsx:
   - Shows shareable URL via getShareableURL()
   - Copy button with "Copied!" confirmation state
   - "How sharing works" explainer (4 steps)
   - Upgrade teaser text for future Takeoff cloud

5. Create src/react/AnnotateIndicator.tsx:
   - Slim bar below session bar, pulsing red dot + "Click anywhere to
     leave feedback" + author name
   - Only in annotate mode

6. Wire everything into TakeoffAnnotate.tsx. Verify the full flow:
   Clean (dot only) → click dot → Review (pins visible) →
   Annotate (crosshair, name prompt on first click, place pins) →
   Share (modal with URL) → New Round (fresh session)
```

---

### Step 5 — Vanilla wrapper + build config

```
Read CONTEXT.md. Build the script-tag distribution and packaging.

1. Create src/vanilla/wrapper.tsx:
   - Creates a shadow DOM container appended to document.body
   - Mounts TakeoffAnnotate inside the shadow root
   - The annotation layer covers the entire viewport as an overlay
   - pointer-events: none by default, enabled only in annotate mode

2. Create src/vanilla/mount.ts:
   - On DOMContentLoaded: reads data-* attributes from the <script> tag
   - Calls wrapper.tsx with parsed config
   - This is the entry point for the UMD bundle

3. Create package.json from CONTEXT.md spec.

4. Create tsconfig.json from CONTEXT.md spec.

5. Create vite.config.ts:
   - Two entry points: index (ESM/CJS) and vanilla (UMD)
   - React external for ESM/CJS, bundled for UMD
   - Target: < 80KB gzipped for UMD bundle

6. Run `npm run build` and verify outputs in dist/.

7. Test: create a plain index.html that loads the UMD bundle via
   <script> tag. Verify the annotation layer appears and works.
```

---

## Tips

- If Claude Code / Cursor generates styles that don't match the prototype,
  say: "Check PROTOTYPE_REFERENCE.jsx — the [component] should use [specific
  style values]"

- If URL encoding produces URLs longer than 4KB with 10 pins, the
  minification map isn't being applied correctly. Check session.ts.

- The surface div must be position: relative for pin positioning to work.
  Pins use position: absolute relative to the surface.

- For the vanilla wrapper, the shadow DOM is essential — without it, the
  host page's CSS will break the annotation UI. Test with a Tailwind app.

- Don't try to build the cloud sync layer. If someone asks about persistence,
  point to the URL-based sharing and the onExport callback.
