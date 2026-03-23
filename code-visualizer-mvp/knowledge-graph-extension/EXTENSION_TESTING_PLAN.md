# UpdateAI Extension Testing Plan

## Pre-Testing Setup

### 1. Install Dependencies ✅
```bash
npm install
```
**Status:** ✅ Complete (@supabase/supabase-js installed)

### 2. Configure Supabase (REQUIRED)
Before testing, you MUST configure Supabase:

**Option A: Use Local Supabase (Recommended for Testing)**
```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Start local Supabase
cd backend
supabase start

# Get local credentials
supabase status
# Copy API URL and anon key
```

**Option B: Use Supabase Cloud**
1. Go to https://supabase.com
2. Create a new project
3. Go to Settings > API
4. Copy Project URL and anon key

**Update Configuration:**
Edit `src/api/config.js`:
```javascript
SUPABASE_URL: 'http://localhost:54321', // or your Supabase cloud URL
SUPABASE_ANON_KEY: 'your-anon-key-here',
IS_DEV: true, // Set to true for testing
```

### 3. Set Up Database Schema
```bash
cd backend
supabase db reset  # Applies all migrations
```

### 4. Load Extension in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `knowledge-graph-extension` folder
5. Note the extension ID (needed for auth redirect)

### 5. Configure Auth Redirect URL
In Supabase Dashboard:
- Go to Authentication > URL Configuration
- Add redirect URL: `chrome-extension://YOUR_EXTENSION_ID/src/popup/popup.html`

---

## Testing Phases

## Phase 1: Basic Functionality (No Backend Required)

### Test 1.1: Extension Loads
- [ ] Extension icon appears in Chrome toolbar
- [ ] Click icon → popup opens
- [ ] No console errors
- [ ] UI renders correctly

### Test 1.2: Page Detection
- [ ] Navigate to Jira issue page
- [ ] Extension detects page (badge appears)
- [ ] Popup shows correct page info
- [ ] Navigate to Google Doc
- [ ] Extension detects document
- [ ] Navigate to Slack channel
- [ ] Extension detects channel

### Test 1.3: Context Capture (Offline Mode)
- [ ] Highlight text on Jira (20+ characters)
- [ ] "✨ Add to UpdateAI" button appears
- [ ] Click button → Capture saved
- [ ] Badge shows capture count
- [ ] Open popup → Capture appears in list
- [ ] Repeat for Google Docs and Slack

**Expected:** All captures stored in `chrome.storage.local`

---

## Phase 2: Authentication (Backend Required)

### Test 2.1: Sign In Flow
- [ ] Open extension popup
- [ ] Should show auth UI (not configured state)
- [ ] Enter your email
- [ ] Click "Send Magic Link"
- [ ] Check email for OTP link
- [ ] Click link → Extension authenticates
- [ ] Popup shows "Signed in as [email]"

**Debug Steps if Failing:**
```javascript
// Check console for errors
// Open chrome://extensions/ → UpdateAI → Inspect views: service worker
// Look for Supabase initialization logs
```

### Test 2.2: Token Management
- [ ] Sign in successfully
- [ ] Open DevTools → Application → Storage → Local Storage
- [ ] Look for `supabase.auth.token` entry
- [ ] Close and reopen popup
- [ ] Should still be signed in (session persisted)

### Test 2.3: Sign Out
- [ ] Click "Sign Out" in popup
- [ ] Auth tokens cleared from storage
- [ ] Popup shows sign-in screen again
- [ ] Local captures still exist (not deleted)

---

## Phase 3: Backend Sync (Backend Required)

### Test 3.1: Capture Sync to Supabase
**Setup:**
- Sign in to extension
- Have some captures in local storage

**Test:**
- [ ] Click "Sync Now" button (or wait for auto-sync)
- [ ] Check sync status shows "🔄 Syncing..."
- [ ] Wait 2-3 seconds
- [ ] Sync status changes to "✓ All synced"
- [ ] Badge count updates

**Verify in Supabase:**
```bash
# Query captures table
supabase db psql -c "SELECT * FROM captures ORDER BY created_at DESC LIMIT 5;"
```
- [ ] Captures appear in database
- [ ] All fields populated correctly (type, source, content, url)

### Test 3.2: Offline Capture → Online Sync
- [ ] Go offline (DevTools → Network → Offline)
- [ ] Capture text from Jira/Docs/Slack
- [ ] Verify capture saved locally
- [ ] Sync status shows "📴 Offline (1 pending)"
- [ ] Go back online
- [ ] Sync automatically triggers
- [ ] Capture syncs to Supabase
- [ ] Verify in database

