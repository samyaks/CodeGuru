# UpdateAI Database Schema

Comprehensive documentation of the database schema, relationships, and constraints.

## Schema Overview

```
┌─────────────────┐
│     auth.users  │  (Supabase Auth)
└────────┬────────┘
         │
         │ 1:1
         ▼
┌─────────────────┐       ┌──────────────────┐
│  public.users   │◄──┬───│  team_members    │
└────────┬────────┘   │   └────────┬─────────┘
         │            │            │
         │            │            │ N:1
         │ 1:N        │ N:1        ▼
         │            │   ┌─────────────────┐
         │            └───│  teams          │
         │                └─────────────────┘
         │
         ├─────► captures (1:N)
         │
         ├─────► workspaces (1:N as creator)
         │
         ├─────► workspace_members (1:N)
         │
         ├─────► collaboration_sessions (1:N)
         │
         └─────► comments (1:N)

┌─────────────────┐
│  workspaces     │
└────────┬────────┘
         │
         ├─────► workspace_captures (1:N) ────► captures (N:1)
         │
         ├─────► workspace_members (1:N) ────► users (N:1)
         │
         ├─────► prompt_sections (1:N)
         │
         ├─────► collaboration_sessions (1:N)
         │
         ├─────► comments (1:N)
         │
         └─────► activity_log (1:N)
```

## Tables

### users

User profiles extending Supabase Auth.

```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  preferences JSONB DEFAULT '{}'
);
```

**Fields:**
- `id`: User UUID (from auth.users)
- `email`: User email address
- `display_name`: Public display name
- `avatar_url`: Profile picture URL
- `preferences`: User settings (theme, notifications, etc.)

**Indexes:**
- Primary key on `id`
- Unique constraint on `email`

**Triggers:**
- `update_updated_at`: Auto-update timestamp on changes
- `on_auth_user_created`: Auto-create profile on signup

---

### teams

Organizations or teams for multi-user collaboration.

```sql
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  avatar_url TEXT,
  settings JSONB DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Fields:**
- `name`: Team name (2-100 chars)
- `slug`: URL-friendly identifier
- `settings`: Team configuration

**Relationships:**
- `created_by` → `users.id` (team creator)
- `team_members` (1:N) - team membership

---

### team_members

Team membership with role-based access control.

```sql
CREATE TYPE team_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID REFERENCES public.users(id),
  UNIQUE(team_id, user_id)
);
```

**Roles:**
- `owner`: Full control, can delete team
- `admin`: Can manage members and settings
- `member`: Can view and create content

**Constraints:**
- Unique (team_id, user_id) - one membership per user per team
- Cannot remove owner through RLS

---

### captures

Context captured from various sources (Jira, Slack, Docs, etc).

```sql
CREATE TYPE capture_type AS ENUM (
  'jira', 'slack', 'google-docs', 'github', 
  'figma', 'notion', 'custom'
);

CREATE TABLE public.captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  type capture_type NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  metadata JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(source, '')), 'C')
  ) STORED
);
```

**Fields:**
- `type`: Source platform
- `source`: Platform-specific identifier (e.g., "PROJ-123", "#general")
- `title`: Short description
- `content`: Full captured text (max 50,000 chars)
- `metadata`: Platform-specific data
- `tags`: User-defined tags for organization
- `search_vector`: Full-text search index

**Indexes:**
- GIN index on `search_vector` for full-text search
- Index on `(user_id, created_at DESC)`
- Index on `(team_id, created_at DESC)`
- Index on `type`

---

### workspaces

Collaborative prompt workspaces.

```sql
CREATE TYPE workspace_status AS ENUM (
  'draft', 'in_progress', 'review', 'completed', 'archived'
);

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status workspace_status NOT NULL DEFAULT 'draft',
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  template JSONB DEFAULT '{
    "what": "",
    "requirements": [],
    "design": "",
    "constraints": [],
    "edgeCases": []
  }',
  settings JSONB DEFAULT '{
    "isPublic": false,
    "allowComments": true,
    "requireApproval": false
  }',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  search_vector tsvector GENERATED
);
```

**Status Flow:**
```
draft → in_progress → review → completed
                  ↓
              archived (from any status)
```

**Template Structure:**
```typescript
{
  what: string              // What are we building?
  requirements: string[]    // Requirements list
  design: string           // Design approach
  constraints: string[]    // Technical constraints
  edgeCases: string[]      // Edge cases to handle
}
```

**Relationships:**
- `created_by` → `users.id`
- `team_id` → `teams.id`
- `workspace_members` (1:N)
- `workspace_captures` (1:N)
- `prompt_sections` (1:N)

---

### workspace_members

Access control for workspaces.

```sql
CREATE TYPE workspace_role AS ENUM (
  'owner', 'editor', 'commenter', 'viewer'
);

CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role workspace_role NOT NULL DEFAULT 'viewer',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID REFERENCES public.users(id),
  last_viewed_at TIMESTAMPTZ,
  UNIQUE(workspace_id, user_id)
);
```

**Permissions Matrix:**

| Action | Owner | Editor | Commenter | Viewer |
|--------|-------|--------|-----------|--------|
| View | ✅ | ✅ | ✅ | ✅ |
| Edit content | ✅ | ✅ | ❌ | ❌ |
| Add/remove captures | ✅ | ✅ | ❌ | ❌ |
| Comment | ✅ | ✅ | ✅ | ❌ |
| Add members | ✅ | ✅ | ❌ | ❌ |
| Change settings | ✅ | ❌ | ❌ | ❌ |
| Delete workspace | ✅ | ❌ | ❌ | ❌ |

---

### workspace_captures

Links captures to workspaces with organization.

```sql
CREATE TABLE public.workspace_captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  capture_id UUID NOT NULL REFERENCES public.captures(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  section TEXT,  -- Template section: 'what', 'requirements', etc.
  added_by UUID NOT NULL REFERENCES public.users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  UNIQUE(workspace_id, capture_id)
);
```

**Fields:**
- `position`: Sort order within workspace
- `section`: Which template section this belongs to
- `notes`: Additional context for this capture in this workspace

**Triggers:**
- Updates `workspace.last_activity_at` on insert/update/delete

---

### prompt_sections

Structured sections of the prompt document.

```sql
CREATE TYPE section_type AS ENUM (
  'text', 'list', 'code', 'table', 'heading'
);

