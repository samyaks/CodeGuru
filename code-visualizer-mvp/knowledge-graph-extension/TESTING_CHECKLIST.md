# UpdateAI Extension - Testing Checklist

This document provides a comprehensive testing checklist for the Supabase integration in the UpdateAI Chrome extension.

## Prerequisites for Testing

- [ ] Supabase project created and configured
- [ ] Database schema set up (see SUPABASE_SETUP.md)
- [ ] `src/api/config.js` updated with real credentials
- [ ] `npm install` completed successfully
- [ ] Extension loaded in Chrome (`chrome://extensions`)
- [ ] Extension ID added to Supabase redirect URLs

## Phase 1: Authentication Testing

### Magic Link Authentication

- [ ] **Open extension popup**
  - Extension icon appears in Chrome toolbar
  - Popup opens without errors
  - Console shows no critical errors

- [ ] **Sign-in flow - Request magic link**
  - Click "Sign in" or see sign-in prompt
  - Enter valid email address
  - Click "Send Magic Link"
  - Button shows "Sending..." state
  - Success message appears: "Check Your Email"
  - No errors in browser console

- [ ] **Sign-in flow - Verify magic link**
  - Email received (check inbox and spam)
  - Click magic link in email
  - Browser opens or switches to Chrome
  - Extension automatically signs you in
  - Popup shows user profile with email
  - User avatar/initials displayed

- [ ] **Session persistence**
  - Close and reopen extension popup
  - User still signed in
  - No need to sign in again
  - User info displayed correctly

- [ ] **Token refresh**
  - Leave extension open for 60+ minutes
  - Extension automatically refreshes token
  - No sign-in prompt appears
  - Console shows "Token refreshed successfully"

- [ ] **Sign out**
  - Click "Logout" button in popup
  - Confirmation dialog appears
  - Click "OK"
  - Extension shows sign-in screen
  - User profile removed from UI
  - Auth token cleared from storage

### Error Handling

- [ ] **Invalid email format**
  - Enter invalid email (e.g., "notanemail")
  - Click "Send Magic Link"
  - Error message shown: "Please enter a valid email"
  - No API call made

- [ ] **Network error during sign-in**
  - Disconnect internet
  - Try to send magic link
  - Error message shown
  - Extension doesn't crash

- [ ] **Expired magic link**
  - Request magic link
  - Wait 1+ hour
  - Try to use old link
  - Error message shown or new link requested

## Phase 2: Data Operations Testing

### Projects

- [ ] **Create new project**
  - Click "Start Tracking" on first-time setup
  - Enter project name
  - Project created successfully
  - Toast notification: "✓ Project created!"
  - Project appears in extension

- [ ] **Save project (authenticated)**
  - Add links to project
  - Project saves to Supabase automatically
  - Console shows: "Project synced to Supabase"
  - Check Supabase dashboard: project exists in `captures` table

- [ ] **Load project (authenticated)**
  - Close and reopen extension
  - Project loads from Supabase
  - All links appear
  - No duplicates

- [ ] **Save project (offline)**
  - Disable network
  - Add links to project
  - Project saves locally
  - Toast: "✓ Project saved"
  - No error about network

- [ ] **Sync project (back online)**
  - Re-enable network
  - Project automatically syncs
  - Badge or status shows "Syncing..."
  - After sync: "✓ All synced"

### Captures

- [ ] **Add capture (authenticated)**
  - Highlight text on supported page (Jira, Slack, etc.)
  - Capture added successfully
  - Notification shown
  - Capture appears in popup
  - Check Supabase: capture exists

- [ ] **Add capture (offline)**
  - Disable network
  - Add capture
  - Capture saved locally
  - Badge shows pending count
  - No errors

- [ ] **Sync captures (back online)**
  - Re-enable network
  - Captures automatically sync within 5 minutes
  - Badge clears when synced
  - Check Supabase: captures exist

- [ ] **Update capture**
  - Update capture locally
  - Change syncs to Supabase
  - Console shows sync success

- [ ] **Delete capture**
  - Delete capture from extension
  - Delete syncs to Supabase
  - Capture removed from database

### Workspaces

- [ ] **Get workspaces (authenticated)**
  - Extension loads user's workspaces
  - Workspaces displayed in UI
  - Correct count shown

