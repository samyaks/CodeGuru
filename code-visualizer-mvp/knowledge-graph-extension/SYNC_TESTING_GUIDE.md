# UpdateAI Sync System Testing Guide

## Overview

This guide provides comprehensive test scenarios for the UpdateAI sync system, including edge cases, error conditions, and recovery procedures.

## Test Environment Setup

### Prerequisites

1. Chrome browser with DevTools
2. UpdateAI extension installed
3. Supabase account with test data
4. Two devices or browser profiles (for multi-device testing)

### DevTools Configuration

```javascript
// Open service worker console
chrome://extensions/ → UpdateAI → Service worker → Inspect

// Enable offline mode
DevTools → Network tab → Throttling → Offline

// Monitor storage
DevTools → Application → Storage → Local Storage
```

## Test Categories

## 1. Basic Sync Tests

### Test 1.1: Online Capture Sync

**Steps:**
1. Ensure online (green indicator)
2. Sign in to UpdateAI
3. Create a capture from Jira/Slack/Docs
4. Wait 2-3 seconds

**Expected:**
- Capture appears in popup immediately
- Badge shows "✓ All synced" within 3 seconds
- Capture visible in Supabase database
- No entries in sync queue

**Validation:**
```javascript
const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
assert(status.queueSize === 0);
assert(status.synced > 0);
```

### Test 1.2: Offline Capture Queue

**Steps:**
1. Go offline (DevTools Network → Offline)
2. Create 3 captures
3. Check popup sync status
4. Go online
5. Wait 10 seconds

**Expected:**
- Captures saved locally while offline
- Badge shows "📴 Offline (3 pending)"
- When online, badge shows "🔄 Syncing..."
- After sync, badge shows "✓ All synced"
- All 3 captures in Supabase

**Validation:**
```javascript
// While offline
const offlineStatus = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
assert(offlineStatus.pending === 3);
assert(offlineStatus.isOnline === false);

// After online
await wait(10000);
const onlineStatus = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
assert(onlineStatus.pending === 0);
assert(onlineStatus.synced === 3);
```

### Test 1.3: Sync on Extension Restart

