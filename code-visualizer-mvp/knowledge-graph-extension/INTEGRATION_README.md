# UpdateAI Extension - Supabase Integration Guide

## Overview

The UpdateAI Chrome extension now features complete Supabase integration for authentication, data synchronization, and real-time collaboration. This document explains the implementation and how to use it.

## Features Implemented

### ✅ Authentication
- **Magic Link Authentication**: Passwordless email-based login
- **Session Management**: Automatic token refresh and persistence
- **Secure Storage**: Auth tokens stored in `chrome.storage.local`
- **Auth State Sync**: Real-time auth state updates across popup and service worker

### ✅ Data Synchronization
- **Offline-First**: All operations work offline, sync when online
- **Automatic Sync**: Background sync every 5 minutes
- **Conflict Resolution**: Last-write-wins with manual conflict resolution UI
- **Exponential Backoff**: Smart retry logic for failed syncs
- **Batch Processing**: Efficient syncing of multiple items

### ✅ API Integration
- **Captures API**: Create, read, update, delete captures
- **Projects API**: Store project data in Supabase
- **Workspaces API**: Multi-user workspace support
- **Real-time Subscriptions**: Live updates (ready to implement)

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐       ┌──────────────┐           │
│  │   Popup UI   │◄─────►│Auth UI       │           │
│  │  (popup.js)  │       │(auth-ui.js)  │           │
│  └───────┬──────┘       └──────────────┘           │
│          │                                           │
│          ▼                                           │
│  ┌──────────────────────────────────────────┐      │
│  │      Supabase Client (singleton)         │      │
│  │      (supabase-client.js)                │      │
│  │  - Auth methods                          │      │
│  │  - Data operations                       │      │
│  │  - Session management                    │      │
│  └────────────┬─────────────────────────────┘      │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────────┐      │
│  │       Service Worker                     │      │
│  │    (service-worker.js)                   │      │
│  │  - Background sync                       │      │
│  │  - Auth state listener                   │      │
│  │  - Message router                        │      │
│  └────────────┬─────────────────────────────┘      │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────────┐      │
│  │        Sync Queue                        │      │
│  │      (sync-queue.js)                     │      │
│  │  - Offline queue                         │      │
│  │  - Conflict detection                    │      │
│  │  - Retry logic                           │      │
│  └────────────┬─────────────────────────────┘      │
│               │                                      │
│               ▼                                      │
│  ┌──────────────────────────────────────────┐      │
│  │      Chrome Storage (Local)              │      │
│  │  - Auth tokens                           │      │
│  │  - Cached data                           │      │
│  │  - Sync queue                            │      │
│  └──────────────────────────────────────────┘      │
│                                                      │
└─────────────────┬────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│                  Supabase Backend                    │
├─────────────────────────────────────────────────────┤
│  - PostgreSQL Database                              │
│  - Row Level Security (RLS)                         │
│  - Real-time subscriptions                          │
│  - Authentication (Magic Links)                     │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
knowledge-graph-extension/
├── src/
│   ├── api/
│   │   ├── config.js              # Configuration (UPDATE THIS)
│   │   ├── supabase-client.js     # Supabase singleton
│   │   └── sync-queue.js          # Offline sync manager
│   ├── background/
│   │   └── service-worker.js      # Background worker
│   ├── popup/
│   │   ├── popup.js               # Main UI logic
│   │   ├── popup.html             # UI structure
│   │   └── auth-ui.js             # Auth components
│   └── content/
│       └── [content scripts]
├── SUPABASE_SETUP.md              # Setup instructions
├── .env.example                   # Environment template
└── package.json                   # Dependencies
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

This installs `@supabase/supabase-js` and other required packages.

### 2. Configure Supabase

Follow the detailed setup guide in [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md).

**Quick version:**
1. Create a Supabase project
2. Get your credentials from Settings > API
3. Update `src/api/config.js`:

```javascript
const API_CONFIG = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key-here',
  // ... rest stays the same
};
```

### 3. Load Extension

