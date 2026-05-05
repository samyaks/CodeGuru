# Product Requirements Document (PRD)
## UpdateAI - Collaborative AI Prompt Workspace

**Version:** 1.0.0  
**Last Updated:** January 27, 2026  
**Status:** Prototype / MVP

---

## Executive Summary

UpdateAI is a **collaborative prompt engineering workspace** that enables teams to:
1. **Capture context** from tools they already use (Jira, Slack, Google Docs)
2. **Collaboratively build prompts** with multiple team members
3. **Generate multiple AI perspectives** from different contributors
4. **Produce production-ready code** that combines everyone's expertise

---

## Product Components

### Component 1: Chrome Extension (Context Capture)

**Purpose:** Capture context from web-based tools as users work

**Current Status:** ✅ Working (Offline Mode)

#### Features Implemented:

| Feature | Status | Description |
|---------|--------|-------------|
| Project Tracking | ✅ Working | Create projects to group related links |
| Page Detection | ✅ Working | Detects Google Docs, Jira, Slack pages |
| Link Management | ✅ Working | Add/remove links to projects |
| Badge Notifications | ✅ Working | Shows "new" (1), "add" (+), or count |
| Local Storage | ✅ Working | Persists projects and captures in chrome.storage.local |
| Text Capture UI | 🟡 Partial | Content scripts exist, capture button planned |

#### Supported Platforms:

| Platform | Page Detection | Text Capture |
|----------|---------------|--------------|
| Google Docs | ✅ Detects doc title & URL | 🟡 Content script exists |
| Google Sheets | ✅ Detects sheet title & URL | 🟡 Content script exists |
| Google Slides | ✅ Detects presentation title & URL | 🟡 Content script exists |
| Jira (Atlassian) | ✅ Detects ticket title & URL | 🟡 Content script exists |
| Slack | ✅ Detects channel/DM | 🟡 Content script exists |

#### Technical Implementation:

**Manifest V3 Configuration:**
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "tabs", "activeTab", "alarms", "notifications"],
  "background": { "service_worker": "src/background/service-worker-simple.js" },
  "content_scripts": [
    { "matches": ["https://docs.google.com/*"], "js": ["google-detector.js"] },
    { "matches": ["https://*.atlassian.net/*"], "js": ["jira-detector.js"] },
    { "matches": ["https://*.slack.com/*"], "js": ["slack-detector.js"] }
  ]
}
```

**Data Model (chrome.storage.local):**
```javascript
// Project Structure
{
  project: {
    name: "Q1 Platform Redesign",
    links: [
      {
        title: "PROJ-124: Payment Integration",
        url: "https://company.atlassian.net/browse/PROJ-124",
        platform: "jira",
        icon: "📋",
        addedAt: 1706380800000
      }
    ],
    createdAt: 1706380800000
  },
  captures: [
    {
      type: "jira",
      source: "PROJ-124",
      content: "Selected text from the ticket...",
      url: "https://...",
      timestamp: 1706380800000
    }
  ]
}
```

---

### Component 2: Workspace Web App (Collaborative Prompt Builder)

**Purpose:** Multi-user prompt workspace with AI generation

**Current Status:** ✅ Working Prototype (Simulated Collaboration)

#### Features Implemented:

| Feature | Status | Description |
|---------|--------|-------------|
| Dual Prompt Editors | ✅ Working | Side-by-side prompt areas for 2 users |
| Simulated Collaboration | ✅ Working | Auto-typing simulation when you type 30+ chars |
| Context File Management | ✅ Working | Add, remove, view context files |
| Collapsible Sidebar | ✅ Working | Toggle with button or Cmd+B |
| Three-Version Generation | ✅ Working | Your version, Friend's version, Combined |
| Copy/Export | ✅ Working | Copy to clipboard or download as file |
| Keyboard Shortcuts | ✅ Working | Cmd+Enter (generate), Cmd+B (sidebar) |
| Toast Notifications | ✅ Working | Success, warning, error, info states |

#### User Flow:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. USER OPENS WORKSPACE                                         │
│    → Workspace loads with sample context files                  │
│    → Two empty prompt areas (You | Alex)                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. USER TYPES IN LEFT PROMPT AREA                               │
│    → Character count updates                                    │
│    → After 30+ characters, Alex starts auto-typing in right     │
│    → Toast: "💬 Alex is typing..."                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ALEX'S PROMPT AUTO-FILLS (Simulated)                         │
│    → Character-by-character animation (30-100ms per char)       │
│    → Adds error handling, edge cases, requirements              │
│    → Toast: "✓ Alex added suggestions"                          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. USER CLICKS "GENERATE" (or Cmd+Enter)                        │
│    → Output panel slides in from right                          │
│    → Three versions generate sequentially:                      │
│      1. Your Version (1.5s) - Based on left prompt              │
│      2. Alex's Version (2.5s) - Based on right prompt           │
│      3. Combined (3.5s) - Merges both perspectives              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. USER REVIEWS & EXPORTS                                       │
│    → Switch between 3 version tabs                              │
│    → Copy to clipboard                                          │
│    → Download as text file                                      │
└─────────────────────────────────────────────────────────────────┘
```