**Steps:**
1. Go offline
2. Create 2 captures
3. Reload extension (chrome://extensions → Reload)
4. Check sync status
5. Go online
6. Wait 10 seconds

**Expected:**
- Sync queue persists after reload
- Still shows 2 pending items
- Syncs successfully when online
- No data loss

**Validation:**
```javascript
// After reload, before online
const result = await chrome.storage.local.get(['syncQueue']);
assert(result.syncQueue.length === 2);
```

## 2. Real-time Sync Tests

### Test 2.1: Multi-Device Capture

**Steps:**
1. Device A: Sign in
2. Device B: Sign in (same account)
3. Device A: Create capture
4. Device B: Check captures within 5 seconds

**Expected:**
- Device B receives notification "New Capture Synced"
- Capture appears in Device B's popup
- Badge updates on Device B
- No duplicate captures

**Validation (Device B):**
```javascript
// Listen for storage change
chrome.storage.onChanged.addListener((changes) => {
  if (changes.captures) {
    console.log('New capture received:', changes.captures.newValue);
  }
});
```

### Test 2.2: Workspace Updates

**Steps:**
1. Device A: Create workspace
2. Device B: Should see workspace within 5 seconds
3. Device A: Add capture to workspace
4. Device B: Should see update

**Expected:**
- Workspace syncs in real-time
- Workspace members see updates instantly
- No race conditions

### Test 2.3: Real-time Reconnection

**Steps:**
1. Device A: Sign in
2. Go offline for 2 minutes
3. Go online
4. Device B: Create capture
5. Device A: Should receive update

**Expected:**
- Real-time connection re-establishes automatically
- Missed updates pulled on reconnect
- Shows notification about reconnection

## 3. Conflict Resolution Tests

### Test 3.1: Same Item Edit (Different Devices)

**Steps:**
1. Device A & B: Both sign in
2. Both devices: Go offline
3. Device A: Edit capture X with text "A"
4. Device B: Edit capture X with text "B"
5. Device A: Go online first (sync)
6. Device B: Go online second (sync)

**Expected:**
- Device A syncs successfully
- Device B detects conflict
- Conflict appears in sync status
- User can resolve via UI
- No data loss - both versions preserved

**Validation:**
```javascript
const conflicts = await chrome.runtime.sendMessage({ type: 'GET_CONFLICTS' });
assert(conflicts.conflicts.length > 0);
assert(conflicts.conflicts[0].type === 'capture');
```

### Test 3.2: Last Write Wins

**Steps:**
1. Device A & B: Both offline
2. Device A: Edit capture at 10:00:00
3. Device B: Edit capture at 10:00:05
4. Device A: Sync first
5. Device B: Sync second

**Expected:**
- Device B's version wins (newer timestamp)
- Device A's version overwritten
- No conflict flag (>5 second difference)

### Test 3.3: Race Condition (Simultaneous Edit)

**Steps:**
1. Device A & B: Both online
2. Both edit same capture within 2 seconds
3. Both sync simultaneously

**Expected:**
- One wins (random)
- Other flagged as conflict
- User notified to resolve
- Both versions accessible

## 4. Network Transition Tests

### Test 4.1: Rapid Online/Offline

**Steps:**
1. Toggle offline/online 10 times rapidly
2. Create capture after each toggle
3. Check final sync status

**Expected:**
- No crashes
- All captures eventually sync
- No infinite loops
- Sync status accurate

**Validation:**
```javascript
// After stabilization
const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
assert(status.pending === 0);
assert(status.synced === 10);
```

### Test 4.2: Network Timeout During Sync

**Steps:**
1. Start syncing 10 items
2. During sync, go offline
3. Wait for timeout
4. Go online again

**Expected:**
- Partially synced items marked as synced
- Remaining items retry
- No corrupted data
- Accurate sync count

### Test 4.3: Poor Network Quality

**Steps:**
1. DevTools → Network → Slow 3G
2. Create 5 captures
3. Monitor sync progress

**Expected:**
- Syncs slower but succeeds
- Shows appropriate status messages
- No timeouts if < 5 seconds per request
- Adaptive retry delays

## 5. Storage Quota Tests

### Test 5.1: Quota Warning

**Steps:**
1. Fill storage to 80%
2. Create new capture

**Expected:**
- Warning notification appears
- Badge shows warning icon
- Capture still saved
- Suggests cleanup

**Validation:**
```javascript
const stats = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
assert(stats.stats.quota.usagePercent >= 0.80);
```

### Test 5.2: Quota Exceeded

**Steps:**
1. Fill storage to 95%
2. Create new capture

**Expected:**
- Emergency cleanup triggers automatically
- Old synced captures removed (>30 days)
- Sync failures cleared
- Capture saves successfully
- Shows cleanup notification

**Validation:**
```javascript
// After cleanup
const stats = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
assert(stats.stats.quota.usagePercent < 0.90);
```

### Test 5.3: Quota Recovery

**Steps:**
1. Trigger quota exceeded
2. Manually delete old captures
3. Check quota

**Expected:**
- Storage usage decreases
- Warning clears
- Normal operation resumes

## 6. Error Recovery Tests

### Test 6.1: Supabase API Error

**Steps:**
1. Mock Supabase API error (500)
2. Create capture
3. Check sync behavior

**Expected:**
- Capture queued locally
- Retry with exponential backoff
- After 10 failures, moved to syncFailures
- User notified of persistent error

**Validation:**
```javascript
// After 10 failures
const result = await chrome.storage.local.get(['syncFailures']);
assert(result.syncFailures.length > 0);
```

### Test 6.2: Invalid Auth Token

**Steps:**
1. Sign in
2. Manually clear auth token
3. Create capture

**Expected:**
- Capture queued locally
- Sync fails with auth error
- User prompted to re-authenticate
- After re-auth, captures sync

### Test 6.3: Service Worker Terminated

**Steps:**
1. Create 5 captures offline
2. Terminate service worker (chrome://serviceworker-internals)
3. Go online
4. Trigger sync (open popup)

**Expected:**
- Service worker restarts
- Sync queue loaded from storage
- Syncs automatically
- No data loss

**Validation:**
```javascript
// After service worker restart
const result = await chrome.storage.local.get(['syncQueue']);
assert(result.syncQueue.length === 5);
```

## 7. Edge Cases

### Test 7.1: Create Capture Offline, Then Sign In

**Steps:**
1. Sign out
2. Go offline
3. Create 3 captures
4. Go online
5. Sign in

**Expected:**
- Captures saved locally
- After sign in, migration prompt
- Captures uploaded to Supabase
- Linked to user account
- No duplicates

### Test 7.2: Multiple Failed Sync Attempts

**Steps:**
1. Create capture
2. Mock network error 5 times
3. Let sync succeed on 6th try

**Expected:**
- Exponential backoff increases delay
- 1s → 2s → 4s → 8s → 16s → success
- Capture eventually syncs
- User sees retry countdown

**Validation:**
```javascript
// Monitor sync attempts
const syncQueue = await chrome.storage.local.get(['syncQueue']);
const item = syncQueue[0];
assert(item.syncAttempts === 5);
assert(item.lastSyncAttempt > 0);
```

### Test 7.3: Sync During Sign Out

**Steps:**
1. Start syncing 10 items
2. During sync, sign out
3. Check state

**Expected:**
- Sync cancelled gracefully
- Unsynced items remain in queue
- After re-sign in, queue processed
- No crashes

### Test 7.4: Deleted Item on Server

**Steps:**
1. Device A: Create capture
2. Sync to server
3. Device B: Receive capture
4. Device A: Delete capture (syncs to server)
5. Device B: Pull updates

**Expected:**
- Device B's capture removed
- Handled gracefully
- No orphaned data

### Test 7.5: Server Rate Limiting

**Steps:**
1. Create 100 captures rapidly
2. Try to sync all at once

**Expected:**
- Sync queue processes in batches
- Respects rate limits
- Some items wait in queue
- All eventually sync
- No infinite retries

## 8. Performance Tests

### Test 8.1: Large Sync Queue

**Steps:**
1. Create 1000 captures offline
2. Go online
3. Monitor sync progress

**Expected:**
- Syncs in batches of 100
- Progress shown in badge
- Completes within 5 minutes
- No memory issues
- Service worker doesn't crash

### Test 8.2: Large Cache

**Steps:**
1. Sync 10,000 captures
2. Open popup
3. Check load time

**Expected:**
- Popup loads within 2 seconds
- Captures list virtualized
- Smooth scrolling
- No memory leaks

### Test 8.3: Continuous Sync Load

**Steps:**
1. Run for 24 hours
2. Create 10 captures every hour
3. Monitor performance

**Expected:**
- No memory leaks
- Service worker stable
- Sync queue never exceeds 100 items
- Badge always accurate

## Test Automation Scripts

### Script 1: Offline/Online Cycle

```javascript
async function testOfflineOnlineCycle() {
  const iterations = 10;
  const capturesPerIteration = 5;
  
  for (let i = 0; i < iterations; i++) {
    // Go offline
    await setOffline(true);
    
    // Create captures
    for (let j = 0; j < capturesPerIteration; j++) {
      await createCapture({
        type: 'test',
        content: `Iteration ${i}, Capture ${j}`
      });
    }
    
    // Go online
    await setOffline(false);
    
    // Wait for sync
    await waitForSync(10000);
    
    // Validate
    const status = await getSyncStatus();
    assert(status.pending === 0, `Iteration ${i}: Sync failed`);
  }
  
  console.log('✓ Test passed: All captures synced');
}
```

### Script 2: Multi-Device Sync

```javascript
async function testMultiDeviceSync() {
  const device1 = new DeviceEmulator('Device 1');
  const device2 = new DeviceEmulator('Device 2');
  
  await device1.signIn('test@example.com');
  await device2.signIn('test@example.com');
  
  // Device 1 creates
  const capture = await device1.createCapture({
    type: 'slack',
    content: 'Multi-device test'
  });
  
  // Wait for real-time sync
  await wait(3000);
  
  // Check Device 2
  const captures = await device2.getCaptures();
  assert(captures.some(c => c.id === capture.id), 'Capture not synced to Device 2');
  
  console.log('✓ Test passed: Multi-device sync working');
}
```

### Script 3: Conflict Resolution

```javascript
async function testConflictResolution() {
  const device1 = new DeviceEmulator('Device 1');
  const device2 = new DeviceEmulator('Device 2');
  
  await device1.signIn('test@example.com');
  await device2.signIn('test@example.com');
  
  // Create capture on both
  const capture = await device1.createCapture({ content: 'Original' });
  await wait(3000); // Let it sync
  
  // Both go offline
  await device1.setOffline(true);
  await device2.setOffline(true);
  
  // Both edit
  await device1.editCapture(capture.id, { content: 'Edit from Device 1' });
  await device2.editCapture(capture.id, { content: 'Edit from Device 2' });
  
  // Device 1 syncs first
  await device1.setOffline(false);
  await wait(3000);
  
  // Device 2 syncs (should detect conflict)
  await device2.setOffline(false);
  await wait(3000);
  
  // Check conflicts
  const conflicts = await device2.getConflicts();
  assert(conflicts.length > 0, 'Conflict not detected');
  
  // Resolve
  await device2.resolveConflict(conflicts[0].id, 'use_local');
  
  console.log('✓ Test passed: Conflict detected and resolved');
}
```

## Manual Testing Checklist

- [ ] Captures work offline and sync when online
- [ ] Queue persists across extension restarts
- [ ] Real-time updates work for multi-device
- [ ] Conflict resolution doesn't lose data
- [ ] Sync status UI updates correctly
- [ ] Background sync processes queue
- [ ] Handles rapid online/offline transitions
- [ ] No infinite sync loops
- [ ] Storage quota warnings appear at 80%
- [ ] Emergency cleanup works at 95%
- [ ] Auth token refresh works automatically
- [ ] Service worker survives termination
- [ ] Badge shows accurate counts
- [ ] Notifications appear for important events
- [ ] Network quality detection works
- [ ] Exponential backoff increases correctly
- [ ] Priority queue respects priorities
- [ ] Cache refresh works periodically
- [ ] Data consistency checks work
- [ ] Error messages are user-friendly

## Reporting Issues

When reporting sync issues, include:

1. **Service Worker Console Logs**
   - chrome://extensions → UpdateAI → Inspect
   - Copy all [SyncQueue], [Realtime], [OfflineManager] logs

2. **Sync Status**
```javascript
const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
console.log(JSON.stringify(status, null, 2));
```

3. **Storage State**
```javascript
const result = await chrome.storage.local.get(null);
console.log('Captures:', result.captures?.length);
console.log('Queue:', result.syncQueue?.length);
console.log('Conflicts:', result.syncConflicts?.length);
```

4. **Network Status**
```javascript
const netStatus = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_STATUS' });
console.log(JSON.stringify(netStatus, null, 2));
```

5. **Steps to Reproduce**
   - Detailed steps
   - Expected vs actual behavior
   - Screenshots if applicable

## Conclusion

This testing guide covers all critical sync scenarios. Regular testing ensures the sync system remains robust and reliable.

For any test failures, check the troubleshooting section in `SYNC_SYSTEM_GUIDE.md`.
