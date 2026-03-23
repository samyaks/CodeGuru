/**
 * UpdateAI Database Types
 * Auto-generated types for Supabase database schema
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================================================
// ENUMS
// ============================================================================

export enum TeamRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member'
}

export enum WorkspaceRole {
  OWNER = 'owner',
  EDITOR = 'editor',
  COMMENTER = 'commenter',
  VIEWER = 'viewer'
}

export enum CaptureType {
  JIRA = 'jira',
  SLACK = 'slack',
  GOOGLE_DOCS = 'google-docs',
  GITHUB = 'github',
  FIGMA = 'figma',
  NOTION = 'notion',
  CUSTOM = 'custom'
}

export enum WorkspaceStatus {
  DRAFT = 'draft',
  IN_PROGRESS = 'in_progress',
  REVIEW = 'review',
  COMPLETED = 'completed',
  ARCHIVED = 'archived'
}

export enum SectionType {
  TEXT = 'text',
  LIST = 'list',
  CODE = 'code',
  TABLE = 'table',
  HEADING = 'heading'
}

export enum ActivityType {
  WORKSPACE_CREATED = 'workspace_created',
  WORKSPACE_UPDATED = 'workspace_updated',
  WORKSPACE_DELETED = 'workspace_deleted',
  CAPTURE_ADDED = 'capture_added',
  CAPTURE_REMOVED = 'capture_removed',
  MEMBER_ADDED = 'member_added',
  MEMBER_REMOVED = 'member_removed',
  ROLE_CHANGED = 'role_changed',
  SECTION_CREATED = 'section_created',
  SECTION_UPDATED = 'section_updated',
  SECTION_DELETED = 'section_deleted',
  COMMENT_ADDED = 'comment_added',
  STATUS_CHANGED = 'status_changed'
}

// ============================================================================
// TABLE TYPES
// ============================================================================

export interface User {
  id: string
  email: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
  last_seen_at: string | null
  preferences: Json
}

export interface Team {
  id: string
  name: string
  slug: string | null
  avatar_url: string | null
  settings: Json
  created_by: string
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: TeamRole
  joined_at: string
  invited_by: string | null
}

export interface Capture {
  id: string
  user_id: string
  team_id: string | null
  type: CaptureType
  source: string
  title: string
  content: string
  url: string | null
  metadata: Json
  tags: string[]
  captured_at: string
  created_at: string
  updated_at: string
}

export interface Workspace {
  id: string
  name: string
  description: string | null
  status: WorkspaceStatus
  created_by: string
  team_id: string | null
  template: Json
  settings: Json
  created_at: string
  updated_at: string
  last_activity_at: string
  completed_at: string | null
  archived_at: string | null
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  joined_at: string
  invited_by: string | null
  last_viewed_at: string | null
}

export interface WorkspaceCapture {
  id: string
  workspace_id: string
  capture_id: string
  position: number
  section: string | null
  added_by: string
  added_at: string
  notes: string | null
}

export interface PromptSection {
  id: string
  workspace_id: string
  type: SectionType
  title: string | null
  content: string
  position: number
  parent_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface CollaborationSession {
  id: string
  workspace_id: string
  user_id: string
  cursor_position: Json | null
  active_section: string | null
  started_at: string
  last_heartbeat_at: string
  ended_at: string | null
}

export interface Comment {
  id: string
  workspace_id: string
  user_id: string
  content: string
  target_type: string
  target_id: string
  parent_id: string | null
  is_resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  edited_at: string | null
}

export interface ActivityLog {
  id: string
  workspace_id: string | null
  user_id: string | null
  activity_type: ActivityType
  description: string
  metadata: Json
  created_at: string
}

// ============================================================================
// DATABASE SCHEMA
// ============================================================================

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, 'created_at' | 'updated_at'>
        Update: Partial<Omit<User, 'id' | 'created_at'>>
      }
      teams: {
        Row: Team
        Insert: Omit<Team, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Team, 'id' | 'created_at' | 'created_by'>>
      }
      team_members: {
        Row: TeamMember
        Insert: Omit<TeamMember, 'id' | 'joined_at'>
        Update: Partial<Omit<TeamMember, 'id' | 'team_id' | 'user_id' | 'joined_at'>>
      }
      captures: {
        Row: Capture
        Insert: Omit<Capture, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Capture, 'id' | 'user_id' | 'created_at'>>
      }
      workspaces: {
        Row: Workspace
        Insert: Omit<Workspace, 'id' | 'created_at' | 'updated_at' | 'last_activity_at'>
        Update: Partial<Omit<Workspace, 'id' | 'created_by' | 'created_at'>>
      }
      workspace_members: {
        Row: WorkspaceMember
        Insert: Omit<WorkspaceMember, 'id' | 'joined_at'>
        Update: Partial<Omit<WorkspaceMember, 'id' | 'workspace_id' | 'user_id' | 'joined_at'>>
      }
      workspace_captures: {
        Row: WorkspaceCapture
        Insert: Omit<WorkspaceCapture, 'id' | 'added_at'>
        Update: Partial<Omit<WorkspaceCapture, 'id' | 'workspace_id' | 'capture_id' | 'added_by' | 'added_at'>>
      }
      prompt_sections: {
        Row: PromptSection
        Insert: Omit<PromptSection, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PromptSection, 'id' | 'workspace_id' | 'created_by' | 'created_at'>>
      }
      collaboration_sessions: {
        Row: CollaborationSession
        Insert: Omit<CollaborationSession, 'id' | 'started_at' | 'last_heartbeat_at'>
        Update: Partial<Omit<CollaborationSession, 'id' | 'workspace_id' | 'user_id' | 'started_at'>>
      }
      comments: {
        Row: Comment
        Insert: Omit<Comment, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Comment, 'id' | 'workspace_id' | 'user_id' | 'created_at'>>
      }
      activity_log: {
        Row: ActivityLog
        Insert: Omit<ActivityLog, 'id' | 'created_at'>
        Update: never // Activity log is append-only
      }
    }
    Functions: {
      // Add function types as needed
      create_team: {
        Args: { team_name: string; team_slug?: string }
        Returns: string
      }
      create_workspace: {
        Args: { workspace_name: string; workspace_description?: string; workspace_team_id?: string }
        Returns: string
      }
      add_capture_to_workspace: {
        Args: { workspace_uuid: string; capture_uuid: string; section_name?: string; capture_notes?: string }
        Returns: string
      }
      search_captures: {
        Args: { search_query: string; limit_count?: number; team_uuid?: string }
        Returns: Array<Capture & { rank: number }>
      }
      search_workspaces: {
        Args: { search_query: string; limit_count?: number; team_uuid?: string }
        Returns: Array<Workspace & { rank: number }>
      }
    }
  }
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface WorkspaceWithMembers extends Workspace {
  members: (WorkspaceMember & { user: User })[]
}

export interface WorkspaceWithCaptures extends Workspace {
  captures: (WorkspaceCapture & { capture: Capture })[]
}

export interface WorkspaceWithAll extends Workspace {
  members: (WorkspaceMember & { user: User })[]
  captures: (WorkspaceCapture & { capture: Capture })[]
  sections: PromptSection[]
  activity: ActivityLog[]
}

export interface CaptureWithWorkspaces extends Capture {
  workspaces: (WorkspaceCapture & { workspace: Workspace })[]
}

export interface TeamWithMembers extends Team {
  members: (TeamMember & { user: User })[]
}