### Test 3.3: Multi-Device Sync
**Setup:** Sign in on two different browsers/machines

**Test:**
- [ ] Capture text on Device A
- [ ] Wait 5-10 seconds
- [ ] Open popup on Device B
- [ ] Capture appears on Device B
- [ ] Try reverse: Capture on B, appears on A

**Expected:** Real-time sync within 10 seconds

---

## Phase 4: Real-Time Collaboration

### Test 4.1: Real-Time Capture Sync
- [ ] Sign in on two browser tabs (Tab A, Tab B)
- [ ] Capture text on Tab A
- [ ] Switch to Tab B immediately
- [ ] Capture appears in Tab B within 2-3 seconds
- [ ] Badge updates on both tabs

### Test 4.2: Workspace Activity
- [ ] Create workspace on Tab A
- [ ] Tab B receives notification
- [ ] Both tabs show same workspace data
- [ ] Edit workspace on Tab B
- [ ] Tab A sees changes in real-time

---

## Phase 5: Sync Queue & Conflict Resolution

### Test 5.1: Sync Queue Persistence
- [ ] Go offline
- [ ] Capture 5 items
- [ ] Close extension completely
- [ ] Reopen extension (still offline)
- [ ] Sync queue shows 5 pending items
- [ ] Go online
- [ ] All 5 items sync successfully

### Test 5.2: Failed Sync Retry
- [ ] Configure invalid Supabase URL temporarily
- [ ] Try to sync a capture
- [ ] Sync fails
- [ ] Check sync status: "⚠️ Sync failed - Retry?"
- [ ] Restore correct URL
- [ ] Click "Retry" or wait for auto-retry
- [ ] Sync succeeds

### Test 5.3: Conflict Resolution
**Setup:** Edit same capture on two devices while offline

**Test:**
- [ ] Device A offline: Edit capture note
- [ ] Device B offline: Edit same capture note (different text)
- [ ] Bring Device A online → Sync
- [ ] Bring Device B online → Sync
- [ ] Check Supabase: Last edit should win
- [ ] No data loss or corruption

---

## Phase 6: Export System

### Test 6.1: Export to AI
- [ ] Have 3+ captures with notes
- [ ] Click "✨ Export to AI" button
- [ ] Export modal opens
- [ ] Shows quality score (1-10)
- [ ] Lists any issues/warnings
- [ ] Select AI model (Claude/GPT-4/Gemini)
- [ ] Select template (optional)
- [ ] Click "Copy to Clipboard"
- [ ] Paste in text editor → Verify formatted prompt

### Test 6.2: Template Usage
- [ ] Open export modal
- [ ] Select "Feature Implementation" template
- [ ] Verify prompt structure includes template sections
- [ ] Try other templates
- [ ] Create custom template from workspace

### Test 6.3: Quality Analyzer
- [ ] Export with minimal context (1 capture, no notes)
- [ ] Should show low quality score (<5)
- [ ] Should list issues: "Add more requirements"
- [ ] Add more captures and notes
- [ ] Re-export → Quality score improves

---

## Phase 7: Error Handling

### Test 7.1: Network Errors
- [ ] Simulate slow network (DevTools → Network → Slow 3G)
- [ ] Try to sync captures
- [ ] Should show "Syncing..." for longer
- [ ] Eventually syncs or times out gracefully
- [ ] No crashes or infinite loading

### Test 7.2: Invalid API Keys
- [ ] Configure invalid Supabase key
- [ ] Try to sign in
- [ ] Should show error: "Invalid credentials"
- [ ] Should not crash
- [ ] Restore valid key → Works again

### Test 7.3: Storage Quota Exceeded
```javascript
// Fill up chrome.storage.local
async function fillStorage() {
  const bigData = 'x'.repeat(1000000); // 1MB
  for (let i = 0; i < 10; i++) {
    await chrome.storage.local.set({ [`test${i}`]: bigData });
  }
}
```
- [ ] Extension detects quota warning
- [ ] Shows notification
- [ ] Cleans up old data automatically
- [ ] Continues working

