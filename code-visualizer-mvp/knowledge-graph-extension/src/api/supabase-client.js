// src/api/supabase-client.js
// Supabase Client Wrapper for Chrome Extension
// Handles authentication, data operations, and offline sync

import { createClient } from '@supabase/supabase-js';
import API_CONFIG from './config.js';

/**
 * Supabase client singleton for the extension
 * Manages authentication state and provides API methods
 */
class SupabaseClient {
  constructor() {
    this.client = null;
    this.session = null;
    this.user = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Supabase client with stored credentials
   * @returns {Promise<boolean>} True if authenticated, false otherwise
   */
  async init() {
    try {
      // Get Supabase credentials from config
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = API_CONFIG;
      
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.error('[Supabase] Missing credentials in config');
        return false;
      }

      // Create Supabase client
      this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          storage: {
            getItem: async (key) => {
              const result = await chrome.storage.local.get([key]);
              return result[key] || null;
            },
            setItem: async (key, value) => {
              await chrome.storage.local.set({ [key]: value });
            },
            removeItem: async (key) => {
              await chrome.storage.local.remove([key]);
            }
          },
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false // Important for extension
        }
      });

      // Load existing session from storage
      const result = await chrome.storage.local.get(['supabase.auth.token']);
      if (result['supabase.auth.token']) {
        const { data, error } = await this.client.auth.getSession();
        if (data.session) {
          this.session = data.session;
          this.user = data.session.user;
          console.log('[Supabase] Session restored for:', this.user.email);
        }
      }

      // Listen for auth state changes
      this.client.auth.onAuthStateChange((event, session) => {
        console.log('[Supabase] Auth state changed:', event);
        this.session = session;
        this.user = session?.user || null;
        
        // Notify service worker about auth change
        if (typeof chrome !== 'undefined' && chrome.runtime) {
          chrome.runtime.sendMessage({
            type: 'AUTH_STATE_CHANGED',
            event,
            user: this.user
          }).catch(() => {
            // Ignore if service worker isn't ready
          });
        }

        // Store user info for quick access
        if (this.user) {
          chrome.storage.local.set({
            user: {
              id: this.user.id,
              email: this.user.email,
              name: this.user.user_metadata?.display_name || this.user.email
            }
          });
        } else {
          chrome.storage.local.remove(['user']);
        }
      });

      this.isInitialized = true;
      return !!this.session;

    } catch (error) {
      console.error('[Supabase] Init error:', error);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.session && !!this.user;
  }

  /**
   * Get current user
   */
  getUser() {
    return this.user;
  }

  /**
   * Get current session
   */
  getSession() {
    return this.session;
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  /**
   * Request magic link via email
   * @param {string} email - User's email address
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async requestMagicLink(email) {
    try {
      const { error } = await this.client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: chrome.runtime.getURL('popup.html')
        }
      });

      if (error) {
        console.error('[Supabase] Magic link error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[Supabase] Magic link request failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify OTP token from magic link
   * @param {string} email - User's email
   * @param {string} token - OTP token from email
   * @returns {Promise<{success: boolean, user?: object, error?: string}>}
   */
  async verifyOTP(email, token) {
    try {
      const { data, error } = await this.client.auth.verifyOtp({
        email,
        token,
        type: 'magiclink'
      });

      if (error) {
        console.error('[Supabase] OTP verification error:', error);
        return { success: false, error: error.message };
      }

      this.session = data.session;
      this.user = data.user;

      return { success: true, user: this.user };
    } catch (error) {
      console.error('[Supabase] OTP verification failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Sign out
   * @returns {Promise<{success: boolean}>}
   */
  async signOut() {
    try {
      const { error } = await this.client.auth.signOut();
      
      if (error) {
        console.error('[Supabase] Sign out error:', error);
      }

      this.session = null;
      this.user = null;

      // Clear all auth-related storage
      await chrome.storage.local.remove([
        'supabase.auth.token',
        'user',
        'authToken',
        'refreshToken'
      ]);

      return { success: true };
    } catch (error) {
      console.error('[Supabase] Sign out failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh session
   * @returns {Promise<{success: boolean}>}
   */
  async refreshSession() {
    try {
      const { data, error } = await this.client.auth.refreshSession();
      
      if (error) {
        console.error('[Supabase] Refresh session error:', error);
        return { success: false, error: error.message };
      }

      this.session = data.session;
      this.user = data.user;

      return { success: true };
    } catch (error) {
      console.error('[Supabase] Refresh session failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // CAPTURES
  // ============================================================================

  /**
   * Create a new capture
   * @param {object} capture - Capture data
   * @returns {Promise<{success: boolean, capture?: object, error?: string}>}
   */
  async createCapture(capture) {
    try {
      const { data, error } = await this.client
        .from('captures')
        .insert({
          user_id: this.user.id,
          type: capture.type,
          source: capture.source,
          title: capture.title,
          content: capture.content,
          url: capture.url,
          metadata: capture.metadata || {},
          tags: capture.tags || [],
          captured_at: capture.timestamp || new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Create capture error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, capture: data };
    } catch (error) {
      console.error('[Supabase] Create capture failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all captures for current user
   * @param {object} filters - Optional filters (type, limit, offset)
   * @returns {Promise<{success: boolean, captures?: array, error?: string}>}
   */
  async getCaptures(filters = {}) {
    try {
      let query = this.client
        .from('captures')
        .select('*')
        .eq('user_id', this.user.id)
        .order('captured_at', { ascending: false });

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.range(
          filters.offset,
          filters.offset + (filters.limit || 50) - 1
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Supabase] Get captures error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, captures: data };
    } catch (error) {
      console.error('[Supabase] Get captures failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update a capture
   * @param {string} captureId - Capture ID
   * @param {object} updates - Updates to apply
   * @returns {Promise<{success: boolean, capture?: object, error?: string}>}
   */
  async updateCapture(captureId, updates) {
    try {
      const { data, error } = await this.client
        .from('captures')
        .update(updates)
        .eq('id', captureId)
        .eq('user_id', this.user.id)
        .select()
        .single();

      if (error) {
        console.error('[Supabase] Update capture error:', error);
        return { success: false, error: error.message };
      }

      return { success: true, capture: data };
    } catch (error) {
      console.error('[Supabase] Update capture failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete a capture
   * @param {string} captureId - Capture ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteCapture(captureId) {
    try {
      const { error } = await this.client
        .from('captures')
        .delete()
        .eq('id', captureId)
        .eq('user_id', this.user.id);

      if (error) {
        console.error('[Supabase] Delete capture error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[Supabase] Delete capture failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // PROJECTS (stored as captures with special metadata)
  // ============================================================================

  /**
   * Get project for current user
   * @returns {Promise<{success: boolean, project?: object, error?: string}>}
   */
  async getProject() {
    try {
      // Projects are stored as a special capture type
      const { data, error } = await this.client
        .from('captures')
        .select('*')
        .eq('user_id', this.user.id)
        .eq('type', 'project')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Supabase] Get project error:', error);
        return { success: false, error: error.message };
      }

      // Convert from capture format to project format
      if (data) {
        return {
          success: true,
          project: {
            name: data.title,
            links: data.metadata?.links || [],
            createdAt: new Date(data.created_at).getTime(),
            id: data.id
          }
        };
      }

      return { success: true, project: null };
    } catch (error) {
      console.error('[Supabase] Get project failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Save project
   * @param {object} project - Project data
   * @returns {Promise<{success: boolean, project?: object, error?: string}>}
   */
  async saveProject(project) {
    try {
      const projectData = {
        user_id: this.user.id,
        type: 'project',
        source: 'extension',
        title: project.name,
        content: `Project with ${project.links?.length || 0} links`,
        metadata: {
          links: project.links || [],
          createdAt: project.createdAt
        },
        captured_at: new Date().toISOString()
      };

      if (project.id) {
        // Update existing project
        const { data, error } = await this.client
          .from('captures')
          .update(projectData)
          .eq('id', project.id)
          .eq('user_id', this.user.id)
          .select()
          .single();

        if (error) {
          console.error('[Supabase] Update project error:', error);
          return { success: false, error: error.message };
        }

        return { success: true, project: { ...project, id: data.id } };
      } else {
        // Create new project
        const { data, error } = await this.client
          .from('captures')
          .insert(projectData)
          .select()
          .single();

        if (error) {
          console.error('[Supabase] Create project error:', error);
          return { success: false, error: error.message };
        }

        return { success: true, project: { ...project, id: data.id } };
      }
    } catch (error) {
      console.error('[Supabase] Save project failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete project
   * @param {string} projectId - Project ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deleteProject(projectId) {
    return this.deleteCapture(projectId);
  }

  // ============================================================================
  // WORKSPACES
  // ============================================================================

  /**
   * Get all workspaces for current user
   * @returns {Promise<{success: boolean, workspaces?: array, error?: string}>}
   */
  async getWorkspaces() {
    try {
      // Get workspaces where user is a member
      const { data, error } = await this.client
        .from('workspace_members')
        .select(`
          workspace:workspaces (
            id,
            name,
            description,
            status,
            template,
            created_at,
            updated_at,
            last_activity_at
          )
        `)
        .eq('user_id', this.user.id);

      if (error) {
        console.error('[Supabase] Get workspaces error:', error);
        return { success: false, error: error.message };
      }

      const workspaces = data.map(item => item.workspace).filter(Boolean);
      return { success: true, workspaces };
    } catch (error) {
      console.error('[Supabase] Get workspaces failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a new workspace
   * @param {object} workspaceData - Workspace data
   * @returns {Promise<{success: boolean, workspace?: object, error?: string}>}
   */
  async createWorkspace(workspaceData) {
    try {
      // Use RPC function to create workspace and add user as owner
      const { data, error } = await this.client
        .rpc('create_workspace', {
          workspace_name: workspaceData.name,
          workspace_description: workspaceData.description || null,
          workspace_team_id: workspaceData.teamId || null
        });

      if (error) {
        console.error('[Supabase] Create workspace error:', error);
        return { success: false, error: error.message };
      }

      // Fetch the created workspace
      const { data: workspace, error: fetchError } = await this.client
        .from('workspaces')
        .select('*')
        .eq('id', data)
        .single();

      if (fetchError) {
        console.error('[Supabase] Fetch workspace error:', fetchError);
        return { success: false, error: fetchError.message };
      }

      return { success: true, workspace };
    } catch (error) {
      console.error('[Supabase] Create workspace failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add capture to workspace
   * @param {string} workspaceId - Workspace ID
   * @param {string} captureId - Capture ID
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async addCaptureToWorkspace(workspaceId, captureId) {
    try {
      const { data, error } = await this.client
        .rpc('add_capture_to_workspace', {
          workspace_uuid: workspaceId,
          capture_uuid: captureId
        });

      if (error) {
        console.error('[Supabase] Add capture to workspace error:', error);
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error) {
      console.error('[Supabase] Add capture to workspace failed:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Check if client is initialized
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      throw new Error('Supabase client not initialized. Call init() first.');
    }
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated.');
    }
  }

  /**
   * Execute query with error handling
   * @private
   */
  async _executeQuery(queryFn) {
    try {
      this.ensureInitialized();
      return await queryFn();
    } catch (error) {
      console.error('[Supabase] Query error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
const supabaseClient = new SupabaseClient();
export default supabaseClient;
