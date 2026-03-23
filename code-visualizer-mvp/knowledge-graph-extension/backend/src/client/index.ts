/**
 * UpdateAI API Client
 * TypeScript client for interacting with UpdateAI backend
 */

import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { Database, Capture, Workspace, User, Team, WorkspaceCapture, CaptureType, WorkspaceStatus } from '../types/database'

export type TypedSupabaseClient = SupabaseClient<Database>

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class UpdateAIError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message)
    this.name = 'UpdateAIError'
  }
}

function handleError(error: any): never {
  if (error.code) {
    throw new UpdateAIError(error.message || 'An error occurred', error.code, error.details)
  }
  throw new Error(error.message || 'An unexpected error occurred')
}

// ============================================================================
// API CLIENT
// ============================================================================

export class UpdateAIClient {
  constructor(private supabase: TypedSupabaseClient) {}

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================

  auth = {
    /**
     * Get current user
     */
    getCurrentUser: async () => {
      const { data: { user }, error } = await this.supabase.auth.getUser()
      if (error) handleError(error)
      return user
    },

    /**
     * Sign in with email and password
     */
    signIn: async (email: string, password: string) => {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      })
      if (error) handleError(error)
      return data
    },

    /**
     * Sign up with email and password
     */
    signUp: async (email: string, password: string, displayName?: string) => {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      })
      if (error) handleError(error)
      return data
    },

    /**
     * Sign out
     */
    signOut: async () => {
      const { error } = await this.supabase.auth.signOut()
      if (error) handleError(error)
    },

    /**
     * Update last seen timestamp
     */
    updateLastSeen: async () => {
      const { error } = await this.supabase.rpc('update_last_seen')
      if (error) handleError(error)
    }
  }

  // ==========================================================================
  // USERS
  // ==========================================================================

  users = {
    /**
     * Get user profile
     */
    get: async (userId: string): Promise<User> => {
      const { data, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Update user profile
     */
    update: async (updates: Partial<User>) => {
      const { data, error } = await this.supabase
        .from('users')
        .update(updates)
        .eq('id', (await this.auth.getCurrentUser())!.id)
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    }
  }

  // ==========================================================================
  // TEAMS
  // ==========================================================================

  teams = {
    /**
     * Create a new team
     */
    create: async (name: string, slug?: string): Promise<string> => {
      const { data, error } = await this.supabase
        .rpc('create_team', { team_name: name, team_slug: slug })
      
      if (error) handleError(error)
      return data
    },

    /**
     * List user's teams
     */
    list: async (): Promise<Team[]> => {
      const { data, error } = await this.supabase
        .from('teams')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get team by ID
     */
    get: async (teamId: string): Promise<Team> => {
      const { data, error } = await this.supabase
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Update team
     */
    update: async (teamId: string, updates: Partial<Team>) => {
      const { data, error } = await this.supabase
        .from('teams')
        .update(updates)
        .eq('id', teamId)
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Add member to team
     */
    addMember: async (teamId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member') => {
      const { data, error } = await this.supabase
        .from('team_members')
        .insert({ team_id: teamId, user_id: userId, role })
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get team members
     */
    getMembers: async (teamId: string) => {
      const { data, error } = await this.supabase
        .from('team_members')
        .select('*, user:users(*)')
        .eq('team_id', teamId)
      
      if (error) handleError(error)
      return data
    }
  }

  // ==========================================================================
  // CAPTURES
  // ==========================================================================

  captures = {
    /**
     * Create a new capture
     */
    create: async (capture: {
      type: CaptureType
      source: string
      title: string
      content: string
      url?: string
      metadata?: any
      tags?: string[]
      teamId?: string
    }): Promise<Capture> => {
      const { data, error } = await this.supabase
        .from('captures')
        .insert({
          type: capture.type,
          source: capture.source,
          title: capture.title,
          content: capture.content,
          url: capture.url,
          metadata: capture.metadata || {},
          tags: capture.tags || [],
          team_id: capture.teamId,
          user_id: (await this.auth.getCurrentUser())!.id,
          captured_at: new Date().toISOString()
        })
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * List user's captures
     */
    list: async (options?: {
      type?: CaptureType
      teamId?: string
      limit?: number
      offset?: number
    }): Promise<Capture[]> => {
      let query = this.supabase
        .from('captures')
        .select('*')
        .order('captured_at', { ascending: false })
      
      if (options?.type) {
        query = query.eq('type', options.type)
      }
      
      if (options?.teamId) {
        query = query.eq('team_id', options.teamId)
      }
      
      if (options?.limit) {
        query = query.limit(options.limit)
      }
      
      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1)
      }
      
      const { data, error } = await query
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get capture by ID
     */
    get: async (captureId: string): Promise<Capture> => {
      const { data, error } = await this.supabase
        .from('captures')
        .select('*')
        .eq('id', captureId)
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Update capture
     */
    update: async (captureId: string, updates: Partial<Capture>) => {
      const { data, error } = await this.supabase
        .from('captures')
        .update(updates)
        .eq('id', captureId)
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Delete capture
     */
    delete: async (captureId: string) => {
      const { error } = await this.supabase
        .from('captures')
        .delete()
        .eq('id', captureId)
      
      if (error) handleError(error)
    },

    /**
     * Search captures
     */
    search: async (query: string, teamId?: string): Promise<Capture[]> => {
      const { data, error } = await this.supabase
        .rpc('search_captures', {
          search_query: query,
          team_uuid: teamId
        })
      
      if (error) handleError(error)
      return data
    }
  }

  // ==========================================================================
  // WORKSPACES
  // ==========================================================================

  workspaces = {
    /**
     * Create a new workspace
     */
    create: async (workspace: {
      name: string
      description?: string
      teamId?: string
      status?: WorkspaceStatus
    }): Promise<string> => {
      const { data, error } = await this.supabase
        .rpc('create_workspace', {
          workspace_name: workspace.name,
          workspace_description: workspace.description,
          workspace_team_id: workspace.teamId
        })
      
      if (error) handleError(error)
      return data
    },

    /**
     * List user's workspaces
     */
    list: async (options?: {
      status?: WorkspaceStatus
      teamId?: string
      limit?: number
    }): Promise<Workspace[]> => {
      let query = this.supabase
        .from('workspaces')
        .select('*')
        .order('last_activity_at', { ascending: false })
      
      if (options?.status) {
        query = query.eq('status', options.status)
      }
      
      if (options?.teamId) {
        query = query.eq('team_id', options.teamId)
      }
      
      if (options?.limit) {
        query = query.limit(options.limit)
      }
      
      const { data, error } = await query
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get workspace by ID with related data
     */
    get: async (workspaceId: string): Promise<Workspace> => {
      const { data, error } = await this.supabase
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get workspace with captures
     */
    getWithCaptures: async (workspaceId: string) => {
      const { data, error } = await this.supabase
        .from('workspaces')
        .select(`
          *,
          captures:workspace_captures(
            *,
            capture:captures(*)
          )
        `)
        .eq('id', workspaceId)
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Update workspace
     */
    update: async (workspaceId: string, updates: Partial<Workspace>) => {
      const { data, error } = await this.supabase
        .from('workspaces')
        .update(updates)
        .eq('id', workspaceId)
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Delete workspace
     */
    delete: async (workspaceId: string) => {
      const { error } = await this.supabase
        .from('workspaces')
        .delete()
        .eq('id', workspaceId)
      
      if (error) handleError(error)
    },

    /**
     * Add capture to workspace
     */
    addCapture: async (workspaceId: string, captureId: string, section?: string, notes?: string): Promise<string> => {
      const { data, error } = await this.supabase
        .rpc('add_capture_to_workspace', {
          workspace_uuid: workspaceId,
          capture_uuid: captureId,
          section_name: section,
          capture_notes: notes
        })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Remove capture from workspace
     */
    removeCapture: async (workspaceId: string, captureId: string) => {
      const { error } = await this.supabase
        .from('workspace_captures')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('capture_id', captureId)
      
      if (error) handleError(error)
    },

    /**
     * Reorder captures
     */
    reorderCaptures: async (workspaceId: string, captureOrder: string[]) => {
      const { error } = await this.supabase
        .rpc('reorder_workspace_captures', {
          workspace_uuid: workspaceId,
          capture_order: captureOrder
        })
      
      if (error) handleError(error)
    },

    /**
     * Add member to workspace
     */
    addMember: async (workspaceId: string, userId: string, role: 'owner' | 'editor' | 'commenter' | 'viewer' = 'viewer') => {
      const { data, error } = await this.supabase
        .from('workspace_members')
        .insert({ workspace_id: workspaceId, user_id: userId, role })
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get workspace members
     */
    getMembers: async (workspaceId: string) => {
      const { data, error } = await this.supabase
        .from('workspace_members')
        .select('*, user:users(*)')
        .eq('workspace_id', workspaceId)
      
      if (error) handleError(error)
      return data
    },

    /**
     * Duplicate workspace
     */
    duplicate: async (workspaceId: string, newName?: string): Promise<string> => {
      const { data, error } = await this.supabase
        .rpc('duplicate_workspace', {
          workspace_uuid: workspaceId,
          new_name: newName
        })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Archive workspace
     */
    archive: async (workspaceId: string) => {
      const { error } = await this.supabase
        .rpc('archive_workspace', { workspace_uuid: workspaceId })
      
      if (error) handleError(error)
    },

    /**
     * Search workspaces
     */
    search: async (query: string, teamId?: string): Promise<Workspace[]> => {
      const { data, error } = await this.supabase
        .rpc('search_workspaces', {
          search_query: query,
          team_uuid: teamId
        })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Subscribe to workspace changes (real-time)
     */
    subscribe: (workspaceId: string, callback: (payload: any) => void): RealtimeChannel => {
      return this.supabase
        .channel(`workspace:${workspaceId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'workspaces',
          filter: `id=eq.${workspaceId}`
        }, callback)
        .subscribe()
    }
  }

  // ==========================================================================
  // COLLABORATION
  // ==========================================================================

  collaboration = {
    /**
     * Start collaboration session
     */
    startSession: async (workspaceId: string): Promise<string> => {
      const { data, error } = await this.supabase
        .rpc('start_collaboration_session', { workspace_uuid: workspaceId })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Update session heartbeat
     */
    updateHeartbeat: async (sessionId: string, cursorPosition?: any, activeSection?: string) => {
      const { error } = await this.supabase
        .rpc('update_session_heartbeat', {
          session_uuid: sessionId,
          cursor_pos: cursorPosition,
          active_sec: activeSection
        })
      
      if (error) handleError(error)
    },

    /**
     * End session
     */
    endSession: async (sessionId: string) => {
      const { error } = await this.supabase
        .rpc('end_collaboration_session', { session_uuid: sessionId })
      
      if (error) handleError(error)
    },

    /**
     * Get active collaborators
     */
    getActiveCollaborators: async (workspaceId: string) => {
      const { data, error } = await this.supabase
        .rpc('get_active_collaborators', { workspace_uuid: workspaceId })
      
      if (error) handleError(error)
      return data
    },

    /**
     * Subscribe to collaboration changes
     */
    subscribe: (workspaceId: string, callback: (payload: any) => void): RealtimeChannel => {
      return this.supabase
        .channel(`collaboration:${workspaceId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'collaboration_sessions',
          filter: `workspace_id=eq.${workspaceId}`
        }, callback)
        .subscribe()
    }
  }

  // ==========================================================================
  // COMMENTS
  // ==========================================================================

  comments = {
    /**
     * Add comment
     */
    create: async (comment: {
      workspaceId: string
      content: string
      targetType: string
      targetId: string
      parentId?: string
    }) => {
      const { data, error } = await this.supabase
        .from('comments')
        .insert({
          workspace_id: comment.workspaceId,
          user_id: (await this.auth.getCurrentUser())!.id,
          content: comment.content,
          target_type: comment.targetType,
          target_id: comment.targetId,
          parent_id: comment.parentId
        })
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get comments for target
     */
    list: async (workspaceId: string, targetType?: string, targetId?: string) => {
      let query = this.supabase
        .from('comments')
        .select('*, user:users(*)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })
      
      if (targetType) {
        query = query.eq('target_type', targetType)
      }
      
      if (targetId) {
        query = query.eq('target_id', targetId)
      }
      
      const { data, error } = await query
      
      if (error) handleError(error)
      return data
    },

    /**
     * Resolve comment
     */
    resolve: async (commentId: string) => {
      const { data, error } = await this.supabase
        .from('comments')
        .update({
          is_resolved: true,
          resolved_by: (await this.auth.getCurrentUser())!.id,
          resolved_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .select()
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Delete comment
     */
    delete: async (commentId: string) => {
      const { error } = await this.supabase
        .from('comments')
        .delete()
        .eq('id', commentId)
      
      if (error) handleError(error)
    }
  }

  // ==========================================================================
  // ANALYTICS
  // ==========================================================================

  stats = {
    /**
     * Get workspace stats
     */
    workspace: async (workspaceId: string) => {
      const { data, error } = await this.supabase
        .rpc('get_workspace_stats', { workspace_uuid: workspaceId })
        .single()
      
      if (error) handleError(error)
      return data
    },

    /**
     * Get user stats
     */
    user: async () => {
      const { data, error } = await this.supabase
        .rpc('get_user_stats')
        .single()
      
      if (error) handleError(error)
      return data
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { CaptureType, WorkspaceStatus, TeamRole, WorkspaceRole, SectionType, ActivityType }
export type { Database, Capture, Workspace, User, Team, WorkspaceCapture }
