# UpdateAI Sync System - Integration Guide

## Quick Start

This guide shows how to integrate the new sync system components into the existing UpdateAI extension.

## What's New

### New Files Created

1. `/src/api/realtime.js` - Real-time subscriptions manager
2. `/src/api/config.js` - Centralized configuration
3. `/src/background/offline-manager.js` - Network status management
4. `/src/api/sync-queue.js` - Enhanced with exponential backoff, priority queue, and conflict resolution
5. `/src/popup/auth-ui.js` - Enhanced with detailed sync status UI

### Enhanced Files

- `src/api/sync-queue.js` - Added exponential backoff, priority queue, conflict resolution
- `src/popup/auth-ui.js` - Added enhanced sync status display and conflict resolution UI

## Integration Steps

### Step 1: Update Service Worker

Add the new managers to your service worker:

```javascript
// At the top of service-worker.js
import RealtimeManager from '../api/realtime.js';
import OfflineManager from '../background/offline-manager.js';

// After existing variables
let realtimeManager;
let offlineManager;
```

### Step 2: Initialize Managers in `initialize()`

```javascript
async function initialize() {
  try {
    // ... existing initialization code ...
    
    // Initialize offline manager first
    offlineManager = new OfflineManager();
    await offlineManager.init();
    
    // Initialize realtime manager
    realtimeManager = new RealtimeManager(supabaseClient);
    await realtimeManager.init();
    
    if (isAuthenticated) {
      // ... existing auth code ...
      
      // Subscribe to realtime changes
      const user = supabaseClient.getUser();
      if (user) {
        await realtimeManager.subscribeToCaptureChanges(user.id, handleRealtimeUpdate);
      }
      
      // Register background sync
      await registerBackgroundSync();
    }
    
    // Set up offline manager listener
    offlineManager.addListener((event) => {
      if (event.type === 'online' && event.wasOffline) {
        handleNetworkRestored();
      }
    });
    
  } catch (error) {
    console.error('[UpdateAI] Initialization error:', error);
  }
}
```

### Step 3: Add Handler Functions

```javascript
/**
 * Handle realtime updates from other devices
 */
async function handleRealtimeUpdate(update) {
  console.log('[UpdateAI] Realtime update:', update);
  
  // Notify popup if open
  try {
    await chrome.runtime.sendMessage({
      type: 'REALTIME_UPDATE',
      update
    });
  } catch (error) {
    // Popup not open, ignore
  }
  
  // Update badge
  if (update.type === 'insert') {
    const result = await chrome.storage.local.get(['captures']);
    const captures = result.captures || [];
    if (captures.length > 0) {
      chrome.action.setBadgeText({ text: captures.length.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    }
  }
}

/**
 * Handle network restored
 */
async function handleNetworkRestored() {
  console.log('[UpdateAI] Network restored, starting sync');
  
  // Show notification
  chrome.notifications.create({
    type: 'basic',
    iconUrl: '/icons/icon128.png',
    title: 'UpdateAI Back Online',
    message: 'Syncing your changes now...',
    priority: 0
  });
  
  // Wait for connection to stabilize
  setTimeout(async () => {
    if (syncQueue) {
      await syncQueue.processSyncQueue();
      await syncQueue.pullFromBackend();
    }
    
    // Reconnect realtime if needed
    if (realtimeManager && !realtimeManager.isConnected()) {
      const user = supabaseClient.getUser();
      if (user) {
        await realtimeManager.subscribeToCaptureChanges(user.id, handleRealtimeUpdate);
      }
    }
  }, 1000);
}

/**
 * Register Chrome Background Sync API
 */
async function registerBackgroundSync() {
  try {
    if ('sync' in self.registration) {
      await self.registration.sync.register('syncUpdateAI');
      console.log('[UpdateAI] Background Sync registered');
    } else {
      console.log('[UpdateAI] Background Sync not supported');
    }
  } catch (error) {
    console.error('[UpdateAI] Background Sync registration error:', error);
  }
}
```

### Step 4: Add Background Sync Event Listener

Add this outside any function, at the module level:

```javascript
/**
 * Handle Background Sync event
 */
self.addEventListener('sync', (event) => {
  console.log('[UpdateAI] Background Sync event:', event.tag);
  
  if (event.tag === 'syncUpdateAI') {
    event.waitUntil(
      (async () => {
        try {
          if (supabaseClient.isAuthenticated() && navigator.onLine) {
            console.log('[UpdateAI] Processing background sync');
            await syncQueue.processSyncQueue();
            await syncQueue.pullFromBackend();
          }
        } catch (error) {
          console.error('[UpdateAI] Background sync error:', error);
          throw error; // Re-throw to retry later
        }
      })()
    );
  }
});
```

### Step 5: Add New Message Handlers

In the `chrome.runtime.onMessage.addListener`, add these new cases:

```javascript
case 'GET_NETWORK_STATUS':
  const netStatus = offlineManager ? offlineManager.getStatus() : { isOnline: navigator.onLine };
  sendResponse({ success: true, status: netStatus });
  break;

case 'GET_CONFLICTS':
  const conflicts = await syncQueue.getConflicts();
  sendResponse({ success: true, conflicts });
  break;

case 'RESOLVE_CONFLICT':
  const resolveResult = await syncQueue.resolveConflict(message.conflictId, message.resolution);
  sendResponse(resolveResult);
  break;

case 'FORCE_SYNC':
  await syncQueue.forceSyncNow();
  sendResponse({ success: true });
  break;

case 'GET_REALTIME_STATUS':
  const realtimeStatus = {
    connected: realtimeManager?.isConnected() || false,
    subscriptions: realtimeManager?.getSubscriptionCount() || 0
  };
  sendResponse({ success: true, status: realtimeStatus });
  break;
```

### Step 6: Update Login Handler

```javascript
async function handleLogin(token, type) {
  try {
    const result = await supabaseClient.verifyOTP(email, token); // or your login method
    
    if (result.success) {
      // ... existing login code ...
      
      // Initialize realtime manager
      realtimeManager = new RealtimeManager(supabaseClient);
      await realtimeManager.init();
      
      // Subscribe to realtime changes
      const user = supabaseClient.getUser();
      if (user) {
        await realtimeManager.subscribeToCaptureChanges(user.id, handleRealtimeUpdate);
      }
      
      // Register background sync
      await registerBackgroundSync();
    }
    
    return result;
  } catch (error) {
    console.error('[UpdateAI] Login error:', error);
    return { success: false, error: error.message };
  }
}
```

### Step 7: Update Logout Handler

```javascript
async function handleLogout() {
  try {
    await supabaseClient.signOut();
    
    // Stop background sync
    syncQueue.stopPeriodicSync();
    chrome.alarms.clearAll();
    
    // Unsubscribe from realtime
    if (realtimeManager) {
      realtimeManager.unsubscribeAll();
    }
    
    // Stop offline manager
    if (offlineManager) {
      offlineManager.stopQualityChecks();
    }
    
    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    
    console.log('[UpdateAI] Logout successful');
  } catch (error) {
    console.error('[UpdateAI] Logout error:', error);
  }
}
```

### Step 8: Update Popup to Show Sync Status

In your popup.js initialization:

```javascript
async function init() {
  // ... existing init code ...
  
  if (State.isAuthenticated) {
    // Load sync status
    const syncStatusResponse = await chrome.runtime.sendMessage({ 
      type: 'GET_SYNC_STATUS' 
    });
    
    if (syncStatusResponse.success) {
      showSyncStatus(syncStatusResponse.status);
    }
    
    // Poll for sync status updates every 5 seconds
    setInterval(async () => {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
      if (response.success) {
        showSyncStatus(response.status);
      }
    }, 5000);
  }
}
```

## Configuration

Update your config file with Supabase credentials:

```javascript
// src/api/config.js
const config = {
  supabase: {
    url: 'YOUR_SUPABASE_URL',
    anonKey: 'YOUR_SUPABASE_ANON_KEY'
  },
  sync: {
    maxRetryAttempts: 10,
    baseBackoffDelay: 1000,
    maxBackoffDelay: 5 * 60 * 1000,
    periodicSyncInterval: 5 * 60 * 1000,
    pullInterval: 10 * 60 * 1000
  }
};

export default config;
```

## Manifest Permissions

Ensure these permissions are in your manifest.json:

```json
{
  "permissions": [
    "storage",
    "tabs",
    "activeTab",
    "alarms",
    "notifications"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  }
}
```

## Testing

### 1. Test Offline Capture

```javascript
// In DevTools console
// 1. Go offline
// 2. Run this:
chrome.runtime.sendMessage({
  type: 'ADD_CAPTURE',
  capture: {
    type: 'test',
    source: 'Manual Test',
    content: 'Testing offline capture',
    timestamp: Date.now()
  }
}, (response) => {
  console.log('Capture added:', response);
});

// 3. Check chrome.storage.local
chrome.storage.local.get(['syncQueue', 'captures'], console.log);

// 4. Go online and watch it sync
```

### 2. Test Realtime

```javascript
// Open extension on two devices
// On device 1, create a capture
// On device 2, watch console for realtime update
```

### 3. Test Conflict Resolution

```javascript
// Get sync status with conflicts
chrome.runtime.sendMessage({ type: 'GET_CONFLICTS' }, console.log);

// Resolve a conflict
chrome.runtime.sendMessage({
  type: 'RESOLVE_CONFLICT',
  conflictId: 0,
  resolution: 'use_local'
}, console.log);
```

### 4. Test Network Status

```javascript
// Get network status
chrome.runtime.sendMessage({ type: 'GET_NETWORK_STATUS' }, console.log);

// Get sync status
chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' }, console.log);

// Get realtime status
chrome.runtime.sendMessage({ type: 'GET_REALTIME_STATUS' }, console.log);
```

## Common Issues

### 1. Realtime Not Connecting

**Check:**
- Supabase URL and key in config
- User is authenticated
- Network is online
- Console for connection errors

**Fix:**
```javascript
// Manually reconnect
const user = supabaseClient.getUser();
if (user) {
  await realtimeManager.subscribeToCaptureChanges(user.id, handleRealtimeUpdate);
}
```

### 2. Sync Queue Not Processing

**Check:**
- User is authenticated
- Network is online
- Queue has items

**Fix:**
```javascript
// Force sync
chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, console.log);
```

### 3. Service Worker Not Starting

**Check:**
- Module imports are correct
- No syntax errors
- Background script type is 'module'

**Debug:**
```javascript
// Check service worker status
chrome.serviceWorker.getRegistrations().then(console.log);
```

## Performance Tips

1. **Debounce Rapid Changes**
   ```javascript
   let debounceTimer;
   function debouncedSync() {
     clearTimeout(debounceTimer);
     debounceTimer = setTimeout(() => {
       syncQueue.processSyncQueue();
     }, 1000);
   }
   ```

2. **Batch Operations**
   ```javascript
   // Instead of syncing one by one
   const operations = [...];
   await Promise.all(operations.map(op => syncQueue.addCapture(op)));
   await syncQueue.processSyncQueue();
   ```

3. **Use Network Quality**
   ```javascript
   if (offlineManager.canSync()) {
     await syncQueue.processSyncQueue();
   }
   ```

## Monitoring

### Key Metrics to Track

1. **Sync Success Rate**
   ```javascript
   const status = await syncQueue.getSyncStatus();
   const successRate = status.synced / status.total;
   ```

2. **Average Sync Time**
   ```javascript
   const startTime = Date.now();
   await syncQueue.processSyncQueue();
   const syncTime = Date.now() - startTime;
   ```

3. **Conflict Rate**
   ```javascript
   const conflicts = await syncQueue.getConflicts();
   const conflictRate = conflicts.length / totalOperations;
   ```

4. **Network Transitions**
   ```javascript
   const netStatus = offlineManager.getStatus();
   const transitions = netStatus.transitions.length;
   ```

## Next Steps

1. Test all scenarios from SYNC_SYSTEM_GUIDE.md
2. Monitor console logs for errors
3. Test with real Supabase backend
4. Load test with 100+ captures
5. Test on slow connections
6. Test service worker lifecycle
7. Measure performance metrics
8. Add analytics/monitoring

## Support

If you encounter issues:
1. Check console logs
2. Inspect chrome.storage.local
3. Verify network status
4. Test with simple captures first
5. Reach out to Agent 2 (me!) for help

Good luck with the integration! 🚀