1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the project folder

### 4. Test Authentication

1. Click extension icon
2. Click "Sign in"
3. Enter email
4. Check email for magic link
5. Click link to authenticate

## Usage Guide

### For Users

#### Signing In

1. Click the extension icon
2. You'll see a sign-in prompt if not authenticated
3. Click "Send Magic Link"
4. Enter your email
5. Check your email and click the magic link
6. You're signed in!

#### Offline Mode

- The extension works offline automatically
- Changes are saved locally
- When you go back online, everything syncs
- You'll see a sync status indicator showing pending items

#### Sync Status

The extension shows different sync states:
- ✓ **Synced**: All data is up-to-date
- 🔄 **Syncing**: Currently syncing changes
- ⏳ **Pending**: Changes waiting to sync
- ⚠️ **Conflicts**: Manual resolution needed
- 📴 **Offline**: No internet connection
- 🔓 **Not Signed In**: Local-only mode

#### Resolving Conflicts

If you see conflicts:
1. Click the "Resolve" button
2. Choose local or server version for each conflict
3. Conflicts are resolved and sync continues

### For Developers

#### Authentication Flow

```javascript
// Check if authenticated
const isAuthenticated = supabaseClient.isAuthenticated();

// Get current user
const user = supabaseClient.getUser();

// Request magic link
const result = await supabaseClient.requestMagicLink('user@example.com');

// Handle auth state changes (automatic via listener)
```

#### Data Operations

```javascript
// Create a capture
const result = await supabaseClient.createCapture({
  type: 'jira',
  source: 'PROJ-123',
  title: 'My Task',
  content: 'Task description',
  url: 'https://jira.example.com/PROJ-123',
  metadata: { priority: 'high' },
  tags: ['bug', 'frontend']
});

// Get all captures
const captures = await supabaseClient.getCaptures();

// Save project
const project = {
  name: 'My Project',
  links: [/* ... */]
};
const result = await supabaseClient.saveProject(project);

// Get workspaces
const workspaces = await supabaseClient.getWorkspaces();
```

#### Offline Sync

The SyncQueue automatically handles offline operations:

```javascript
// This works offline - queued for sync
await syncQueue.addCapture(captureData);

// Force sync now
await syncQueue.forceSyncNow();

// Get sync status
const status = await syncQueue.getSyncStatus();
console.log(`Pending: ${status.pending}, Synced: ${status.synced}`);

// Get conflicts
const conflicts = await syncQueue.getConflicts();

// Resolve conflict
await syncQueue.resolveConflict(conflictId, 'use_local'); // or 'use_server'
```

#### Message Passing

The service worker handles messages:

```javascript
// From popup or content script:
const response = await chrome.runtime.sendMessage({
  type: 'ADD_CAPTURE',
  capture: captureData
});

// Request magic link
const result = await chrome.runtime.sendMessage({
  type: 'REQUEST_MAGIC_LINK',
  email: 'user@example.com'
});

// Get sync status
const status = await chrome.runtime.sendMessage({
  type: 'GET_SYNC_STATUS'
});
```

## API Reference

### Supabase Client Methods

#### Authentication

- `init()`: Initialize client and restore session
- `isAuthenticated()`: Check if user is signed in
- `getUser()`: Get current user object
- `requestMagicLink(email)`: Send magic link email
- `verifyOTP(email, token)`: Verify OTP from magic link
- `signOut()`: Sign out and clear session
- `refreshSession()`: Manually refresh session

#### Captures

- `createCapture(capture)`: Create new capture
- `getCaptures(filters)`: Get user's captures
- `updateCapture(id, updates)`: Update capture
- `deleteCapture(id)`: Delete capture

#### Projects

- `getProject()`: Get user's current project
- `saveProject(project)`: Save/update project
- `deleteProject(id)`: Delete project

#### Workspaces

- `getWorkspaces()`: Get user's workspaces
- `createWorkspace(data)`: Create new workspace
- `addCaptureToWorkspace(workspaceId, captureId)`: Add capture to workspace