#### UI Layout:

```
┌────────────────────────────────────────────────────────────────────┐
│  [U] UpdateAI    "Project Name"  ● Draft    [Y][A][+]   [Generate] │
├──────────┬─────────────────────────────────────┬───────────────────┤
│📁 Context│  ┌─────────────────┬───────────────┐│  🎯 Generated     │
│          │  │[Y] Your Prompt  │[A] Alex's     ││     Versions      │
│  [+] [◀] │  │   50 chars      │   87 chars    ││                   │
│          │  ├─────────────────┼───────────────┤│ [Your] [Alex]     │
│ 📋 Jira  │  │                 │               ││     [Combined]    │
│ 💬 Slack │  │ Build an API... │ Add error...  ││                   │
│ 📄 Docs  │  │                 │               ││ # Your Version    │
│          │  │                 │               ││ ```javascript     │
│          │  │                 │               ││ const stripe =... │
│[Export]  │  └─────────────────┴───────────────┘│ ```               │
│          │                                     │ [📋 Copy] [💾 Save]│
└──────────┴─────────────────────────────────────┴───────────────────┘
```

#### Technical Implementation:

**State Management:**
```javascript
const state = {
  contextFiles: [],           // Array of context file objects
  yourPrompt: '',             // Left prompt text
  friendPrompt: '',           // Right prompt text
  collaborators: [
    { id: 1, name: 'You', initial: 'Y', color: '#ef4444' },
    { id: 2, name: 'Alex', initial: 'A', color: '#3b82f6' }
  ],
  isGenerating: false,        // Prevents double-generate
  friendTypingTimeout: null   // Auto-typing timer
};
```

**Context File Structure:**
```javascript
{
  id: 1706380800000.123,
  name: "Jira Requirements",
  content: "PROJ-124: Implement Stripe payment integration...",
  icon: "📋",
  addedAt: 1706380800000
}
```

---

## Feature Details

### F1: Dual Prompt Editors

**What it does:**
- Two side-by-side text areas
- Left: Your prompt (red avatar "Y")
- Right: Collaborator's prompt (blue avatar "A")
- Independent character counts

**Why it matters:**
- Clear ownership of contributions
- Visual collaboration
- Different perspectives visible at once

### F2: Auto-Typing Simulation

**What it does:**
- After user types 30+ characters in their area
- Alex automatically starts typing in the right area after 2 seconds
- Character-by-character animation (realistic typing)
- Three random suggestion templates (error handling, edge cases, requirements)

**Why it matters:**
- Demonstrates real-time collaboration concept
- Shows how AI can assist with prompt engineering
- Creates engaging demo experience

### F3: Three-Version Generation

**What it does:**
- **Your Version:** Uses only your (left) prompt
  - Clean, straightforward implementation
  - Focuses on core functionality
  
- **Alex's Version:** Uses only Alex's (right) prompt
  - Enhanced error handling
  - Idempotency keys
  - Structured logging
  - Production safeguards

- **Combined Version:** Merges both prompts
  - Shows both prompts clearly
  - Incorporates best practices from both
  - Most comprehensive implementation
  - Testing checklist included

**Why it matters:**
- Multiple perspectives prevent blind spots
- Combined version is more robust
- Users can compare approaches

### F4: Collapsible Context Sidebar

**What it does:**
- Click ◀ button to collapse
- Click ▶ Context toggle to expand
- Keyboard shortcut: Cmd+B / Ctrl+B
- Smooth 0.3s animation

**Why it matters:**
- More space for prompt writing
- Focus mode when needed
- Professional UX

### F5: Context File Management

**What it does:**
- View sample context files (Jira, Slack, Docs)
- Add new context files via modal
- Remove context files
- Files shown in sidebar

