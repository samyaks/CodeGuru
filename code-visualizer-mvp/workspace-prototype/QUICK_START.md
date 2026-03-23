# ⚡ Quick Start - 2 Minutes

## Step 1: Open the Prototype

**Choose ONE method:**

### Method A: Double-Click (Easiest)
1. Open Finder
2. Navigate to: `/Users/samyak/CodeGuru/code-visualizer-mvp/workspace-prototype/`
3. Double-click `index.html`
4. Opens in your default browser ✅

### Method B: Drag to Browser
1. Open Chrome/Safari/Firefox
2. Drag `index.html` into browser window
3. Done! ✅

### Method C: Local Server (Best for Development)
```bash
cd /Users/samyak/CodeGuru/code-visualizer-mvp/workspace-prototype
python3 -m http.server 8000
```
Then visit: http://localhost:8000

---

## Step 2: Play Around (3 minutes)

### Try This Flow:

1. **Look at the UI:**
   - See "Payment Gateway Integration" workspace
   - Two collaborators: You (red) and Alex (blue)
   - Left sidebar has 3 context files

2. **Type a Prompt:**
   - Click in the big text area
   - Type: "Build an API endpoint for processing payments with error handling"
   - Watch character count update
   - Every few seconds, Alex's blue cursor will appear (simulated)

3. **Add Context File:**
   - Click the + button in sidebar
   - File Name: "Error Codes"
   - Content: "400 = Invalid request\n500 = Server error"
   - Click "Add File"
   - New file appears in sidebar

4. **Generate Three Versions:**
   - Click the big "✨ Generate" button
   - Wait ~3 seconds
   - Right panel slides in showing:
     - **Your Version** (your implementation style)
     - **Alex's Version** (with extra error handling)
     - **Combined** (best of both)

5. **Copy or Download:**
   - Switch between the 3 versions using tabs
   - Click "📋 Copy" to copy to clipboard
   - Click "💾 Save" to download as file

---

## Step 3: Understand the Value

### What This Demonstrates:

**Problem:** When building features, different team members have different perspectives:
- You focus on core functionality
- Engineer focuses on error handling
- Architect focuses on scalability

**Solution:** Collaborative prompt building + Multi-version generation:
- Everyone adds their context
- AI generates from multiple perspectives
- Team picks best version or merges manually

**Result:** Better code, fewer missed edge cases, shared understanding

---

## 🎯 Expected Behavior

### On Load:
```
✅ Workspace UI appears
✅ 3 sample context files in sidebar
✅ Prompt editor ready
✅ Toast: "✨ Workspace ready!"
```

### After Typing:
```
✅ Character count updates
✅ Alex's cursor appears randomly
✅ Toast: "💬 Alex is typing..." (after 50 chars)
```

### After Generate:
```
✅ Right panel appears
✅ Loading indicators show
✅ Your Version generates (1.5s)
✅ Friend's Version generates (2.5s)
✅ Combined Version generates (3.5s)
✅ Toast: "✅ Generated 3 versions!"
```

---

## 🐛 Troubleshooting

### Issue: Page looks broken
**Solution:** Open browser DevTools (F12) → Console tab → Look for errors

### Issue: Nothing happens when clicking Generate
**Solution:** Type at least 20 characters first

### Issue: Cursors don't appear
**Solution:** This is normal - they only appear every 3 seconds randomly

### Issue: Can't copy to clipboard
**Solution:** Make sure you clicked inside the browser first (clipboard requires user gesture)

---

## ⌨️ Keyboard Shortcuts

- `Cmd/Ctrl + Enter` - Generate outputs
- `Escape` - Close modal
- `Tab` - Navigate form fields

---

## 📊 What's Real vs Simulated

### ✅ Real (Actually Working):
- UI and styling
- Context file management
- Prompt editing
- Character count
- Copy/export functionality
- Modal interactions
- Tab switching

### 🎭 Simulated (For Demo):
- Collaborative cursors (random positions)
- Friend typing indicator
- AI generation (template-based)
- Real-time sync

### 🚧 To Be Built:
- Real WebSocket collaboration
- Real AI API calls (Claude/GPT-4)
- Supabase backend
- User authentication
- Workspace persistence

---

## 🚀 Next Steps

1. ✅ **Test the prototype** (5 min)
2. ✅ **Show to team** - Get feedback
3. **Connect to real backend** - Replace simulations
4. **Add real AI** - Claude API integration
5. **Deploy** - Make it live!

---

**Ready to test?** Just double-click `index.html` or run a local server! 🎉
