# ⚡ Test Dual Prompts Now! (2 Minutes)

## 🎯 What to Expect

You'll see **TWO prompt areas side-by-side**:
- **Left (Red):** Your prompt area
- **Right (Blue):** Alex's prompt area

When you type in YOUR area, Alex will automatically start typing in HIS area!

---

## 🚀 Quick Test Steps

### 1. Open the Workspace
```bash
cd /Users/samyak/CodeGuru/code-visualizer-mvp/workspace-prototype
python3 -m http.server 8000
```
**Then visit:** http://localhost:8000

**OR** just double-click `index.html`

---

### 2. Type in YOUR Area (Left Side)

Click in the **LEFT** text area and type:

```
Build a REST API for user authentication with:
- JWT token generation
- Email/password login
- Session management
```

**Watch for:**
- ✅ Character count updates below YOUR prompt
- ✅ Main header shows total character count

---

### 3. Wait for Alex to Respond (Automatic!)

After you've typed ~30 characters:
- ⏰ Wait 2-3 seconds
- 🔔 Toast appears: "💬 Alex is typing..."
- ⌨️ RIGHT text area starts filling automatically
- 📝 Characters appear one by one (realistic typing!)
- ✅ Toast when done: "✓ Alex added suggestions"

**Alex will type something like:**
```
Add comprehensive error handling:
- Retry logic with exponential backoff
- Proper error logging
- User-friendly error messages

Security considerations:
- Input validation
- Rate limiting
- Authentication checks
```

---

### 4. Generate Three Versions

Click the big **"✨ Generate"** button

**You'll see:**
1. **Your Version** (1.5s) - Based on YOUR (left) prompt
2. **Alex's Version** (2.5s) - Based on ALEX'S (right) prompt
3. **Combined Version** (3.5s) - Merges BOTH prompts!

---

### 5. Compare the Versions

**Your Version Tab:**
```
# Your Version
Based on Your Requirements
Your Prompt: "Build a REST API for user authentication..."

[Shows clean, straightforward implementation]
```

**Alex's Version Tab:**
```
# Alex's Version
Enhanced Implementation
Alex's Prompt: "Add comprehensive error handling..."

[Shows implementation with extra safeguards]
```

**Combined Tab:**
```
# Combined Version
Merged Requirements

Your Focus: [your input from left]
Alex's Focus: [Alex's input from right]

[Shows production-ready code with BOTH perspectives]
```

---

## 🎯 Success Checklist

After testing, check these:

### Visual Elements:
- [ ] Two prompt areas visible side-by-side
- [ ] Left area has red "Y" avatar
- [ ] Right area has blue "A" avatar
- [ ] Each area has character count
- [ ] Clean divider between areas

### Typing Behavior:
- [ ] Can type in left area
- [ ] Character count updates
- [ ] After ~30 chars, Alex starts typing in right area
- [ ] Toast: "💬 Alex is typing..."
- [ ] Characters appear one-by-one in right area
- [ ] Toast: "✓ Alex added suggestions"

### Generation:
- [ ] Generate button works
- [ ] Right panel appears
- [ ] Your Version shows left prompt
- [ ] Alex's Version shows right prompt
- [ ] Combined shows BOTH prompts
- [ ] All versions generate successfully

### Polish:
- [ ] No console errors
- [ ] Smooth animations
- [ ] Professional look
- [ ] Easy to understand
- [ ] Collaboration is obvious

---

## 🎬 Perfect Demo Flow (45 seconds)

**[0-10s]** Show the layout
- "Here's our workspace with two prompt areas"
- "I type my requirements on the left"
- "My teammate adds their perspective on the right"

**[10-20s]** Type and watch
- Start typing in left area
- "Watch what happens after I've written a bit..."
- Point to right area as Alex starts typing
- "Alex automatically adds his considerations"

**[20-35s]** Generate
- "Now we generate three versions"
- Click Generate
- Show tabs: Your / Alex's / Combined

**[35-45s]** Explain value
- "My version focuses on core features"
- "Alex's adds error handling and security"
- "Combined version has everything"
- "Nothing gets missed!"

---

## 💡 Cool Things to Try

### 1. Manual Editing
- Let Alex auto-type
- Then manually edit HIS prompt in the right area
- Generate to see how your edits affect output

### 2. Different Prompts
Try these combinations:

**Your Prompt (Left):**
```
Create a database schema for an e-commerce store
```

**Wait for Alex, then Edit His to:**
```
Add indexes for performance
Add constraints for data integrity
Plan for 1M+ products
```

### 3. Empty Right Side
- Type in left only
- Don't let Alex auto-type (or clear his text)
- Generate with only YOUR prompt
- See how versions adapt

### 4. Empty Left Side
- Clear your text
- Type only in Alex's area (right)
- Generate
- See results from only friend's perspective

---

## 🐛 Troubleshooting

### Alex Doesn't Start Typing
- Make sure you typed 30+ characters in YOUR (left) area
- Wait 2-3 seconds
- Check browser console for errors

### Can't See Two Areas
- Refresh the page
- Make sure you're using the updated files
- Check browser width (need at least 768px)

### Generate Button Disabled
- Need at least 20 characters in ONE area
- Or 10+ in each area
- Check character counts

### Wrong Prompts in Output
- Clear browser cache
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

---

## 📸 What You Should See

```
┌────────────────────────────────────────────────────────────────────┐
│  UpdateAI    Payment Gateway Integration    [Y][A][+]  [Generate] │
├─────────────┬──────────────────────────────────────────────────────┤
│ 📁 Context  │  ┌──────────────────┬──────────────────┐            │
│             │  │ [Y] Your Prompt  │ [A] Alex's Prompt│            │
│ [+]         │  │  50 chars        │  87 chars        │            │
│             │  ├──────────────────┼──────────────────┤            │
│ 📋 Jira     │  │ Build a REST API │ Add comprehensive│            │
│ 💬 Slack    │  │ for user auth... │ error handling...│            │
│ 📄 Docs     │  │                  │                  │            │
│             │  │ [You type here]  │ [Alex types here]│            │
│             │  │                  │                  │            │
│ [Export]    │  └──────────────────┴──────────────────┘            │
└─────────────┴──────────────────────────────────────────────────────┘
```

---

## 🎊 Success!

If all checks pass, you have:
- ✅ Working dual-prompt interface
- ✅ Realistic collaboration simulation
- ✅ Three-version generation
- ✅ Clear visual separation
- ✅ Professional UX
- ✅ Demo-ready product!

---

**Ready to test?**

```bash
cd /Users/samyak/CodeGuru/code-visualizer-mvp/workspace-prototype
open index.html
```

**Start typing in the LEFT area!** 🚀
