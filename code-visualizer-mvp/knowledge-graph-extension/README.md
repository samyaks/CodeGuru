# UpdateAI Chrome Extension

Capture context from anywhere, sync across devices, and collaborate in workspaces.

## Features

### 🎯 Context Capture
- Highlight and capture text from Jira, Slack, Google Docs, and more
- Automatic context extraction with metadata
- Organize captures by project

### 🔄 Backend Sync
- **Offline-first architecture** - works without internet
- Automatic background sync when online
- Conflict resolution with timestamp-based merging
- Sync queue with retry logic

### 🔐 Authentication
- Magic link authentication (no passwords!)
- Secure token storage in Chrome extension storage
- Automatic token refresh
- OAuth support ready

### 👥 Workspaces
- Create collaborative workspaces from captures
- Assign captures to specific workspaces
- Real-time activity notifications
- Seamless integration with workspace app

### 📊 Sync Status
- Visual indicators for sync status
- Badge notifications for pending syncs
- Manual sync trigger
- Network-aware syncing

## Architecture

### Components

```
knowledge-graph-extension/
├── src/
│   ├── api/
│   │   ├── client.js         # Backend API client
│   │   ├── sync-queue.js     # Offline sync queue manager
│   │   └── config.js         # API configuration
│   ├── background/
│   │   └── service-worker.js # Background worker (sync, alarms, messages)
│   ├── content/
│   │   ├── google-detector.js
│   │   ├── jira-detector.js
│   │   └── slack-detector.js
│   └── popup/
│       ├── popup.html
│       ├── popup.js          # Main popup logic
│       └── auth-ui.js        # Authentication UI components
├── manifest.json
└── README.md
```

### Backend Integration Flow

1. **Capture Created**
   - Content script detects user selection
   - Sends message to service worker
   - Service worker adds to sync queue
   - Saved to local storage immediately

2. **Background Sync**
   - Chrome alarm triggers every 5 minutes
   - Sync queue processes pending items
   - Failed syncs retry with exponential backoff
   - Badge shows pending count

3. **Pull Updates**
   - Chrome alarm triggers every 10 minutes
   - Fetches captures from backend
   - Merges with local captures (timestamp-based)
   - Updates local storage

4. **Activity Notifications**
   - Chrome alarm checks every 15 minutes
   - Fetches workspace activity since last check
   - Shows Chrome notifications for new items
   - Updates badge with activity count

## API Client

### Authentication

```javascript
// Request magic link
await apiClient.requestMagicLink('user@company.com');

// Login with magic link token
const result = await apiClient.login(token, 'magic_link');

// Logout
await apiClient.logout();
```

### Captures

```javascript
// Sync capture to backend
await apiClient.syncCapture(capture);

// Get all captures
const { captures } = await apiClient.getCaptures();

// Update capture
await apiClient.updateCapture(captureId, { title: 'New Title' });

// Delete capture
await apiClient.deleteCapture(captureId);
```

### Workspaces

```javascript
// Get user workspaces
const { workspaces } = await apiClient.getWorkspaces();

// Create workspace
const { workspace } = await apiClient.createWorkspace({
  name: 'Q1 Launch',
  description: 'Product launch planning'
});

// Add capture to workspace
await apiClient.addCaptureToWorkspace(workspaceId, captureId);

// Get workspace activity
const { activities } = await apiClient.getWorkspaceActivity(workspaceId, since);
```

## Sync Queue

### Offline-First Design

The sync queue ensures captures are never lost, even when offline:

```javascript
// Add capture (saves locally + queues for sync)
await syncQueue.addCapture(capture);

// Process queue (syncs when online)
await syncQueue.processSyncQueue();

// Pull from backend
await syncQueue.pullFromBackend();

// Get sync status
const status = await syncQueue.getSyncStatus();
// {
//   total: 10,
//   synced: 8,
//   pending: 2,
//   localOnly: 0,
//   queueSize: 2,
//   isOnline: true,
//   isAuthenticated: true
// }
```

### Conflict Resolution

When pulling from backend:
- Server version wins for synced items
- Local changes marked as pending are preserved
- Timestamp-based resolution for conflicts
- Local-only items are kept

## Service Worker Messages

### Available Message Types