**Why it matters:**
- Captures relevant information
- Provides AI with necessary context
- Centralizes project knowledge

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Enter` | Generate three versions |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Escape` | Close modals |

---

## What's NOT Implemented Yet

### Extension:
- ❌ Real text capture from pages (content scripts exist but not wired)
- ❌ Backend sync (Supabase integration coded but not deployed)
- ❌ User authentication
- ❌ Cross-device sync

### Workspace:
- ❌ Real-time collaboration (WebSocket/Y.js not connected)
- ❌ Real AI generation (uses templates, not API)
- ❌ Multiple collaborators (3+)
- ❌ Workspace persistence (refreshing loses data)
- ❌ Import from Chrome extension
- ❌ User accounts

---

## File Structure

```
code-visualizer-mvp/
├── knowledge-graph-extension/           # Chrome Extension
│   ├── manifest.json                    # Extension config
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker-simple.js # Background service
│   │   ├── content/
│   │   │   ├── google-detector.js       # Google Docs detection
│   │   │   ├── jira-detector.js         # Jira detection
│   │   │   └── slack-detector.js        # Slack detection
│   │   ├── popup/
│   │   │   ├── popup.html               # Extension popup UI
│   │   │   └── popup.js                 # Popup logic
│   │   ├── lib/
│   │   │   ├── capture-manager.js       # Reusable capture logic
│   │   │   └── project-manager.js       # Reusable project logic
│   │   ├── components/
│   │   │   ├── CaptureButton.js         # Reusable capture button
│   │   │   └── CaptureList.js           # Reusable capture list
│   │   └── utils/
│   │       └── index.js                 # Shared utilities
│   └── icons/                           # Extension icons
│
└── workspace-prototype/                 # Web App Prototype
    ├── index.html                       # Main HTML (245 lines)
    ├── styles.css                       # All styles (550+ lines)
    └── app.js                           # All logic (900 lines)
```

---

## Technical Specifications

### Chrome Extension:
- **Manifest Version:** 3
- **Storage:** chrome.storage.local (offline-first)
- **No Build Tools:** Plain JavaScript, no bundler needed
- **Browser Support:** Chrome, Chromium-based browsers

### Workspace Web App:
- **Framework:** Vanilla JavaScript (no React/Vue)
- **Styling:** Custom CSS with CSS variables
- **Fonts:** Inter (UI), JetBrains Mono (code)
- **Dependencies:** Zero (except CDN fonts)
- **Browser Support:** Modern browsers (Chrome, Safari, Firefox)

---

## Metrics & Success Criteria

### For Prototype Demo:
- ✅ Loads without errors
- ✅ All buttons work
- ✅ Three versions generate
- ✅ Copy/export functions
- ✅ Professional appearance
- ✅ Smooth animations

### For Production (Future):
- 100+ users signed up
- 80% prefer combined version
- <2s generation time (with real AI)
- 99.9% uptime
- Real-time sync <500ms latency

---

## Roadmap

### Phase 1: Current State ✅
- Basic extension with project tracking
- Workspace prototype with simulated collaboration
- Three-version generation (template-based)

### Phase 2: Real AI Integration
- Connect Claude/GPT-4 API
- Streaming responses
- Token usage tracking
- Better prompts

### Phase 3: Real Collaboration
- WebSocket server with Y.js
- Real-time cursor sharing
- Multi-user editing
- Presence awareness

### Phase 4: Production
- User authentication
- Workspace persistence (Supabase)
- Extension-to-workspace import
- Team management
- Deployment

---

## How to Test

### Extension:
```bash
1. Open Chrome → chrome://extensions
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select: knowledge-graph-extension folder
5. Visit a Google Doc, Jira ticket, or Slack
6. Click extension icon
7. Create a project
```

### Workspace:
```bash
cd workspace-prototype
python3 -m http.server 8000
# OR just double-click index.html

# Then:
1. Type in left prompt area (30+ chars)
2. Watch Alex auto-type in right
3. Click "Generate"
4. Switch between version tabs
5. Copy or download output
```

---

## Contact

**Project:** UpdateAI  
**Repository:** /Users/samyak/CodeGuru/code-visualizer-mvp/

---

## Changelog

### v2.1 (Current)
- Added collapsible sidebar
- Fixed button click handlers
- Added keyboard shortcuts

### v2.0
- Dual prompt editors
- Auto-typing simulation
- Three-version generation

### v1.0
- Initial prototype
- Single prompt editor
- Basic generation

---

**Document Status:** ✅ Reflects actual code as of January 27, 2026
