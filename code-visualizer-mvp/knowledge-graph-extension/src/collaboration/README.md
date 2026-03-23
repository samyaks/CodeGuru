# UpdateAI Real-Time Collaboration System

Google Docs-style real-time collaboration for UpdateAI workspaces.

## Features

✅ **Real-time synchronization** - Changes sync instantly across all users  
✅ **Collaborative cursors** - See where everyone is editing  
✅ **Presence awareness** - Know who's online and active  
✅ **Offline editing** - Edit without internet, sync when reconnected  
✅ **Conflict resolution** - CRDT-based, no data loss  
✅ **Rich text editing** - Bold, italic, lists, headings via Tiptap  
✅ **Typing indicators** - See when others are typing  
✅ **Automatic reconnection** - Handles network disruptions  

## Quick Start

### 1. Start Server

```bash
npm run collab-server
```

Server runs on `ws://localhost:1234`

### 2. Use in Your App

```tsx
import { useCollaboration, CollaborativeEditor, PresenceList } from './collaboration';

function MyWorkspace({ workspaceId }) {
  const { ydoc, provider, awareness, users } = useCollaboration({
    workspaceId,
    user: {
      id: 'user-1',
      name: 'John Doe',
      color: '#3b82f6',
    },
  });

  return (
    <>
      <PresenceList users={users} />
      <CollaborativeEditor
        ydoc={ydoc}
        provider={provider}
        awareness={awareness}
        user={{ name: 'John Doe', color: '#3b82f6' }}
      />
    </>
  );
}
```

### 3. Test It

Open the workspace in multiple browser tabs. All changes sync in real-time!

## Architecture

```
Client (Browser)
├── useCollaboration Hook
│   ├── Y.js Document (CRDT)
│   ├── WebSocket Provider
│   └── Awareness Protocol
├── CollaborativeEditor (Tiptap)
├── PresenceList
└── CollaborativeCursor

        ↕ WebSocket

Server (Node.js)
├── Y.js WebSocket Server
├── Document State Manager
└── Persistence Layer (Optional)
```

## Components

### Core Hook

- **`useCollaboration`** - Main hook providing collaboration state

### Components

- **`CollaborativeEditor`** - Rich text editor with real-time sync
- **`PresenceList`** - Shows active users with avatars
- **`CollaborativeCursor`** - Renders other users' cursors
- **`ConnectionStatus`** - Shows connection state

### Utilities

- **`ConnectionManager`** - Handles reconnection logic
- **`throttle/debounce`** - Performance optimizations

## File Structure

```
src/collaboration/
├── client/
│   ├── useCollaboration.ts       # Main hook
│   └── ConnectionManager.ts      # Connection handling
├── components/
│   ├── CollaborativeEditor.tsx   # Tiptap editor
│   ├── PresenceList.tsx          # User avatars
│   ├── CollaborativeCursor.tsx   # Cursor overlay
│   └── ConnectionStatus.tsx      # Status indicator
├── utils/
│   └── performance.ts            # Throttle/debounce
├── server/
│   └── index.js                  # WebSocket server
├── demo/
│   ├── DemoWorkspace.tsx         # Full demo
│   └── demo.html                 # Standalone demo
├── index.ts                      # Public exports
└── README.md                     # This file
```

## Technology Stack

- **Y.js** - CRDT document store for conflict-free editing
- **y-websocket** - WebSocket provider for real-time sync
- **y-indexeddb** - Local persistence for offline support
- **Tiptap** - Rich text editor framework
- **React** - UI framework
- **TypeScript** - Type safety

## Performance

- **Cursor updates:** Throttled to 60fps for smooth animation
- **Typing indicators:** Debounced to 300ms to reduce network load
- **Binary encoding:** Efficient Y.js protocol minimizes bandwidth
- **Scalability:** Handles 10+ users per workspace easily
- **Horizontal scaling:** Use Redis pub/sub for 100+ users

## Deployment

### Development

```bash
npm run collab-server
# Server runs on ws://localhost:1234
```

### Production

**Option 1: Self-hosted**
```bash
# DigitalOcean, AWS, etc.
cd src/collaboration/server
npm install
PORT=1234 HOST=0.0.0.0 node index.js
```

**Option 2: Docker**
```bash
docker build -t collab-server .
docker run -p 1234:1234 collab-server
```

**Client config:**
```tsx
useCollaboration({
  workspaceId,
  user,
  serverUrl: 'wss://collab.yourdomain.com',  // WSS for production!
});
```

## Testing

### Local Multi-Tab Testing

1. Start server: `npm run collab-server`
2. Open workspace in multiple browser tabs
3. Edit simultaneously - changes sync!

### Offline Testing

1. Open workspace
2. Open DevTools → Network → Set to "Offline"
3. Edit content (saved locally)
4. Set back to "Online" → Changes sync!

## Documentation

- **[COLLABORATION_ARCHITECTURE.md](../../COLLABORATION_ARCHITECTURE.md)** - Deep dive into system design
- **[INTEGRATION_GUIDE.md](../../INTEGRATION_GUIDE.md)** - Step-by-step integration
- **[demo.html](demo/demo.html)** - Interactive demo page

## Examples

See `demo/DemoWorkspace.tsx` for a complete working example.

## Cost Analysis

| Scale | Infrastructure | Cost/Month |
|-------|---------------|------------|
| 0-100 users | Single DigitalOcean droplet | $12 |
| 100-1000 users | Load balancer + Redis | $50-100 |
| 1000+ users | Kubernetes + Redis cluster | $500+ |

## License

MIT

---

**Built for UpdateAI with ❤️**
