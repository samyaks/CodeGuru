# UpdateAI API Documentation

Complete API reference for UpdateAI backend services.

## Table of Contents

- [Authentication](#authentication)
- [Users](#users)
- [Teams](#teams)
- [Captures](#captures)
- [Workspaces](#workspaces)
- [Collaboration](#collaboration)
- [Comments](#comments)
- [Analytics](#analytics)
- [Real-time Subscriptions](#real-time-subscriptions)

## Authentication

### Sign Up

```typescript
const { user, session } = await api.auth.signUp(
  'user@example.com',
  'password123',
  'John Doe' // optional display name
)
```

### Sign In

```typescript
const { user, session } = await api.auth.signIn(
  'user@example.com',
  'password123'
)
```

### Sign Out

```typescript
await api.auth.signOut()
```

### Get Current User

```typescript
const user = await api.auth.getCurrentUser()
```

### Update Last Seen

```typescript
await api.auth.updateLastSeen()
```

## Users

### Get User Profile

```typescript
const user = await api.users.get(userId)

// Returns:
{
  id: "uuid",
  email: "user@example.com",
  display_name: "John Doe",
  avatar_url: "https://...",
  created_at: "2026-01-27T...",
  updated_at: "2026-01-27T...",
  last_seen_at: "2026-01-27T...",
  preferences: {}
}
```

### Update Profile

```typescript
const updated = await api.users.update({
  display_name: 'Jane Doe',
  avatar_url: 'https://...',
  preferences: { theme: 'dark' }
})
```

## Teams

### Create Team

```typescript
const teamId = await api.teams.create('Engineering Team', 'engineering')
```

### List Teams

```typescript
const teams = await api.teams.list()
```

### Get Team

```typescript
const team = await api.teams.get(teamId)
```

### Update Team

```typescript
const updated = await api.teams.update(teamId, {
  name: 'Product Team',
  settings: { allow_external_sharing: true }
})
```

### Add Team Member

```typescript
await api.teams.addMember(teamId, userId, 'member')
// Roles: 'owner', 'admin', 'member'
```

### Get Team Members

```typescript
const members = await api.teams.getMembers(teamId)

// Returns array of:
{
  id: "uuid",
  team_id: "uuid",
  user_id: "uuid",
  role: "member",
  joined_at: "2026-01-27T...",
  user: { /* User object */ }
}
```

## Captures

### Create Capture

```typescript
const capture = await api.captures.create({
  type: 'jira',
  source: 'PROJ-123',
  title: 'Implement user authentication',
  content: 'Full issue description...',
  url: 'https://jira.company.com/browse/PROJ-123',
  metadata: { issueKey: 'PROJ-123', priority: 'high' },
  tags: ['auth', 'security'],
  teamId: 'optional-team-id'
})

// Capture types: 'jira', 'slack', 'google-docs', 'github', 'figma', 'notion', 'custom'
```

### List Captures

```typescript
// All captures
const captures = await api.captures.list()

// Filtered
const jiraCaptures = await api.captures.list({
  type: 'jira',
  teamId: 'team-uuid',
  limit: 50,
  offset: 0
})
```

### Get Capture

```typescript
const capture = await api.captures.get(captureId)
```

### Update Capture

```typescript
const updated = await api.captures.update(captureId, {
  title: 'Updated title',
  tags: ['new', 'tags']
})
```

### Delete Capture

```typescript
await api.captures.delete(captureId)
```

### Search Captures

```typescript
const results = await api.captures.search('authentication', teamId)
// Full-text search with ranking
```

## Workspaces

### Create Workspace

```typescript
const workspaceId = await api.workspaces.create({
  name: 'Q1 Planning',
  description: 'Product planning for Q1 2026',
  teamId: 'optional-team-id',
  status: 'draft' // 'draft', 'in_progress', 'review', 'completed', 'archived'
})
```

### List Workspaces

```typescript
// All workspaces
const workspaces = await api.workspaces.list()

// Filtered
const activeWorkspaces = await api.workspaces.list({
  status: 'in_progress',
  teamId: 'team-uuid',
  limit: 20
})
```

### Get Workspace

```typescript
// Basic info
const workspace = await api.workspaces.get(workspaceId)

// With captures
const workspaceWithCaptures = await api.workspaces.getWithCaptures(workspaceId)
```

### Update Workspace

```typescript
const updated = await api.workspaces.update(workspaceId, {
  name: 'Updated name',
  status: 'in_progress',
  template: {
    what: 'Build user authentication system',
    requirements: ['OAuth 2.0', 'Session management'],
    design: 'JWT-based authentication',
    constraints: ['Must support SSO'],
    edgeCases: ['Token expiration', 'Refresh flow']
  }
})
```

### Delete Workspace

```typescript
await api.workspaces.delete(workspaceId)
```

### Add Capture to Workspace

```typescript
const linkId = await api.workspaces.addCapture(
  workspaceId,
  captureId,
  'requirements', // optional section
  'Additional notes' // optional notes
)
```

### Remove Capture from Workspace

```typescript
await api.workspaces.removeCapture(workspaceId, captureId)
```

### Reorder Captures

```typescript
await api.workspaces.reorderCaptures(workspaceId, [
  'capture-id-1',
  'capture-id-2',
  'capture-id-3'
])
```

### Add Member to Workspace

```typescript
await api.workspaces.addMember(workspaceId, userId, 'editor')
// Roles: 'owner', 'editor', 'commenter', 'viewer'
```

### Get Workspace Members

```typescript
const members = await api.workspaces.getMembers(workspaceId)
```

### Duplicate Workspace

```typescript
const newWorkspaceId = await api.workspaces.duplicate(
  workspaceId,
  'Q2 Planning (Copy)' // optional new name
)
```

### Archive Workspace

```typescript
await api.workspaces.archive(workspaceId)
```

### Search Workspaces

```typescript
const results = await api.workspaces.search('authentication', teamId)
```

## Collaboration

### Start Session

```typescript
const sessionId = await api.collaboration.startSession(workspaceId)
```

### Update Heartbeat

```typescript
await api.collaboration.updateHeartbeat(
  sessionId,
  { line: 10, column: 5 }, // optional cursor position
  'requirements' // optional active section
)

// Call every 30 seconds to maintain presence
```

### End Session

```typescript
await api.collaboration.endSession(sessionId)
```

### Get Active Collaborators

```typescript
const collaborators = await api.collaboration.getActiveCollaborators(workspaceId)

// Returns:
[
  {
    user_id: "uuid",
    display_name: "John Doe",
    avatar_url: "https://...",
    cursor_position: { line: 10, column: 5 },
    active_section: "requirements",
    last_heartbeat_at: "2026-01-27T..."
  }
]
```

## Comments

### Create Comment

```typescript
const comment = await api.comments.create({
  workspaceId: 'workspace-uuid',
  content: 'What about edge cases?',
  targetType: 'section', // 'workspace', 'section', 'capture'
  targetId: 'section-uuid',
  parentId: 'optional-parent-comment-uuid' // for threading
})
```

### List Comments

```typescript
// All workspace comments
const comments = await api.comments.list(workspaceId)

// For specific target
const sectionComments = await api.comments.list(
  workspaceId,
  'section',
  sectionId
)
```

### Resolve Comment

```typescript
await api.comments.resolve(commentId)
```

### Delete Comment

```typescript
await api.comments.delete(commentId)
```

## Analytics

### Workspace Stats

```typescript
const stats = await api.stats.workspace(workspaceId)

// Returns:
{
  total_captures: 15,
  total_sections: 8,
  total_comments: 23,
  total_members: 4,
  unresolved_comments: 3,
  last_activity_at: "2026-01-27T..."
}
```

### User Stats

```typescript
const stats = await api.stats.user()

// Returns:
{
  total_captures: 42,
  total_workspaces: 8,
  total_teams: 2,
  captures_this_week: 5,
  workspaces_this_week: 1
}
```

## Real-time Subscriptions

### Subscribe to Workspace Changes

```typescript
const channel = api.workspaces.subscribe(workspaceId, (payload) => {
  console.log('Workspace updated:', payload)
  // Handle update, insert, delete events
})

// Unsubscribe when done
channel.unsubscribe()
```

### Subscribe to Collaboration Changes

```typescript
const channel = api.collaboration.subscribe(workspaceId, (payload) => {
  console.log('Collaborator update:', payload)
  // Update presence indicators in UI
})

// Unsubscribe when done
channel.unsubscribe()
```

### Custom Subscriptions

```typescript
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, key)

// Subscribe to captures
const channel = supabase
  .channel('captures')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'captures'
  }, (payload) => {
    console.log('New capture:', payload.new)
  })
  .subscribe()
```

## Error Handling

All API methods throw `UpdateAIError` on failure:

```typescript
import { UpdateAIError } from './client'

try {
  await api.workspaces.create({ name: 'My Workspace' })
} catch (error) {
  if (error instanceof UpdateAIError) {
    console.error('Error code:', error.code)
    console.error('Message:', error.message)
    console.error('Details:', error.details)
  }
}
```

## Rate Limits

Supabase enforces the following limits (Free tier):

- **Queries**: 500 per second
- **Storage**: 500MB
- **Bandwidth**: 5GB per month
- **Real-time connections**: 200 concurrent

For production, upgrade to Pro or Enterprise tier.

## Best Practices

### 1. Use Real-time Subscriptions Wisely

Only subscribe to data you're actively displaying. Unsubscribe when components unmount.

```typescript
useEffect(() => {
  const channel = api.workspaces.subscribe(workspaceId, handleUpdate)
  return () => channel.unsubscribe()
}, [workspaceId])
```

### 2. Batch Operations

When adding multiple captures to a workspace:

```typescript
const promises = captureIds.map(id => 
  api.workspaces.addCapture(workspaceId, id)
)
await Promise.all(promises)
```

### 3. Handle Offline Mode

Use local state and sync when online:

```typescript
// Queue operations offline
if (!navigator.onLine) {
  queueOperation({ type: 'addCapture', ...data })
  return
}

// Sync when back online
window.addEventListener('online', syncQueuedOperations)
```

### 4. Optimize Queries

Use `select()` to limit returned fields:

```typescript
const { data } = await supabase
  .from('workspaces')
  .select('id, name, status')
  .eq('status', 'in_progress')
```

### 5. Cache Frequently Accessed Data

```typescript
const cache = new Map()

async function getWorkspace(id: string) {
  if (cache.has(id)) return cache.get(id)
  
  const workspace = await api.workspaces.get(id)
  cache.set(id, workspace)
  return workspace
}
```

## Support

- **Documentation**: https://supabase.com/docs
- **Discord**: https://discord.supabase.com
- **Email**: samyak@updateai.com
