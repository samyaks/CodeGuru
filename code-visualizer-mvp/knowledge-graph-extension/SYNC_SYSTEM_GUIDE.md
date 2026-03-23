# UpdateAI Sync System Documentation

## Overview

The UpdateAI Chrome extension implements a robust offline-first synchronization system with real-time capabilities. This document explains the architecture, components, and usage of the sync system.

## Architecture

### Core Components

1. **SyncQueue** (`src/api/sync-queue.js`)
   - Manages offline operation queue
   - Implements exponential backoff retry logic
   - Handles create, update, and delete operations
   - Priority queue (captures before projects)

2. **RealtimeManager** (`src/api/realtime.js`)
   - Manages Supabase real-time subscriptions
   - Handles presence tracking
   - Automatic reconnection with backoff
   - Multi-device sync notifications

3. **OfflineManager** (`src/background/offline-manager.js`)
   - Detects online/offline state
   - Monitors chrome.storage quota
   - Emergency cleanup when storage is full
   - Network quality detection

4. **CacheManager** (`src/api/cache-manager.js`)
   - Data consistency between local and server
   - Cache invalidation and refresh
   - Stale data detection
   - Inconsistency reconciliation

5. **SupabaseClient** (`src/api/supabase-client.js`)
   - Handles authentication
   - API operations (CRUD)
   - Session management
   - Auto token refresh

## Sync Flow

### Offline Capture Flow

```
1. User creates capture while offline
   ↓
2. Capture saved to chrome.storage.local with status='pending'
   ↓
3. Added to syncQueue with action='create'
   ↓
4. Badge shows pending count
   ↓
5. When online, syncQueue.processSyncQueue() runs
   ↓
6. Capture synced to Supabase
   ↓
7. Local capture updated with serverId and status='synced'
   ↓
8. Removed from syncQueue
   ↓
9. Badge cleared
```

### Real-time Update Flow

```
1. Another device adds a capture
   ↓
2. Supabase real-time sends INSERT event
   ↓
3. RealtimeManager receives event
   ↓
4. Checks if capture exists locally
   ↓
5. If not, adds to chrome.storage.local
   ↓
6. Shows notification "New Capture Synced"
   ↓
7. Updates UI if popup is open
```

### Conflict Resolution Flow

```
1. User edits capture on two devices while offline
   ↓
2. Both queue updates with timestamps
   ↓
3. Device A syncs first (writes to server)
   ↓
4. Device B tries to sync (detects conflict)
   ↓
5. Compare timestamps (last-write-wins)
   ↓
6. Newer version wins automatically
   ↓
7. If timestamps very close (< 5s), flag as conflict
   ↓
8. User can manually resolve in UI
```

## Key Features

### 1. Exponential Backoff

Failed sync operations retry with increasing delays:
- Attempt 1: 1 second
- Attempt 2: 2 seconds
- Attempt 3: 4 seconds
- Attempt 4: 8 seconds
- ...
- Max delay: 5 minutes
- Max attempts: 10

After 10 failed attempts, items are moved to `syncFailures` for debugging.

### 2. Priority Queue

Operations are prioritized:
- Priority 100: Create capture
- Priority 50: Update capture
- Priority 10: Delete capture

Within same priority, older operations process first (FIFO).

### 3. Network Quality Detection

The system detects connection quality by testing latency:
- **Good**: < 500ms
- **Fair**: 500ms - 2000ms
- **Poor**: > 2000ms

This helps adjust sync frequency and batch sizes.

### 4. Storage Quota Management

Automatically monitors chrome.storage.local usage:
- **Warning**: 80% full (shows notification)
- **Critical**: 95% full (triggers emergency cleanup)

Emergency cleanup removes:
- Old sync failures (keeps last 10)
- Resolved conflicts
- Synced captures older than 30 days

### 5. Cache Consistency

CacheManager ensures local and server data stay consistent:
- Periodic cache refresh (every 15 minutes)
- Stale data detection (1 hour max age)
- Inconsistency reconciliation
- Orphaned record detection

### 6. Chrome Background Sync API

Uses Chrome's Background Sync API when available:
- Triggers even after service worker terminates
- Survives browser restarts
- Automatically retries on network recovery
- Falls back to alarms if unavailable