```javascript
// Authentication
{ type: 'LOGIN', token, type: 'magic_link' }
{ type: 'LOGOUT' }
{ type: 'REQUEST_MAGIC_LINK', email }

// Captures
{ type: 'ADD_CAPTURE', capture }
{ type: 'GET_CURRENT_PAGE' }

// Sync
{ type: 'SYNC_NOW' }
{ type: 'GET_SYNC_STATUS' }

// Workspaces
{ type: 'GET_WORKSPACES' }
{ type: 'CREATE_WORKSPACE', data }
{ type: 'ADD_TO_WORKSPACE', workspaceId, captureId }

// UI
{ type: 'CLEAR_BADGE' }
```

## Data Migration

On first login, existing local captures are automatically migrated to the backend:

```javascript
// Migration runs automatically after login
// - Checks hasMigrated flag
// - Syncs all local-only captures
// - Updates captures with server IDs
// - Sets hasMigrated flag
```

## Configuration

### Environment Variables

Set these in your build process:

```bash
API_BASE_URL=https://api.updateai.app
WORKSPACE_URL=https://workspace.updateai.app
```

### API Configuration

Edit `src/api/config.js`:

```javascript
export const API_CONFIG = {
  BASE_URL: 'https://api.updateai.app',
  WORKSPACE_URL: 'https://workspace.updateai.app',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  SYNC_INTERVAL: 5 * 60 * 1000,     // 5 minutes
  PULL_INTERVAL: 10 * 60 * 1000,    // 10 minutes
  ACTIVITY_CHECK_INTERVAL: 15 * 60 * 1000  // 15 minutes
};
```

## Installation

### Development

1. Clone the repository
```bash
git clone <repository-url>
cd knowledge-graph-extension
```

2. Install dependencies
```bash
npm install
```

3. Load extension in Chrome
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the extension directory

### Production Build

```bash
npm run build
```

The build output will be in the `dist/` directory.

## Permissions

The extension requires these permissions:

- `storage` - Store captures and auth tokens locally
- `tabs` - Open workspace tabs
- `activeTab` - Access current page for capture
- `alarms` - Background sync scheduling
- `notifications` - Show activity notifications
- Host permissions for API and supported sites

## Security

### Token Storage
- Auth tokens stored in Chrome's secure storage
- Tokens never exposed to content scripts
- Automatic token refresh before expiry

### API Communication
- HTTPS only
- Bearer token authentication
- Automatic retry with exponential backoff
- Request timeout protection

### Content Scripts
- Isolated from web page context
- Sanitized user input
- Validated URLs and protocols

## Performance

### Optimizations
- Lazy loading of API client
- Cached user data to reduce API calls
- Background sync with chrome.alarms (no polling)
- Offline-first architecture
- Minimal popup load time

### Resource Usage
- Service worker sleeps when idle
- Alarms instead of intervals
- Batch API requests where possible
- Efficient conflict resolution

## Troubleshooting

### Sync Issues

1. Check sync status in popup
2. Check network connection
3. Check authentication status
4. Try manual sync
5. Check console for errors

### Authentication Issues

1. Check email for magic link
2. Check spam folder
3. Try different email
4. Clear extension storage and retry

### Workspace Issues

1. Ensure signed in
2. Check workspace permissions
3. Refresh workspace list
4. Check console for errors

## Development

### Message Flow

```
Content Script → Service Worker → API → Backend
     ↓                 ↓            ↓
   Capture          Sync Queue   Storage
```

### Adding New Features

1. Add message handler in service worker
2. Add API method in client.js
3. Add UI in popup.js
4. Test offline behavior
5. Update README

## Backend API Requirements

The extension expects the following API endpoints:

### Authentication
- `POST /auth/magic-link` - Request magic link
- `POST /auth/login` - Login with token
- `POST /auth/logout` - Logout
- `POST /auth/refresh` - Refresh access token

### Captures
- `GET /captures` - List captures
- `POST /captures` - Create capture
- `PATCH /captures/:id` - Update capture
- `DELETE /captures/:id` - Delete capture

### Workspaces
- `GET /workspaces` - List workspaces
- `POST /workspaces` - Create workspace
- `POST /workspaces/:id/captures` - Add capture to workspace
- `GET /workspaces/:id/activity` - Get workspace activity

### Response Format

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

## License

[Your License Here]

## Support

For issues and questions:
- GitHub Issues: [repository-url]/issues
- Email: support@updateai.app
- Docs: https://docs.updateai.app
