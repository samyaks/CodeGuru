# Real-Time Collaboration Architecture for UpdateAI

## Executive Summary

This document outlines the comprehensive real-time collaboration system for UpdateAI workspaces, enabling Google Docs-style simultaneous editing with presence awareness, cursor tracking, and conflict-free synchronization.

## Technology Decision: Y.js + y-websocket + Tiptap

### Why Y.js?
**Winner: Y.js + y-websocket**

After evaluating all options:
- **Y.js + y-websocket**: ✅ CHOSEN
  - **Pros**: Battle-tested CRDT, offline-first, excellent Tiptap integration, automatic conflict resolution, open source, free
  - **Cons**: Need to host WebSocket server
  - **Cost**: $0 (self-hosted) or ~$10-50/month for simple server
  
- **Liveblocks**: ❌ Expensive at scale ($99+/month), vendor lock-in
- **Partykit**: ❌ Still maturing, less ecosystem support
- **Custom WebSocket + OT**: ❌ Complex to build correctly, maintenance burden

### Decision Rationale
Y.js provides:
1. **CRDT-based conflict resolution** - mathematically guaranteed convergence
2. **Offline support** - works without internet, syncs when reconnected
3. **Rich ecosystem** - Tiptap, ProseMirror, Monaco integrations
4. **Performance** - handles 50+ simultaneous users efficiently
5. **Cost-effective** - open source with self-hosted option

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Tiptap     │  │  Cursor      │  │  Presence    │      │
│  │   Editor     │  │  Tracking    │  │  System      │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┼──────────────────┘              │
│                            │                                 │
│                  ┌─────────▼─────────┐                       │
│                  │ useCollaboration  │                       │
│                  │     Hook          │                       │
│                  └─────────┬─────────┘                       │
│                            │                                 │
│         ┌──────────────────┼──────────────────┐             │
│         │                  │                  │             │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐     │
│  │   Y.js Doc   │  │   Awareness  │  │  Connection  │     │
│  │   (CRDT)     │  │   Protocol   │  │   Manager    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │             │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          │     WebSocket Connection (y-websocket)
          │                  │                  │
┌─────────▼──────────────────▼──────────────────▼─────────────┐
│                    SERVER LAYER                              │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────┐       │
│  │         Y.js WebSocket Server                     │       │
│  │  - Broadcasts updates to all connected clients    │       │
│  │  - Maintains document state in memory             │       │
│  │  - Handles client connections/disconnections      │       │
│  └────────────────────┬─────────────────────────────┘       │
│                       │                                       │
│  ┌────────────────────▼──────────────────────────┐          │
│  │         Persistence Layer (Optional)           │          │
│  │  - Periodically saves Y.js doc to database     │          │
│  │  - Loads doc on server restart                 │          │
│  │  - Redis/PostgreSQL/MongoDB                    │          │
│  └────────────────────────────────────────────────┘          │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. **useCollaboration Hook**
```typescript
const {
  provider,        // Y.js WebSocket provider
  awareness,       // Presence/cursor state
  users,          // Active users list
  isConnected,    // Connection status
  isSynced,       // Sync status
  reconnect       // Manual reconnect function
} = useCollaboration({
  workspaceId: string,
  user: { name, color, id }
});
```

**Responsibilities:**
- Initialize Y.js document and WebSocket provider
- Set up awareness protocol for presence
- Handle connection lifecycle (connect, disconnect, reconnect)
- Manage offline queue and sync state
- Expose collaboration state to React components

### 2. **Tiptap Collaborative Editor**
```typescript
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      history: false, // Disable default history (use Y.js)
    }),
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider: provider,
      user: currentUser,
    }),
  ],
});
```

**Features:**
- Rich text editing (bold, italic, lists, etc.)
- Collaborative editing with Y.js
- Real-time cursor positions
- Undo/redo with CRDT-aware history
- Markdown shortcuts

