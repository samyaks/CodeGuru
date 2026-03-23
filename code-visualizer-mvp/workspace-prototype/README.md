# 🚀 UpdateAI Collaborative Workspace Prototype

A working prototype of the collaborative prompt workspace with real-time typing indicators and multi-version output generation.

## ✨ Features

### Core Functionality:
- ✅ **Dual Prompt Editors** - Side-by-side prompt areas for you and your collaborator
- ✅ **Real-time Typing Simulation** - Watch your friend type in their area automatically
- ✅ **Context File Management** - Add, view, remove context files
- ✅ **Three Version Generation:**
  - **Your Version** - Generated from YOUR prompt (left side)
  - **Friend's Version** - Generated from FRIEND'S prompt (right side)
  - **Combined Version** - Best of both prompts merged
- ✅ **Export & Copy** - Download or copy any version
- ✅ **Keyboard Shortcuts** - Cmd/Ctrl+Enter to generate

### UI/UX:
- 🎨 Beautiful, modern design
- 👥 Collaborator avatars with presence
- 📁 Collapsible context file sidebar (Cmd+B)
- 🎯 Three-panel output view
- 📊 Character count
- 🔔 Toast notifications

---

## 🏃 Quick Start

### 1. Open the Prototype (2 ways)

**Option A: Direct File Open (Simplest)**
```bash
open index.html
# Or just double-click index.html in Finder
```

**Option B: Local Server (Recommended)**
```bash
# Using Python
python3 -m http.server 8000
# Then visit: http://localhost:8000

# Or using Node.js
npx serve
# Then visit: http://localhost:3000
```

### 2. Test the Features

1. **Type in Your Prompt (Left Side):**
   - Click in the LEFT prompt area
   - Start typing: "Build a Stripe payment integration..."
   - Watch YOUR character count update
   - After 30+ characters, Alex starts typing in the RIGHT area automatically!

2. **View Context Files:**
   - Left sidebar shows 3 sample context files
   - Click on any file to see it's selected
   - Click × to remove a file

3. **Add Your Own Context:**
   - Click + button in sidebar
   - Fill in name and content
   - Click "Add File"

4. **Generate Three Versions:**
   - Type at least 20 characters in prompt
   - Click "✨ Generate" button (or Cmd/Ctrl+Enter)
   - Watch as 3 versions generate sequentially:
     - Your Version (appears first)
     - Alex's Version (appears second)
     - Combined Version (appears last)

5. **Switch Between Versions:**
   - Click tabs: "Your Version" | "Alex's Version" | "Combined"
   - Each version shows different implementation approach

6. **Copy/Export:**
   - Click "📋 Copy" to copy any version
   - Click "💾 Save" to download as text file

---

## 🎯 How It Works

### Architecture:

```
User Types Prompt
     ↓
Context Files Added
     ↓
Click "Generate" Button
     ↓
Simulates 3 AI Calls:
  1. Your perspective → Your Version
  2. Friend perspective → Friend's Version
  3. Combined logic → Merged Version
     ↓
Display in 3-Panel View
     ↓
User copies/exports preferred version
```

### Collaborative Features (Simulated):

**Dual Prompt Areas:**
- Left area: Your prompt (red avatar)
- Right area: Alex's prompt (blue avatar)
- Each has independent character count
- Clear visual separation

**Auto-Typing Simulation:**
- When you type 30+ characters in YOUR area
- Alex automatically starts typing in HIS area after 2 seconds
- Character-by-character animation (realistic typing)
- Toast notifications: "💬 Alex is typing..." → "✓ Alex added suggestions"
- Three different suggestion templates (random)

### Version Generation Logic:

1. **Your Version:** 
   - Uses your prompt exactly
   - Includes context files
   - Your coding style/preferences

2. **Friend's Version:**
   - Same prompt + context
   - Different implementation approach
   - Additional error handling, logging, best practices

3. **Combined Version:**
   - Merges best parts of both
   - Most comprehensive implementation
   - Production-ready code with all improvements

---

## 📁 File Structure

```
workspace-prototype/
├── index.html       # Main HTML structure
├── styles.css       # Complete styling
├── app.js           # All JavaScript logic
└── README.md        # This file
```

**Total:** 3 files, ~800 lines, zero dependencies (except fonts from CDN)

---

## 🎨 Customization

### Change Collaborator:

```javascript
// In app.js, find:
const state = {
  collaborators: [
    { id: 1, name: 'You', initial: 'Y', color: '#ef4444' },
    { id: 2, name: 'Alex', initial: 'A', color: '#3b82f6' } // Change this!
  ]
};
```

### Add More Context Files:

