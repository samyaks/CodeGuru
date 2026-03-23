# Quick Extension Test (15 Minutes)

## Step 1: Install Dependencies (2 min)
```bash
cd /Users/samyak/CodeGuru/code-visualizer-mvp/knowledge-graph-extension
npm install  # Already done ✅
```

## Step 2: Choose Testing Mode

### Option A: Test Without Backend (5 min) - **RECOMMENDED FIRST**
Test offline functionality without Supabase setup.

**What You Can Test:**
- ✅ Extension loads
- ✅ Page detection (Jira, Google Docs, Slack)
- ✅ Context capture (highlight text)
- ✅ Local storage of captures
- ✅ UI works
- ❌ Auth (needs backend)
- ❌ Sync (needs backend)
- ❌ Multi-device (needs backend)

**Steps:**
1. Load extension in Chrome
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select this folder
2. Visit a Jira ticket or Google Doc
3. Highlight some text (20+ characters)
4. Click "✨ Add to UpdateAI" button
5. Open extension popup
6. Verify capture appears in list

**Expected Result:** Everything works offline, sync status shows "🔓 Not signed in"

---

### Option B: Test With Local Supabase (15 min)
Full functionality test with local backend.

**Requirements:**
- Docker Desktop installed
- Supabase CLI installed

**Setup:**
```bash
# Install Supabase CLI (if not installed)
brew install supabase/tap/supabase

# Start local Supabase
cd backend
supabase start

# This will start:
# - PostgreSQL (port 5432)
# - API (port 54321)
# - Studio UI (port 54323)
# - Auth (port 54324)

# Get credentials
supabase status
# Copy the API URL and anon key
```

**Configure Extension:**
1. Edit `src/api/config.js`:
```javascript
SUPABASE_URL: 'http://localhost:54321',
SUPABASE_ANON_KEY: 'paste-anon-key-here',
IS_DEV: true,
```

2. Reload extension in Chrome

**Test Auth & Sync:**
1. Open extension popup
2. Click "Sign In"
3. Enter your email
4. Check email for magic link
5. Click link → Should authenticate
6. Capture some text
7. Click "Sync Now"
8. Verify in Supabase Studio: http://localhost:54323
   - Go to Table Editor → `captures`
   - Your captures should appear

**Expected Result:** Full auth + sync working

---

## Step 3: Run Quick Test Script

Create a test script to verify key functionality:

```javascript
// test-extension.js
// Run this in browser console after loading extension

async function quickTest() {
  console.log('🧪 Starting UpdateAI Quick Test...\n');
  
  // Test 1: Storage Access
  try {
    const testData = { test: 'data' };
    await chrome.storage.local.set(testData);
    const result = await chrome.storage.local.get('test');
    console.log('✅ Test 1: Storage access works');
  } catch (e) {
    console.error('❌ Test 1 Failed:', e);
  }
  
  // Test 2: Config Loaded
  try {
    const config = (await import('./src/api/config.js')).default;
    const isConfigured = config.SUPABASE_URL !== 'https://your-project.supabase.co';
    console.log(`${isConfigured ? '✅' : '⚠️'} Test 2: Config ${isConfigured ? 'configured' : 'needs setup'}`);
  } catch (e) {
    console.error('❌ Test 2 Failed:', e);
  }
  
  // Test 3: Service Worker Running
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PING' });
    console.log('✅ Test 3: Service worker responding');
  } catch (e) {
    console.error('❌ Test 3 Failed:', e);
  }
  
  // Test 4: Captures Stored
  try {
    const { captures = [] } = await chrome.storage.local.get('captures');
    console.log(`✅ Test 4: Found ${captures.length} captures in storage`);
  } catch (e) {
    console.error('❌ Test 4 Failed:', e);
  }
  
  console.log('\n✅ Quick test complete!');
}

quickTest();
```

**Run Test:**
1. Open extension popup
2. Right-click → Inspect
3. Paste script in console
4. Press Enter
5. Check results

---

## Expected Results Summary

### Without Backend (Offline Mode)
```
✅ Extension loads
✅ UI renders
✅ Page detection works
✅ Captures save locally
⚠️ Auth disabled (no backend)
⚠️ Sync disabled (no backend)
```

### With Backend (Full Mode)
```
✅ Extension loads
✅ UI renders
✅ Page detection works
✅ Captures save locally
✅ Auth works (magic link)
✅ Sync works (to Supabase)
✅ Real-time updates work
```

---

## Common Issues

### Issue 1: Extension Won't Load
**Error:** "Manifest file is missing or unreadable"
**Fix:** Make sure you selected the root folder containing `manifest.json`

### Issue 2: "Module not found" errors
**Error:** Cannot find module '@supabase/supabase-js'
**Fix:** 
```bash
npm install
```

### Issue 3: Supabase won't start
**Error:** "Docker daemon is not running"
**Fix:** Start Docker Desktop first

### Issue 4: Auth doesn't work
**Check:**
- Is Supabase URL configured correctly?
- Is anon key set in config.js?
- Check service worker console for errors

---

## Quick Decision Tree

```
Do you have Docker installed?
├─ NO → Test in Offline Mode (Option A)
└─ YES → Do you want full testing?
    ├─ NO → Test in Offline Mode (Option A)
    └─ YES → Test with Local Supabase (Option B)
```

**Recommendation:** Start with **Option A** (5 min), then do **Option B** (15 min) if you want full testing.

---

## Next Steps

After testing:
1. ✅ **Tests Pass** → Ready to build Workspace App!
2. ⚠️ **Tests Fail** → Debug using `EXTENSION_TESTING_PLAN.md`
3. 📝 **Want More Tests** → See `TESTING_CHECKLIST.md`

**Ready to proceed?** Let me know your test results!