### 3. **Presence System**
```typescript
interface PresenceState {
  user: {
    id: string;
    name: string;
    color: string;
    avatar?: string;
  };
  cursor: {
    x: number;
    y: number;
    sectionId?: string;
  } | null;
  selection: {
    anchor: number;
    head: number;
  } | null;
  lastActive: number;
  isTyping: boolean;
}
```

**Components:**
- `<PresenceList />` - Shows avatars of active users
- `<CollaborativeCursor />` - Renders other users' cursors
- `<TypingIndicator />` - Shows "User X is typing..."

### 4. **Connection Manager**
```typescript
class ConnectionManager {
  connect(workspaceId: string): void
  disconnect(): void
  reconnect(): Promise<void>
  getStatus(): ConnectionStatus
  onStatusChange(callback: (status) => void): void
}
```

**Features:**
- Exponential backoff for reconnection
- Network status detection
- Automatic reconnection on network recovery
- Connection health monitoring
- Graceful degradation

### 5. **Conflict Resolution**
- **CRDT-based (automatic)**: Y.js handles text edits automatically
- **Last-write-wins**: For metadata (workspace name, settings)
- **Operational Transform**: Not needed (CRDTs are superior)

---

## Data Flow

### 1. User Types in Editor
```
User Input → Tiptap Editor → Y.js CRDT Update
   ↓
Y.js generates minimal delta
   ↓
WebSocket broadcasts delta to all peers
   ↓
Other clients receive delta → Y.js merges → Tiptap updates
```

### 2. Cursor Movement
```
User moves cursor → React component tracks position
   ↓
Throttled (60fps) → Y.js Awareness update
   ↓
WebSocket broadcasts cursor position
   ↓
Other clients receive → Render cursor component
```

### 3. Offline Editing
```
User edits while offline → Y.js queues changes locally
   ↓
Network reconnects → Connection Manager detects
   ↓
Y.js syncs queued changes → CRDT merges conflicts
   ↓
All clients converge to same state
```

---

## Performance Optimizations

### 1. **Throttling & Debouncing**
```typescript
// Cursor updates: 60fps max
const throttledCursorUpdate = throttle((pos) => {
  awareness.setLocalStateField('cursor', pos);
}, 16); // ~60fps

// Text changes: immediate (Y.js handles this efficiently)
// No debouncing needed for text

// Typing indicator: 300ms debounce
const debouncedTyping = debounce(() => {
  awareness.setLocalStateField('isTyping', false);
}, 300);
```

### 2. **Memory Management**
- Limit history size (Y.js undo/redo stack)
- Remove inactive user cursors after 30 seconds
- Clean up disconnected user data after 5 minutes
- Use virtual scrolling for long documents

### 3. **Network Optimization**
- Binary encoding (Y.js uses efficient binary protocol)
- Differential sync (only changes transmitted)
- Compression for large documents
- Batch small updates

### 4. **Scalability**
- **10 users**: Direct WebSocket, single server
- **100 users**: Redis pub/sub for horizontal scaling
- **1000+ users**: Consider Kubernetes + distributed Y.js

---

## Security Considerations

### 1. **Authentication**
```typescript
const provider = new WebsocketProvider(
  'wss://collab.updateai.app',
  workspaceId,
  ydoc,
  {
    params: {
      token: await getAuthToken(), // JWT token
    }
  }
);
```

### 2. **Authorization**
- Server validates JWT on connection
- Check workspace access permissions
- Rate limiting per user (prevent spam)
- Block malicious clients

### 3. **Data Encryption**
- WSS (WebSocket Secure) for transport
- Optional E2E encryption for sensitive data
- HTTPS for REST API calls

---

## Offline Support

### How It Works
1. Y.js stores full document state locally (IndexedDB)
2. User edits offline → changes saved locally
3. Network reconnects → Y.js syncs with server
4. CRDT automatically resolves conflicts
5. No data loss, guaranteed convergence