### Test 7.4: Service Worker Termination
- [ ] Start a sync operation
- [ ] Kill service worker (chrome://extensions/ → Terminate)
- [ ] Service worker restarts
- [ ] Sync resumes from where it left off
- [ ] No data loss

---

## Phase 8: UI/UX Polish

### Test 8.1: Sync Status Indicators
- [ ] All synced: "✓ All synced" (green)
- [ ] Syncing: "🔄 Syncing..." (blue, animated)
- [ ] Offline: "📴 Offline (X pending)" (yellow)
- [ ] Error: "⚠️ Sync failed - Retry?" (red)
- [ ] Not signed in: "🔓 Not signed in" (gray)

### Test 8.2: Toast Notifications
- [ ] Capture added → Toast: "✓ Capture added"
- [ ] Sync complete → Toast: "✓ Synced X items"
- [ ] Sync failed → Toast: "⚠️ Sync failed"
- [ ] Conflict detected → Toast: "⚠️ Conflict resolved"

### Test 8.3: Loading States
- [ ] Sign in → Button shows loading spinner
- [ ] Sync → Status bar shows animation
- [ ] Export → Modal shows "Generating..."
- [ ] No operation freezes UI

---

## Phase 9: Performance

### Test 9.1: Large Data Sets
- [ ] Create 100+ captures
- [ ] Popup still opens quickly (<500ms)
- [ ] Scroll is smooth
- [ ] Search works fast
- [ ] Sync completes in <10 seconds

### Test 9.2: Battery Impact
- [ ] Check CPU usage (Activity Monitor)
- [ ] Service worker should be idle most of time
- [ ] Background sync every 5 minutes (not constant)
- [ ] No memory leaks

### Test 9.3: Network Efficiency
- [ ] Check network tab during sync
- [ ] Should batch operations (not 100 individual requests)
- [ ] Should use WebSocket for real-time (not polling)
- [ ] Should compress data if possible

---

## Automated Testing

### Unit Tests (TODO)
```bash
npm test
```
**Areas to test:**
- `sync-queue.js` - Queue operations
- `cache-manager.js` - Cache consistency
- `supabase-client.js` - API calls
- `formatters.ts` - Export formatting

### Integration Tests (TODO)
```bash
npm run test:integration
```
**Scenarios:**
- Full capture → sync → retrieve flow
- Auth → capture → logout → login → data persists
- Offline queue → online sync
- Multi-device real-time sync

### E2E Tests (TODO - Playwright)
```bash
npm run test:e2e
```
**User flows:**
- Sign up → capture → export
- Multi-device collaboration
- Offline/online transitions

---

## Test Results Checklist

### Core Functionality
- [ ] Extension loads without errors
- [ ] Page detection works (Jira/Docs/Slack)
- [ ] Context capture works offline
- [ ] Captures persist across restarts

### Authentication
- [ ] Magic link sign in works
- [ ] Token refresh works
- [ ] Session persists across restarts
- [ ] Sign out clears auth data

### Synchronization
- [ ] Captures sync to Supabase
- [ ] Offline captures queue properly
- [ ] Queue persists across restarts
- [ ] Queue processes when online
- [ ] Real-time sync works (<3 sec)

### Error Handling
- [ ] Network errors handled gracefully
- [ ] Invalid credentials show errors
- [ ] Storage quota managed
- [ ] Service worker crashes recover

### Export System
- [ ] Export modal works
- [ ] All AI models format correctly
- [ ] Templates apply properly
- [ ] Quality analyzer scores accurately

### Performance
- [ ] Popup opens quickly (<500ms)
- [ ] Large data sets perform well
- [ ] Battery usage is minimal
- [ ] Network usage is efficient

---

## Known Issues & Limitations

### Current Limitations
1. **No backend deployed** - Must use local Supabase or manually deploy
2. **No unit tests** - Only manual testing available
3. **No E2E tests** - Playwright tests not implemented
4. **Export AI APIs not tested** - Claude/GPT API calls untested
5. **Workspace app not built** - Only extension tested

### Blocking Issues
- ❌ **Configuration required** - Supabase URL/key must be set
- ❌ **Database setup required** - Migrations must be run
- ❌ **Collaboration server not deployed** - Real-time may not work in prod

---

## Next Steps After Testing

1. ✅ **Extension Tested & Working** → Build Workspace App
2. ⏳ **Workspace App Built** → Deploy Infrastructure
3. ⏳ **Infrastructure Deployed** → Production Testing
4. ⏳ **Production Tested** → Launch!

---

## Support

**If Tests Fail:**
1. Check browser console for errors
2. Check service worker console (chrome://extensions/)
3. Check Supabase logs
4. Review `TESTING_CHECKLIST.md` and `SYNC_TESTING_GUIDE.md`
5. Check `IMPLEMENTATION_SUMMARY.md` for architecture details

**Test Reports:**
- Save test results to `TEST_RESULTS.md`
- Include screenshots of any failures
- Note browser version, OS, Supabase version