## Sync Status Indicators

The popup shows clear sync status:

- **✓ All synced**: Everything is up to date
- **🔄 Syncing...**: Currently syncing X items
- **📴 Offline (X pending)**: Offline with X items queued
- **⚠️ X conflicts**: Manual resolution needed
- **⏳ X pending**: Items waiting to sync (shows retry countdown)

## API Usage

### Check Sync Status

```javascript
const response = await chrome.runtime.sendMessage({ 
  type: 'GET_SYNC_STATUS' 
});

console.log(response.status);
// {
//   total: 10,
//   synced: 8,
//   pending: 2,
//   localOnly: 0,
//   queueSize: 2,
//   conflicts: 0,
//   isOnline: true,
//   isSyncing: false,
//   status: 'syncing'
// }
```

### Force Sync Now

```javascript
await chrome.runtime.sendMessage({ 
  type: 'FORCE_SYNC' 
});
```

### Get Network Status

```javascript
const response = await chrome.runtime.sendMessage({ 
  type: 'GET_NETWORK_STATUS' 
});

console.log(response.status);
// {
//   isOnline: true,
//   lastOnlineTime: 1643723456789,
//   offlineDuration: 0,
//   detailed: { connectionQuality: 'good' }
// }
```

### Refresh Cache

```javascript
await chrome.runtime.sendMessage({ 
  type: 'REFRESH_CACHE',
  force: true 
});
```

### Get Storage Stats

```javascript
const response = await chrome.runtime.sendMessage({ 
  type: 'GET_STORAGE_STATS' 
});

console.log(response.stats);
// {
//   captures: 15,
//   syncQueue: 2,
//   syncFailures: 0,
//   syncConflicts: 0,
//   quota: {
//     bytesInUse: 245760,
//     maxBytes: 10485760,
//     usagePercent: 0.023
//   }
// }
```

### Resolve Conflict

```javascript
await chrome.runtime.sendMessage({ 
  type: 'RESOLVE_CONFLICT',
  conflictId: 0,
  resolution: 'use_local' // or 'use_server'
});
```

## Testing Scenarios

### Scenario 1: Offline Capture & Sync

```javascript
// 1. Go offline (Network tab in DevTools)
navigator.onLine // false

// 2. Create capture
await chrome.runtime.sendMessage({
  type: 'ADD_CAPTURE',
  capture: { type: 'jira', content: 'Test' }
});

// 3. Check sync queue
const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
console.log(status.pending); // 1

// 4. Go online
navigator.onLine // true

// 5. Wait 5 seconds (automatic sync)

// 6. Check status
const newStatus = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
console.log(newStatus.pending); // 0
console.log(newStatus.synced); // 1
```

### Scenario 2: Multi-Device Sync

```javascript
// Device A: Create capture
await createCapture({ type: 'slack', content: 'Message' });

// Device B: Should receive notification within 2-3 seconds
// "New Capture Synced - Message added from another device"

// Device B: Check captures
const captures = await chrome.storage.local.get(['captures']);
console.log(captures.captures.length); // Includes new capture
```

### Scenario 3: Conflict Resolution

```javascript
// Device A & B: Edit same capture while offline

// Device A syncs first (no conflict)
// Device B syncs second (detects conflict)

// Get conflicts
const response = await chrome.runtime.sendMessage({ type: 'GET_CONFLICTS' });
console.log(response.conflicts.length); // 1

// Resolve using local version
await chrome.runtime.sendMessage({
  type: 'RESOLVE_CONFLICT',
  conflictId: 0,
  resolution: 'use_local'
});
```

### Scenario 4: Storage Quota

```javascript
// Fill storage to 80%
// System shows warning notification

// Fill to 95%
// System triggers emergency cleanup automatically

// Check quota after cleanup
const stats = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
console.log(stats.quota.usagePercent); // < 0.80
```

## Performance Considerations

### Batching

The system batches operations to reduce API calls:
- Sync queue processes up to 100 items per batch
- Real-time updates batched at UI level (max 1 update per second)
- Cache refreshes combined for all data types

### Throttling

Background operations are throttled to save resources:
- Sync queue: Every 5 minutes (via alarm)
- Pull updates: Every 10 minutes (via alarm)
- Cache refresh: Every 15 minutes (on-demand)
- Network status: Every 30 seconds (when needed)