### Sync Queue Methods

- `addCapture(capture)`: Add capture (works offline)
- `updateCapture(id, updates)`: Update capture (works offline)
- `deleteCapture(id)`: Delete capture (works offline)
- `processSyncQueue()`: Process pending syncs
- `pullFromBackend()`: Pull latest data from server
- `getSyncStatus()`: Get detailed sync status
- `getConflicts()`: Get unresolved conflicts
- `resolveConflict(id, resolution)`: Resolve conflict
- `forceSyncNow()`: Force immediate sync
- `startPeriodicSync()`: Start background sync
- `stopPeriodicSync()`: Stop background sync

## Configuration Options

Edit `src/api/config.js`:

```javascript
const API_CONFIG = {
  // Required - Get from Supabase dashboard
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
  
  // Optional - API settings
  API_BASE_URL: 'https://api.updateai.app',
  API_TIMEOUT: 30000,
  API_RETRY_ATTEMPTS: 3,
  API_RETRY_DELAY: 1000,
  
  // Optional - Sync settings
  SYNC_MAX_RETRY_ATTEMPTS: 10,
  SYNC_BASE_BACKOFF_DELAY: 1000,
  SYNC_MAX_BACKOFF_DELAY: 300000,
  SYNC_BATCH_SIZE: 10,
  SYNC_PERIODIC_INTERVAL: 300000,
  SYNC_PULL_INTERVAL: 600000,
  
  // Optional - Feature flags
  ENABLE_OFFLINE_MODE: true,
  ENABLE_REAL_TIME: true,
  ENABLE_COLLABORATION: true,
  IS_DEV: false
};
```

## Troubleshooting

### Common Issues

**"Configuration errors" in console**
- Update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js`
- Check for typos or extra spaces
- Verify values match Supabase dashboard

**Auth not working**
- Check redirect URLs in Supabase settings
- Verify email provider is enabled
- Check browser console for errors
- Try signing out and back in

**Data not syncing**
- Check network tab for failed requests
- Verify RLS policies in Supabase
- Check sync status in extension
- Look for conflicts to resolve

**Extension in offline mode**
- Invalid or missing Supabase config
- Network connectivity issues
- Supabase project not accessible

### Debug Mode

Enable debug mode in `config.js`:

```javascript
IS_DEV: true
```

This shows detailed console logs for:
- Auth state changes
- API requests/responses
- Sync operations
- Conflict detection

## Security Considerations

1. **Anon Key is Public**: The anon key can be exposed in the extension. RLS policies protect your data.

2. **Row Level Security**: Always use RLS policies to ensure users can only access their own data.

3. **Never Use Service Role Key**: Only use the anon key in the extension.

4. **Token Storage**: Tokens are stored in `chrome.storage.local`, which is isolated per-extension.

5. **HTTPS Only**: All communication with Supabase is over HTTPS.

## Performance Optimization

### Sync Strategy

- **Periodic Sync**: Every 5 minutes if authenticated and online
- **Pull Updates**: Every 10 minutes to get server changes
- **Exponential Backoff**: Failed syncs retry with increasing delays
- **Batch Processing**: Syncs multiple items efficiently

### Storage

- **Local Cache**: All data cached locally for offline access
- **Selective Sync**: Only syncs changed data
- **Conflict Storage**: Keeps conflicts separate from main data

## Future Enhancements

- [ ] Real-time subscriptions for live updates
- [ ] Team collaboration features
- [ ] Advanced conflict resolution UI
- [ ] Selective sync (sync specific workspaces)
- [ ] Background sync on schedule
- [ ] Push notifications for workspace updates
- [ ] Export/import functionality
- [ ] Advanced search and filtering

## Support

- **Setup Issues**: See [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)
- **Supabase Docs**: https://supabase.com/docs
- **Extension Issues**: Create an issue in the repository

## License

MIT License - See LICENSE file for details

---

**Built with ❤️ using Supabase and Chrome Extension APIs**
