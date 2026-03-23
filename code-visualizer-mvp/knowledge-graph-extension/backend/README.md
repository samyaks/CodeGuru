# UpdateAI Backend

Backend infrastructure for UpdateAI - a collaborative prompt workspace platform.

## Technology Stack

- **Database**: Supabase (PostgreSQL)
- **Real-time**: Supabase Realtime subscriptions
- **Authentication**: Supabase Auth
- **Storage**: Supabase Storage (for future file uploads)
- **API**: Auto-generated REST API + TypeScript client

## Architecture

```
backend/
├── supabase/
│   ├── migrations/          # Database migrations
│   ├── functions/           # Database functions
│   └── config.toml          # Supabase config
├── src/
│   ├── client/              # TypeScript API client
│   ├── types/               # Shared TypeScript types
│   └── utils/               # Helper utilities
├── docs/
│   ├── API.md               # API documentation
│   ├── SCHEMA.md            # Database schema docs
│   └── SECURITY.md          # Security policies docs
└── scripts/                 # Setup and deployment scripts
```

## Quick Start

### 1. Install Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Windows (PowerShell)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Linux
brew install supabase/tap/supabase
```

### 2. Initialize Supabase Project

```bash
cd backend
supabase init
```

### 3. Start Local Development

```bash
supabase start
```

This will start:
- PostgreSQL database (port 5432)
- API server (port 54321)
- Studio (port 54323)
- Auth server (port 54324)

### 4. Apply Migrations

```bash
supabase db reset
```

### 5. Get Connection Details

```bash
supabase status
```

Save these values to your `.env` file:
```env
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## Production Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and API keys

### 2. Link Local to Production

```bash
supabase link --project-ref your-project-ref
```

### 3. Push Migrations

```bash
supabase db push
```

### 4. Update Environment Variables

Update your extension and frontend with production credentials:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_production_anon_key
```

## Database Schema Overview

### Core Tables

- **users** - User profiles (extends Supabase auth.users)
- **teams** - Organizations/teams
- **team_members** - User-team relationships with roles
- **workspaces** - Collaborative prompt documents
- **workspace_members** - Workspace access control
- **captures** - Context captured from various sources
- **prompt_sections** - Structured sections of prompts
- **collaboration_sessions** - Active real-time sessions

See [SCHEMA.md](./docs/SCHEMA.md) for detailed schema documentation.

## API Client Usage

### Installation

```typescript
import { createClient } from '@supabase/supabase-js'
import { UpdateAIClient } from './backend/src/client'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

const api = new UpdateAIClient(supabase)
```

### Examples

```typescript
// Create a workspace
const workspace = await api.workspaces.create({
  name: 'Q1 Planning',
  status: 'draft'
})

// Add a capture
const capture = await api.captures.create({
  type: 'jira',
  source: 'PROJ-123',
  content: 'Issue description...',
  url: 'https://jira.company.com/...'
})

// Link capture to workspace
await api.workspaces.addCapture(workspace.id, capture.id)

// Subscribe to real-time changes
api.workspaces.subscribe(workspace.id, (payload) => {
  console.log('Workspace updated:', payload)
})
```

See [API.md](./docs/API.md) for complete API documentation.

## Security

- **Row-level security (RLS)** enabled on all tables
- **Multi-tenant** - Users only see their own data
- **Team-based access control** - Workspace sharing within teams
- **Rate limiting** - Built into Supabase
- **Input validation** - PostgreSQL constraints + client-side validation

See [SECURITY.md](./docs/SECURITY.md) for security documentation.

## Development

### Run Tests

```bash
npm test
```

### Generate Types

```bash
supabase gen types typescript --local > src/types/database.ts
```

### Create New Migration

```bash
supabase migration new migration_name
```

## Support

For issues or questions, contact: samyak@updateai.com