CREATE TABLE public.prompt_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type section_type NOT NULL DEFAULT 'text',
  title TEXT,
  content TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  parent_id UUID REFERENCES public.prompt_sections(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Section Types:**
- `text`: Free-form text
- `list`: Bullet/numbered list
- `code`: Code block with syntax highlighting
- `table`: Tabular data
- `heading`: Section heading

**Hierarchy:**
Sections can be nested using `parent_id` for document structure.

---

### collaboration_sessions

Real-time presence tracking.

```sql
CREATE TABLE public.collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cursor_position JSONB,  -- { line, column, selection }
  active_section TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
```

**Session Management:**
- Sessions auto-expire after 5 minutes of inactivity
- Clients should send heartbeat every 30 seconds
- `cursor_position` shows where user is editing
- `active_section` shows which part they're viewing

**Cleanup:**
Scheduled job runs `cleanup_stale_sessions()` to mark inactive sessions as ended.

---

### comments

Threaded comments on workspaces and sections.

```sql
CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  target_type TEXT NOT NULL,  -- 'workspace', 'section', 'capture'
  target_id UUID NOT NULL,
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);
```

**Threading:**
Use `parent_id` to create comment threads. Top-level comments have `parent_id = NULL`.

**Resolution:**
Comments can be marked resolved by workspace editors. Useful for addressing feedback.

---

### activity_log

Audit trail of all workspace activities.

```sql
CREATE TYPE activity_type AS ENUM (
  'workspace_created', 'workspace_updated', 'workspace_deleted',
  'capture_added', 'capture_removed',
  'member_added', 'member_removed', 'role_changed',
  'section_created', 'section_updated', 'section_deleted',
  'comment_added', 'status_changed'
);

CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id),
  activity_type activity_type NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Usage:**
Provides complete audit trail. Display in "Activity Feed" UI.

---

## Constraints & Validation

### Field Length Limits

| Field | Min | Max |
|-------|-----|-----|
| Team name | 2 | 100 |
| Workspace name | 1 | 200 |
| Capture title | 1 | 500 |
| Capture content | 1 | 50,000 |
| Comment content | 1 | 10,000 |
| Section content | 1 | 100,000 |

### Format Validation

- **Email**: Standard email regex
- **Slug**: `^[a-z0-9-]+$` (lowercase, numbers, hyphens)
- **URLs**: Must be http:// or https://

### Business Rules

1. **Team owners cannot be removed** (enforced by RLS)
2. **Workspace creators cannot be removed** (ON DELETE RESTRICT)
3. **One membership per user per team** (UNIQUE constraint)
4. **Sessions expire after 5 minutes** (cleanup function)
5. **Captures must have content** (CHECK constraint)

---

## Indexes & Performance

### Full-Text Search

```sql
-- Captures
CREATE INDEX idx_captures_search ON captures USING gin(search_vector);

-- Workspaces
CREATE INDEX idx_workspaces_search ON workspaces USING gin(search_vector);
```

### Common Query Patterns

```sql
-- User's recent captures
CREATE INDEX idx_captures_user_created ON captures(user_id, created_at DESC);

-- Active workspaces
CREATE INDEX idx_workspaces_team ON workspaces(team_id, last_activity_at DESC);

-- Workspace captures (ordered)
CREATE INDEX idx_workspace_captures_workspace ON workspace_captures(workspace_id, position);

-- Active collaborators
CREATE INDEX idx_collaboration_sessions_workspace 
  ON collaboration_sessions(workspace_id, last_heartbeat_at DESC)
  WHERE ended_at IS NULL;
```

---

## Migration Strategy

### Adding New Fields

```sql
-- Add field with default
ALTER TABLE workspaces ADD COLUMN priority INTEGER DEFAULT 0;

-- Backfill existing data if needed
UPDATE workspaces SET priority = 5 WHERE status = 'in_progress';
```

### Modifying Enums

```sql
-- Add new enum value
ALTER TYPE capture_type ADD VALUE 'linear';

-- Cannot remove enum values - create new type instead
```

### Data Migrations

Use Supabase migrations to version control schema changes:

```bash
supabase migration new add_priority_field
```

---

## Backup & Recovery

### Automatic Backups

Supabase Pro/Enterprise includes daily backups with point-in-time recovery.

### Manual Export

```bash
# Export entire database
pg_dump -h db.xxx.supabase.co -U postgres -d postgres > backup.sql

# Export specific tables
pg_dump -h db.xxx.supabase.co -U postgres -t captures -t workspaces > data.sql
```

### Restore

```bash
psql -h db.xxx.supabase.co -U postgres -d postgres < backup.sql
```

---

## Monitoring

### Key Metrics

- Table sizes: `pg_total_relation_size('workspaces')`
- Query performance: Enable pg_stat_statements
- Index usage: Check `pg_stat_user_indexes`

### Alerts

Set up alerts for:
- Database size > 80% of quota
- Connection pool exhaustion
- Slow queries > 5 seconds
- Failed RLS checks (security)

---

## Related Documentation

- [API Documentation](./API.md)
- [Security Policies](./SECURITY.md)
- [Supabase Docs](https://supabase.com/docs)