```javascript
// In app.js, addSampleContextFiles():
const samples = [
  {
    name: 'Your Context Name',
    content: 'Your content here...',
    icon: '📄' // Or any emoji
  }
];
```

### Customize Generation Logic:

```javascript
// In app.js, modify:
function generateYourVersion() {
  // Your custom logic here
}

function generateFriendVersion() {
  // Your custom logic here
}

function generateCombinedVersion() {
  // Your custom logic here
}
```

---

## ⌨️ Keyboard Shortcuts

- `Cmd/Ctrl + Enter` - Generate three versions
- `Cmd/Ctrl + B` - Toggle context sidebar
- `Escape` - Close modals

---

## 🔌 Integration Points

This prototype is ready to integrate with:

### 1. Chrome Extension:
```javascript
// Import context from extension
window.addEventListener('message', (event) => {
  if (event.data.type === 'IMPORT_CAPTURES') {
    const captures = event.data.captures;
    captures.forEach(capture => {
      addContextFileFromCapture(capture);
    });
  }
});
```

### 2. Real-Time Backend (WebSockets):
```javascript
// Replace simulated cursors with real ones
const ws = new WebSocket('ws://your-server.com');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'cursor_move') {
    updateCollaboratorCursor(data.userId, data.position);
  }
  
  if (data.type === 'prompt_change') {
    updateCollaboratorPrompt(data.userId, data.content);
  }
};
```

### 3. AI API (Real Generation):
```javascript
async function generateYourVersion() {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      messages: [{
        role: 'user',
        content: buildPrompt(state.currentPrompt, state.contextFiles)
      }]
    })
  });
  
  return await response.json();
}
```

---

## 🧪 Testing Checklist

- [ ] Open index.html in browser
- [ ] UI loads without errors
- [ ] Can type in prompt editor
- [ ] Character count updates
- [ ] Context files display correctly
- [ ] Can add new context file
- [ ] Can remove context file
- [ ] Click Generate button
- [ ] All 3 versions generate (simulated)
- [ ] Can switch between version tabs
- [ ] Can copy any version
- [ ] Can download any version
- [ ] Alex's cursor appears occasionally
- [ ] Keyboard shortcut (Cmd+Enter) works
- [ ] All buttons work
- [ ] No console errors

---

## 🚀 Next Steps

### Phase 1: Enhance Prototype ✅ (Current)
- ✅ Basic UI
- ✅ Context file management
- ✅ Three-version generation (simulated)
- ✅ Collaborative cursors (simulated)

### Phase 2: Add Real-Time Collaboration
- [ ] Set up WebSocket server (use existing Y.js server)
- [ ] Replace simulated cursors with real ones
- [ ] Real-time prompt syncing
- [ ] Actual multi-user editing

### Phase 3: Connect to AI APIs
- [ ] Integrate Claude API
- [ ] Integrate GPT-4 API
- [ ] Real prompt generation
- [ ] Streaming responses

### Phase 4: Backend Integration
- [ ] Connect to Supabase
- [ ] Save workspaces
- [ ] Load shared workspaces
- [ ] User authentication

---

## 💡 Demo Script

**Perfect for showing to stakeholders:**

1. **Show collaborative typing:**
   - "Watch as I type, you'll see Alex's cursor appear"
   - Type in prompt editor
   - Point out cursor appearing

2. **Show context files:**
   - "We've captured context from Jira, Slack, and docs"
   - Click through context files in sidebar

3. **Generate three versions:**
   - "Let's generate code from multiple perspectives"
   - Click Generate
   - Show version tabs as they complete

4. **Explain the value:**
   - "Your version uses your approach"
   - "Alex's version adds error handling"
   - "Combined version merges the best of both"
   - "This ensures we don't miss important considerations"

---

## 🎬 Screenshots

### Main View:
- Header with workspace name, collaborators, actions
- Left sidebar with context files
- Center editor for prompt
- Right panel for outputs (appears after generation)

### Collaboration View:
- Multiple cursors visible
- Typing indicators
- Real-time sync (simulated)

### Output View:
- Three tabs for three versions
- Code formatted nicely
- Copy and export buttons

---

## 🐛 Known Limitations (Prototype)

- ⚠️ Collaboration is simulated (not real WebSocket)
- ⚠️ Generation is fake (template-based, not real AI)
- ⚠️ No persistence (refresh loses data)
- ⚠️ Single workspace only (no list/switching)
- ⚠️ No authentication

**These will be fixed in the full version!**

---

## 📞 Support

Questions? Check the main project README or contact samyak@updateai.com

---

**Built with ❤️ for collaborative AI prompt engineering**
