# UpdateAI Sync System - Quick Reference

## Quick Commands

### Check Sync Status
```javascript
chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' })
```

### Force Sync Now
```javascript
chrome.runtime.sendMessage({ type: 'FORCE_SYNC' })
```

### Get Network Status
```javascript
chrome.runtime.sendMessage({ type: 'GET_NETWORK_STATUS' })
```

### Check Storage Usage
```javascript
chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' })
```

### Refresh Cache
```javascript
chrome.runtime.sendMessage({ type: 'REFRESH_CACHE', force: true })
```

### Get Conflicts
```javascript
chrome.runtime.sendMessage({ type: 'GET_CONFLICTS' })
```

### Resolve Conflict
```javascript
chrome.runtime.sendMessage({ 
  type: 'RESOLVE_CONFLICT',
  conflictId: 0,
  resolution: 'use_local' // or 'use_server'
})
```

### Ensure Data Consistency
```javascript
chrome.runtime.sendMessage({ type: 'ENSURE_CONSISTENCY' })
```

## Sync Status Icons

| Icon | Meaning | Action Needed |
|------|---------|---------------|
| ✓ | All synced | None |
| 🔄 | Syncing... | Wait |
| 📴 | Offline (X pending) | Go online |
| ⚠️ | X conflicts | Resolve manually |
| ⏳ | X pending | Wait for retry |
| 🔓 | Not signed in | Sign in to sync |

## Retry Schedule

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 | 1s | 1s |
| 2 | 2s | 3s |
| 3 | 4s | 7s |
| 4 | 8s | 15s |
| 5 | 16s | 31s |
| 6 | 32s | 63s |
| 7 | 64s | 127s |
| 8 | 128s | 255s |
| 9 | 256s | 511s |
| 10 | 300s (max) | 811s |

After 10 attempts, item moved to `syncFailures`.

## Priority Levels

| Operation | Priority | Order |
|-----------|----------|-------|
| Create capture | 100 | First |
| Update capture | 50 | Second |
| Delete capture | 10 | Last |

Within same priority: FIFO (oldest first).

## Storage Thresholds

| Usage | Action |
|-------|--------|
| < 80% | Normal operation |
| ≥ 80% | Show warning notification |
| ≥ 95% | Trigger emergency cleanup |

## Emergency Cleanup Removes

1. Old sync failures (keep last 10)
2. All resolved conflicts
3. Synced captures older than 30 days

## Cache Refresh Timing

- **Interval**: 15 minutes
- **Max Age**: 1 hour
- **On Startup**: Yes (if authenticated)
- **On Sign In**: Yes
- **Manual**: Via `REFRESH_CACHE` message

## Real-time Events

| Event | Trigger | Action |
|-------|---------|--------|
| INSERT | New capture on server | Add to local |
| UPDATE | Capture edited | Update local |
| DELETE | Capture deleted | Remove local |
| PRESENCE | User joins/leaves | Update collaborators |

## Background Sync

- **Chrome API**: Yes (if available)
- **Fallback**: Chrome alarms
- **Frequency**: Every 5 minutes
- **Pull Updates**: Every 10 minutes
- **On Wake**: Yes (automatic)

## Common Issues

### Sync Not Working

**Check:**
1. Are you signed in?
2. Are you online?
3. Is sync queue growing?
4. Any errors in console?

**Fix:**
```javascript
// 1. Check auth
supabaseClient.isAuthenticated()

// 2. Check queue
chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' })

// 3. Force sync
chrome.runtime.sendMessage({ type: 'FORCE_SYNC' })

// 4. Restart extension
chrome.runtime.reload()
```

### Real-time Not Working

**Check:**
1. Is realtime connected?
2. Active subscriptions count?

**Fix:**
```javascript
// Check status
chrome.runtime.sendMessage({ type: 'GET_REALTIME_STATUS' })

// Restart to re-subscribe
chrome.runtime.reload()
```

### Storage Full

**Check:**
```javascript
chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' })
```

**Fix:**
```javascript
// Manual cleanup
const result = await chrome.storage.local.get(['captures']);
const recent = result.captures.filter(c => 
  c.syncStatus !== 'synced' || 
  c.syncedAt > Date.now() - 7*24*60*60*1000
);
await chrome.storage.local.set({ captures: recent });
```

## Debug Commands

### View Service Worker Console
```
chrome://extensions/ → UpdateAI → Service worker → Inspect
```

### View All Storage
```javascript
chrome.storage.local.get(null, (result) => console.log(result))
```

### Clear All Data (DANGER)
```javascript
chrome.storage.local.clear()
```

### View Sync Queue
```javascript
chrome.storage.local.get(['syncQueue'], (r) => console.log(r.syncQueue))
```

### View Conflicts
```javascript
chrome.storage.local.get(['syncConflicts'], (r) => console.log(r.syncConflicts))
```

### View Failures
```javascript
chrome.storage.local.get(['syncFailures'], (r) => console.log(r.syncFailures))
```

## Monitoring Script

```javascript
// Run in service worker console
setInterval(async () => {
  const status = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
  const network = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_STATUS' });
  const storage = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_STATS' });
  
  console.log(`
=== UpdateAI Status ===
Online: ${network.status.isOnline}
Synced: ${status.status.synced}
Pending: ${status.status.pending}
Queue: ${status.status.queueSize}
Conflicts: ${status.status.conflicts}
Storage: ${Math.round(storage.stats.quota.usagePercent * 100)}%
Status: ${status.status.status}
  `);
}, 5000);
```

## Performance Benchmarks

| Operation | Expected Time |
|-----------|---------------|
| Sync 1 item | < 1s |
| Sync 10 items | < 5s |
| Sync 100 items | < 30s |
| Pull updates | < 3s |
| Cache refresh | < 5s |
| Conflict detection | < 100ms |
| Real-time event | < 500ms |

## API Endpoints (via Supabase)

- `POST /captures` - Create capture
- `GET /captures` - List captures
- `PATCH /captures/:id` - Update capture
- `DELETE /captures/:id` - Delete capture
- `GET /workspaces` - List workspaces
- `POST /workspaces` - Create workspace

## File Structure

```
src/
├── api/
│   ├── supabase-client.js    # Auth & API
│   ├── sync-queue.js          # Offline queue
│   ├── realtime.js            # Real-time sync
│   └── cache-manager.js       # Cache & consistency
├── background/
│   ├── service-worker.js      # Background logic
│   └── offline-manager.js     # Network detection
└── popup/
    ├── popup.js               # UI logic
    └── auth-ui.js             # Auth UI
```

## Support

- **Docs**: See `SYNC_SYSTEM_GUIDE.md`
- **Testing**: See `SYNC_TESTING_GUIDE.md`
- **Issues**: Check service worker console
- **Email**: samyak@updateai.com
