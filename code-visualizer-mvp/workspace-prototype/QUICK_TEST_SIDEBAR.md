# ⚡ Quick Test: Collapsible Sidebar (30 seconds)

## 🚀 Open the Workspace

```bash
cd /Users/samyak/CodeGuru/code-visualizer-mvp/workspace-prototype
python3 -m http.server 8000
```
**Visit:** http://localhost:8000

**OR** double-click `index.html`

---

## ✅ Test 1: Click to Collapse (5 seconds)

1. Look at the **top-right** of the left sidebar
2. See two buttons: **[+]** and **[◀]**
3. Click the **◀** button
4. **Watch:**
   - ✨ Sidebar smoothly slides to the left
   - 🔔 Toast: "📁 Sidebar collapsed"
   - 📏 Prompt areas get wider
   - 🔵 Blue toggle button appears on left edge

**Expected:** Sidebar disappears, prompts expand!

---

## ✅ Test 2: Click to Expand (5 seconds)

1. Look at the **left edge** of the screen
2. See blue button: **▶** with "Context" label (vertical)
3. Click the blue **▶ Context** button
4. **Watch:**
   - ✨ Sidebar smoothly slides back in
   - 📁 Context files visible again
   - 📏 Prompt areas shrink back to normal
   - 🔵 Blue toggle button disappears

**Expected:** Sidebar returns, layout balanced!

---

## ✅ Test 3: Keyboard Shortcut (5 seconds)

### Mac:
1. Press **`Cmd + B`**
2. Sidebar toggles (collapse if open, expand if closed)
3. Press **`Cmd + B`** again
4. Sidebar toggles back

### Windows/Linux:
1. Press **`Ctrl + B`**
2. Sidebar toggles
3. Press **`Ctrl + B`** again
4. Sidebar toggles back

**Expected:** Instant toggle with keyboard!

---

## ✅ Test 4: Smooth Animation (10 seconds)

1. Click collapse button **[◀]**
2. **Watch carefully:**
   - Sidebar width goes from 280px → 0px
   - Transition is smooth (0.3 seconds)
   - No jumpy layout
   - Toggle button fades in smoothly
3. Click expand button **[▶ Context]**
4. **Watch carefully:**
   - Sidebar width goes from 0px → 280px
   - Transition is smooth
   - Toggle button fades out smoothly

**Expected:** Buttery smooth animations!

---

## ✅ Test 5: Work While Collapsed (10 seconds)

1. Collapse the sidebar (Cmd+B or click ◀)
2. Type in YOUR prompt (left area)
3. Type in ALEX'S prompt (right area)
4. Click **"✨ Generate"**
5. **Check:**
   - Everything still works!
   - Three versions generate
   - No layout issues
6. Expand sidebar back (Cmd+B)

**Expected:** Full functionality with or without sidebar!

---

## 🎯 Success Checklist

After testing, verify:

### Visual
- [ ] Collapse button (◀) visible in sidebar header
- [ ] Sidebar smoothly collapses to left
- [ ] Toggle button (▶ Context) appears when collapsed
- [ ] Toggle button has vertical text
- [ ] Toggle button is blue (primary color)
- [ ] Prompt areas expand to fill space
- [ ] Sidebar smoothly expands back
- [ ] Toggle button disappears when expanded

### Functional
- [ ] Click ◀ button → collapses
- [ ] Click ▶ button → expands
- [ ] Cmd+B (Mac) → toggles
- [ ] Ctrl+B (Windows) → toggles
- [ ] Toast notification on collapse
- [ ] Collapse button changes: ◀ → ▶
- [ ] All features work when collapsed
- [ ] No console errors

### Animation
- [ ] Smooth transition (not instant)
- [ ] No layout jumping
- [ ] No flickering
- [ ] 60fps animation
- [ ] Toggle button fades in/out smoothly

---

## 🎬 Demo Flow (15 seconds)

**For showing to others:**

1. **[0-5s]** "Context sidebar with files"
   - Show the sidebar
   - "But we can hide it when we need more space"

2. **[5-10s]** Collapse
   - Press Cmd+B or click ◀
   - "See how the prompts expand?"
   - "More room to write detailed requirements"

3. **[10-15s]** Expand
   - Press Cmd+B or click ▶
   - "Easy to toggle on and off"
   - "Keyboard shortcut too!"

**Perfect!** ✨

---

## 💡 Cool Things to Try

### 1. Rapid Toggle
- Press Cmd+B multiple times quickly
- Animation still smooth? ✅
- No glitches? ✅

### 2. Generate While Collapsed
- Collapse sidebar
- Type prompts
- Generate outputs
- Everything works? ✅

### 3. Add Context While Collapsed
- Collapse sidebar
- Click ▶ to peek at files
- Click + to add new file
- Works seamlessly? ✅

### 4. Focus Mode
- Collapse sidebar
- Collapse output panel (click ×)
- Just dual prompts visible
- Maximum focus! ✨

---

## 🐛 Troubleshooting

### Toggle button doesn't appear
- Make sure you clicked collapse button first
- Wait for animation to complete (0.3s)
- Refresh page if needed

### Animation is jerky
- Check browser (Chrome/Safari work best)
- Close other tabs (free up GPU)
- Check CPU usage

### Keyboard shortcut doesn't work
- Make sure browser window has focus
- Try clicking inside a prompt first
- Check if another app is using Cmd+B

### Sidebar won't expand
- Try keyboard shortcut (Cmd+B)
- Refresh page
- Check browser console for errors

---

## 📊 Expected Behavior

### Collapsed State:
```
Sidebar width: 0px
Toggle button: visible (left edge)
Collapse button text: "▶"
Prompt areas: wider
Toast: "📁 Sidebar collapsed"
```

### Expanded State:
```
Sidebar width: 280px
Toggle button: hidden
Collapse button text: "◀"
Prompt areas: normal width
No toast
```

---

## 🎊 What This Proves

✅ Responsive layout  
✅ Smooth animations  
✅ Keyboard shortcuts  
✅ Professional UX  
✅ Focus mode capability  
✅ Flexible workspace  
✅ Production-ready polish  

---

**Ready to test?**

```bash
open workspace-prototype/index.html
```

**Click the ◀ button or press Cmd+B!** 🚀