### Implementation
```typescript
const ydoc = new Y.Doc();

// Enable persistence
const persistedYDoc = new IndexeddbPersistence(workspaceId, ydoc);

persistedYDoc.on('synced', () => {
  console.log('Local state loaded');
});

const provider = new WebsocketProvider(wsUrl, workspaceId, ydoc);

provider.on('sync', (isSynced) => {
  if (isSynced) {
    console.log('Synced with server');
  }
});
```

---

## Deployment

### WebSocket Server Setup
```bash
# Install dependencies
npm install y-websocket ws

# Start server
HOST=localhost PORT=1234 node server.js
```

### Production Deployment
```yaml
# docker-compose.yml
services:
  collab-server:
    image: node:18
    command: node server.js
    ports:
      - "1234:1234"
    environment:
      - PORT=1234
      - YPERSISTENCE=redis
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

### Scaling Strategy
1. **Single server**: 0-100 concurrent users
2. **Horizontal scaling**: 100-1000 users (Redis pub/sub)
3. **Kubernetes**: 1000+ users (auto-scaling)

---

## Cost Analysis

### Self-Hosted (Recommended)
- **DigitalOcean Droplet**: $12/month (1GB RAM, 25GB SSD)
- **Supports**: ~100 concurrent users
- **Total**: $12/month

### Managed Options
- **Liveblocks**: $99-299/month (1000-5000 users)
- **Partykit**: Pay-as-you-go (~$0.05/hour/room)
- **AWS**: ~$30/month (ECS + Redis)

**Recommendation**: Start with self-hosted Y.js server on DigitalOcean

---

## Migration Path

### Phase 1: Basic Collaboration (Week 1)
- ✅ Set up Y.js + WebSocket server
- ✅ Integrate Tiptap editor
- ✅ Basic text synchronization
- ✅ Connection status indicator

### Phase 2: Presence & Cursors (Week 2)
- ✅ Implement awareness protocol
- ✅ Render collaborative cursors
- ✅ Show active users list
- ✅ Typing indicators

### Phase 3: Offline & Performance (Week 3)
- ✅ Add IndexedDB persistence
- ✅ Implement reconnection logic
- ✅ Throttle cursor updates
- ✅ Optimize for 10+ users

### Phase 4: Production Ready (Week 4)
- ✅ Authentication & authorization
- ✅ Error handling & monitoring
- ✅ Load testing
- ✅ Documentation

---

## Testing Strategy

### Unit Tests
- Y.js document operations
- Awareness state updates
- Connection manager logic

### Integration Tests
- Multi-client editing scenarios
- Offline → online transitions
- Conflict resolution

### Load Tests
- 10 simultaneous users
- 50 users typing simultaneously
- Network disruption scenarios

### Manual Testing Checklist
- [ ] Two users edit same paragraph
- [ ] User goes offline, edits, comes back online
- [ ] 10+ users join workspace
- [ ] Cursor positions accurate across users
- [ ] Undo/redo works correctly
- [ ] No data loss on disconnect

---

## Monitoring & Observability

### Metrics to Track
- Active connections per workspace
- Sync latency (client to server)
- Conflict resolution events
- Reconnection rate
- Document size growth
- Memory usage per workspace

### Alerting
- High memory usage (>80%)
- Connection failures spike
- Sync latency >500ms
- Server errors >1% of requests

---

## Summary

**Architecture**: Y.js CRDT + WebSocket + Tiptap Editor

**Key Features**:
- ✅ Google Docs-style real-time editing
- ✅ Collaborative cursors with smooth animations
- ✅ Presence awareness (online users, typing indicators)
- ✅ Offline support with automatic sync
- ✅ Conflict-free resolution (CRDT)
- ✅ Scalable to 100+ users per workspace

**Cost**: $12/month (self-hosted) or free (localhost development)

**Timeline**: 4 weeks to production-ready system

**Next Steps**: See implementation files in `src/collaboration/`
