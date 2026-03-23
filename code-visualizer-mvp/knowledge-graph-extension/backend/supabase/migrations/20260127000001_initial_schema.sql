-- UpdateAI Initial Schema Migration
-- This creates all core tables for the collaborative prompt workspace

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- ============================================================================
-- USERS & TEAMS
-- ============================================================================

-- User profiles (extends Supabase auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  preferences JSONB DEFAULT '{}'::jsonb,
  
  CONSTRAINT email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Teams/Organizations
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  avatar_url TEXT,
  settings JSONB DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT name_length CHECK (char_length(name) >= 2 AND char_length(name) <= 100),
  CONSTRAINT slug_format CHECK (slug ~* '^[a-z0-9-]+$')
);

-- Team membership with roles
CREATE TYPE team_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role team_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  
  UNIQUE(team_id, user_id)
);

-- ============================================================================
-- CAPTURES
-- ============================================================================

CREATE TYPE capture_type AS ENUM ('jira', 'slack', 'google-docs', 'github', 'figma', 'notion', 'custom');

CREATE TABLE public.captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  
  -- Capture details
  type capture_type NOT NULL,
  source TEXT NOT NULL, -- e.g., "PROJ-123", "#general", "Design Doc"
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Timestamps
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Search
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(source, '')), 'C')
  ) STORED,
  
  CONSTRAINT title_length CHECK (char_length(title) >= 1 AND char_length(title) <= 500),
  CONSTRAINT content_length CHECK (char_length(content) >= 1 AND char_length(content) <= 50000)
);

-- Index for full-text search
CREATE INDEX idx_captures_search ON public.captures USING gin(search_vector);
CREATE INDEX idx_captures_user_created ON public.captures(user_id, created_at DESC);
CREATE INDEX idx_captures_team_created ON public.captures(team_id, created_at DESC);
CREATE INDEX idx_captures_type ON public.captures(type);

-- ============================================================================
-- WORKSPACES
-- ============================================================================

CREATE TYPE workspace_status AS ENUM ('draft', 'in_progress', 'review', 'completed', 'archived');

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status workspace_status NOT NULL DEFAULT 'draft',
  
  -- Ownership
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  
  -- Template structure (flexible JSONB for prompt sections)
  template JSONB DEFAULT '{
    "what": "",
    "requirements": [],
    "design": "",
    "constraints": [],
    "edgeCases": []
  }'::jsonb,
  
  -- Settings
  settings JSONB DEFAULT '{
    "isPublic": false,
    "allowComments": true,
    "requireApproval": false
  }'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  
  -- Search
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) STORED,
  
  CONSTRAINT name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 200)
);

CREATE INDEX idx_workspaces_search ON public.workspaces USING gin(search_vector);
CREATE INDEX idx_workspaces_created_by ON public.workspaces(created_by, created_at DESC);
CREATE INDEX idx_workspaces_team ON public.workspaces(team_id, last_activity_at DESC);
CREATE INDEX idx_workspaces_status ON public.workspaces(status);

-- ============================================================================
-- WORKSPACE MEMBERS (Access Control)
-- ============================================================================

CREATE TYPE workspace_role AS ENUM ('owner', 'editor', 'commenter', 'viewer');

CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role workspace_role NOT NULL DEFAULT 'viewer',
  
  -- Timestamps
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_viewed_at TIMESTAMPTZ,
  
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id, joined_at DESC);
CREATE INDEX idx_workspace_members_workspace ON public.workspace_members(workspace_id);

-- ============================================================================
-- WORKSPACE CAPTURES (Link captures to workspaces)
-- ============================================================================

CREATE TABLE public.workspace_captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  capture_id UUID NOT NULL REFERENCES public.captures(id) ON DELETE CASCADE,
  
  -- Order and organization
  position INTEGER NOT NULL DEFAULT 0,
  section TEXT, -- Which section of the template this belongs to
  
  -- Metadata
  added_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  
  UNIQUE(workspace_id, capture_id)
);

CREATE INDEX idx_workspace_captures_workspace ON public.workspace_captures(workspace_id, position);
CREATE INDEX idx_workspace_captures_capture ON public.workspace_captures(capture_id);

-- ============================================================================
-- PROMPT SECTIONS (Structured prompt building)
-- ============================================================================

CREATE TYPE section_type AS ENUM ('text', 'list', 'code', 'table', 'heading');

CREATE TABLE public.prompt_sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  
  -- Section details
  type section_type NOT NULL DEFAULT 'text',
  title TEXT,
  content TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  
  -- Organization
  parent_id UUID REFERENCES public.prompt_sections(id) ON DELETE CASCADE,
  
  -- Metadata
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT content_length CHECK (char_length(content) <= 100000)
);

CREATE INDEX idx_prompt_sections_workspace ON public.prompt_sections(workspace_id, position);

-- ============================================================================
-- COLLABORATION SESSIONS (Real-time presence)
-- ============================================================================

CREATE TABLE public.collaboration_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Session details
  cursor_position JSONB, -- { line, column, selection }
  active_section TEXT,
  
  -- Status
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  
  CONSTRAINT active_session CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX idx_collaboration_sessions_workspace ON public.collaboration_sessions(workspace_id, last_heartbeat_at DESC)
  WHERE ended_at IS NULL;
CREATE INDEX idx_collaboration_sessions_user ON public.collaboration_sessions(user_id);

-- ============================================================================
-- COMMENTS & ACTIVITY
-- ============================================================================

CREATE TABLE public.comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  
  -- Comment details
  content TEXT NOT NULL,
  target_type TEXT NOT NULL, -- 'workspace', 'section', 'capture'
  target_id UUID NOT NULL,
  
  -- Threading
  parent_id UUID REFERENCES public.comments(id) ON DELETE CASCADE,
  
  -- Status
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  
  CONSTRAINT content_length CHECK (char_length(content) >= 1 AND char_length(content) <= 10000)
);

CREATE INDEX idx_comments_workspace ON public.comments(workspace_id, created_at DESC);
CREATE INDEX idx_comments_target ON public.comments(target_type, target_id);
CREATE INDEX idx_comments_user ON public.comments(user_id, created_at DESC);

-- Activity log for audit trail
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
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  
  -- Activity details
  activity_type activity_type NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT description_length CHECK (char_length(description) <= 1000)
);

CREATE INDEX idx_activity_log_workspace ON public.activity_log(workspace_id, created_at DESC);
CREATE INDEX idx_activity_log_user ON public.activity_log(user_id, created_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_captures_updated_at BEFORE UPDATE ON public.captures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_prompt_sections_updated_at BEFORE UPDATE ON public.prompt_sections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Update workspace last_activity_at on related changes
CREATE OR REPLACE FUNCTION update_workspace_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.workspaces 
  SET last_activity_at = NOW() 
  WHERE id = COALESCE(NEW.workspace_id, OLD.workspace_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workspace_activity_on_capture AFTER INSERT OR UPDATE OR DELETE ON public.workspace_captures
  FOR EACH ROW EXECUTE FUNCTION update_workspace_activity();

CREATE TRIGGER update_workspace_activity_on_section AFTER INSERT OR UPDATE OR DELETE ON public.prompt_sections
  FOR EACH ROW EXECUTE FUNCTION update_workspace_activity();

CREATE TRIGGER update_workspace_activity_on_comment AFTER INSERT OR UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION update_workspace_activity();