- [ ] **Create workspace**
  - Click "Create Workspace"
  - Enter name and description
  - Workspace created successfully
  - Check Supabase: workspace exists
  - User added as owner in `workspace_members`

- [ ] **Add capture to workspace**
  - Select workspace
  - Add capture
  - Capture linked to workspace
  - Check Supabase: link exists in `workspace_captures`

## Phase 3: Offline Sync Testing

### Sync Queue

- [ ] **Queue operations offline**
  - Disable network
  - Create 3 captures
  - Update 1 capture
  - Delete 1 capture
  - All operations saved locally
  - Badge shows pending count (e.g., "5")

- [ ] **Process sync queue**
  - Re-enable network
  - Wait for automatic sync (5 minutes) OR
  - Click "Sync Now" if available
  - Queue processes successfully
  - Badge clears
  - All operations reflected in Supabase

- [ ] **Exponential backoff**
  - Cause sync to fail (e.g., invalid token)
  - Check console logs
  - Retry attempts increase delay
  - "Retrying in Xs" messages appear

- [ ] **Max retry attempts**
  - Cause sync to fail repeatedly
  - After 10 attempts, item moved to failures
  - Console shows: "Abandoned X items"
  - Failures stored in chrome.storage

### Conflict Resolution

- [ ] **Create conflict (last-write-wins)**
  - Device A: Update capture offline
  - Device B: Update same capture online
  - Device A: Go online
  - Conflict detected
  - Sync status shows: "⚠️ Conflicts"

- [ ] **Resolve conflict - Use local**
  - Click "Resolve" button
  - See conflict modal
  - Click "Use Local"
  - Conflict resolved
  - Local version synced to server

- [ ] **Resolve conflict - Use server**
  - Create another conflict
  - Click "Resolve"
  - Click "Use Server"
  - Conflict resolved
  - Server version kept locally

- [ ] **Auto-resolution (same timestamp)**
  - Make identical changes on two devices
  - Both sync at same time
  - Server version auto-selected
  - No conflict modal shown

### Pull from Backend

- [ ] **Pull updates**
  - Create capture in Supabase dashboard
  - Wait 10 minutes OR force pull
  - Extension pulls new data
  - Capture appears in extension

- [ ] **Merge local and server**
  - Have local-only captures
  - Have server-only captures
  - Pull from backend
  - Both sets of captures appear
  - No duplicates

## Phase 4: Service Worker Testing

### Background Operations

- [ ] **Service worker initialization**
  - Reload extension
  - Check `chrome://extensions` -> Service Worker
  - Service worker active
  - Console shows: "Service worker ready"

- [ ] **Auth state listener**
  - Sign in
  - Service worker receives auth event
  - Console: "Auth state changed: SIGNED_IN"
  - Background sync starts

- [ ] **Background alarms**
  - Service worker sets up alarms
  - `syncQueue` alarm: every 5 minutes
  - `pullUpdates` alarm: every 10 minutes
  - `checkActivity` alarm: every 15 minutes

- [ ] **Periodic sync**
  - Leave extension running
  - After 5 minutes: auto-sync occurs
  - Console: "Processing X items"
  - After 10 minutes: pull occurs
  - Console: "Pulled X captures"

- [ ] **Network status changes**
  - Offline: Service worker detects
  - Online: Service worker triggers sync
  - Console: "Back online"

### Message Handling

- [ ] **GET_CURRENT_PAGE**
  - Message sent from popup
  - Service worker responds with page info
  - Response received in popup

- [ ] **ADD_CAPTURE**
  - Send from content script
  - Service worker processes
  - Notification shown
  - Badge updated

- [ ] **REQUEST_MAGIC_LINK**
  - Send from popup
  - Service worker calls Supabase
  - Response returned to popup

- [ ] **GET_SYNC_STATUS**
  - Request from popup
  - Detailed status returned
  - UI updates correctly

## Phase 5: UI Testing

### Auth UI Components

- [ ] **Login screen**
  - Shows on first launch
  - Email input works
  - Button states work
  - "Continue Offline" button works

- [ ] **User profile display**
  - Avatar/initials shown
  - Email displayed
  - Logout button visible
  - Formatting correct