### Memory Management

- Service worker can be terminated by Chrome
- All state persisted to chrome.storage.local
- Sync queue survives service worker restarts
- Real-time subscriptions re-established on wake

## Troubleshooting

### Sync Not Working

1. Check authentication:
```javascript
const user = supabaseClient.getUser();
console.log(user); // Should have email
```

2. Check network status:
```javascript
const status = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_STATUS' });
console.log(status.isOnline); // Should be true
```

3. Check sync queue:
```javascript
const syncStatus = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
console.log(syncStatus.queueSize); // Should decrease over time
```

4. Check for errors in console:
```
chrome://extensions/ → UpdateAI → Service worker → Inspect
```

### Real-time Not Working

1. Check realtime status:
```javascript
const status = await chrome.runtime.sendMessage({ type: 'GET_REALTIME_STATUS' });
console.log(status.connected); // Should be true
console.log(status.subscriptions); // Should be > 0
```

2. Check Supabase connection:
```javascript
// In service worker console
realtimeManager.isConnected() // Should be true
```

3. Manually re-subscribe:
```javascript
// Restart extension or reload service worker
chrome.runtime.reload()
```

### Storage Quota Exceeded

1. Check usage:
```javascript
const stats = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
console.log(stats.quota.usagePercent);
```

2. Manual cleanup:
```javascript
// Clear old synced captures
const result = await chrome.storage.local.get(['captures']);
const filtered = result.captures.filter(c => c.syncStatus !== 'synced' || c.syncedAt > Date.now() - 7*24*60*60*1000);
await chrome.storage.local.set({ captures: filtered });
```

3. Clear all data (nuclear option):
```javascript
await chrome.storage.local.clear();
// Then restart extension
```

## Best Practices

### For Developers

1. **Always check online status** before making API calls
2. **Use sync queue** for all create/update/delete operations
3. **Handle quota exceeded** errors gracefully
4. **Test offline scenarios** thoroughly
5. **Monitor sync queue size** - alert if consistently growing

### For Users

1. **Sign in** to enable multi-device sync
2. **Stay online** when possible for best experience
3. **Watch sync status** indicator in popup
4. **Resolve conflicts** promptly when notified
5. **Clear old data** periodically if storage warning appears

## Architecture Diagrams

### Sync Queue Flow

```
┌─────────────┐
│   User      │
│   Action    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Save to    │
│  Local      │
│  Storage    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Add to     │
│  Sync       │
│  Queue      │
└──────┬──────┘
       │
       ▼
  ┌────────────┐
  │  Online?   │
  └─────┬──────┘
        │
     Yes│         No
        │          │
        ▼          ▼
  ┌──────────┐  ┌──────────┐
  │  Sync    │  │  Wait    │
  │  Now     │  │  for     │
  └────┬─────┘  │  Online  │
       │        └──────────┘
       │
       ▼
  ┌──────────┐
  │  Success?│
  └─────┬────┘
        │
     Yes│         No
        │          │
        ▼          ▼
  ┌──────────┐  ┌──────────┐
  │  Update  │  │  Retry   │
  │  Local   │  │  with    │
  │  + Badge │  │  Backoff │
  └──────────┘  └──────────┘
```

### Real-time Sync Flow

```
┌──────────────┐
│   Device A   │
│   Creates    │
│   Capture    │
└───────┬──────┘
        │
        ▼
┌──────────────┐
│   Supabase   │
│   Database   │
└───────┬──────┘
        │
        │ Real-time
        │ Event
        │
        ▼
┌──────────────┐
│   Device B   │
│   Receives   │
│   Update     │
└───────┬──────┘
        │
        ▼
┌──────────────┐
│   Local      │
│   Storage    │
│   Updated    │
└───────┬──────┘
        │
        ▼
┌──────────────┐
│   UI         │
│   Refreshed  │
└──────────────┘
```

## Conclusion

The UpdateAI sync system provides a robust, offline-first experience with real-time capabilities. It handles network disruptions gracefully, resolves conflicts intelligently, and keeps data consistent across devices.

For questions or issues, check the troubleshooting section or inspect service worker logs.