- [ ] **Sync status indicator**
  - Shows correct status
  - Updates in real-time
  - Details displayed when needed
  - "Sync Now" button works

### Main UI

- [ ] **Project view**
  - Links displayed correctly
  - Categorization works
  - Notes shown properly
  - Actions work (add note, categorize, remove)

- [ ] **Modals**
  - Add note modal works
  - Categorize modal works
  - Workspace selector works
  - All buttons functional

- [ ] **Responsive design**
  - Popup width correct (400px)
  - Scrolling works
  - No layout issues
  - All text readable

## Phase 6: Error Handling

### Network Errors

- [ ] **API timeout**
  - Simulate slow network
  - Request times out gracefully
  - User-friendly error shown
  - Operation queued for retry

- [ ] **Invalid response**
  - Simulate malformed response
  - Error caught
  - User notified
  - Extension doesn't crash

- [ ] **Rate limiting**
  - Trigger rate limit
  - Error message shown
  - Retry scheduled
  - User informed

### Data Errors

- [ ] **Invalid data format**
  - Corrupt local data
  - Extension handles gracefully
  - Data migrated or reset
  - User notified if needed

- [ ] **Storage quota exceeded**
  - Fill storage to 90%+
  - Warning shown
  - Old data cleaned up
  - User notified

### Auth Errors

- [ ] **Session expired**
  - Expire session manually
  - Extension detects
  - User prompted to sign in
  - No data loss

- [ ] **Invalid credentials**
  - Use wrong credentials
  - Error shown
  - User can retry
  - No crash

## Phase 7: Performance Testing

### Load Testing

- [ ] **Large dataset**
  - Create 100+ captures
  - Extension loads quickly (<2s)
  - No UI lag
  - Sync performs well

- [ ] **Concurrent operations**
  - Multiple tabs open
  - Multiple captures at once
  - No race conditions
  - All synced correctly

### Memory Testing

- [ ] **Memory leaks**
  - Use extension for 1+ hour
  - Check Chrome Task Manager
  - Memory usage stable
  - No excessive growth

- [ ] **Service worker lifecycle**
  - Service worker can restart
  - State restored correctly
  - No memory leaks on restart

## Phase 8: Security Testing

### Data Security

- [ ] **Tokens stored securely**
  - Tokens in chrome.storage.local
  - Not in console logs
  - Not exposed to web pages

- [ ] **RLS policies work**
  - User A can't access User B's data
  - Test with two accounts
  - Verify in Supabase logs

- [ ] **XSS protection**
  - Try XSS in inputs
  - Text sanitized correctly
  - No script execution

### Authentication Security

- [ ] **Magic link expires**
  - Old links don't work
  - Error shown appropriately

- [ ] **Session timeout**
  - Long sessions expire
  - User re-authenticates
  - Data preserved

## Phase 9: Cross-Browser Testing

### Chrome

- [ ] Works in Chrome Stable
- [ ] Works in Chrome Beta
- [ ] Works in Chrome Canary

### Chromium-based

- [ ] Works in Microsoft Edge
- [ ] Works in Brave
- [ ] Works in Opera (if applicable)

## Phase 10: Regression Testing

After any code changes:

- [ ] All Phase 1 tests pass
- [ ] All Phase 2 tests pass
- [ ] All Phase 3 tests pass
- [ ] No new console errors
- [ ] No broken functionality

## Test Automation Opportunities

Consider automating these tests:

1. Auth flow (using Playwright or Puppeteer)
2. Data operations (unit tests)
3. Sync queue logic (unit tests)
4. Conflict resolution (unit tests)
5. API client methods (unit tests)

## Bug Reporting Template

When reporting bugs, include:

```
**Environment**
- Chrome version:
- Extension version:
- OS:
- Supabase project region:

**Steps to Reproduce**
1. 
2. 
3. 

**Expected Behavior**


**Actual Behavior**


**Console Logs**
```

**Screenshots/Videos**


**Additional Context**

```

## Testing Complete!

Once all tests pass, the integration is ready for production use!

## Next Steps After Testing

1. Fix any failing tests
2. Document known issues
3. Create user documentation
4. Set up error monitoring
5. Plan for production deployment

---

**Happy Testing! 🎉**
