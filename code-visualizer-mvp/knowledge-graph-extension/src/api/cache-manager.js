// src/api/cache-manager.js
// Data consistency and cache management for offline-first architecture
// Ensures chrome.storage.local stays in sync with Supabase

class CacheManager {
  constructor(supabaseClient) {
    this.supabaseClient = supabaseClient;
    this.lastCacheRefresh = null;
    this.cacheRefreshInterval = 15 * 60 * 1000; // 15 minutes
    this.maxCacheAge = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Initialize cache manager
   */
  async init() {
    try {
      // Load last cache refresh time
      const result = await chrome.storage.local.get(['lastCacheRefresh']);
      this.lastCacheRefresh = result.lastCacheRefresh || null;

      console.log('[CacheManager] Initialized');
      return true;
    } catch (error) {
      console.error('[CacheManager] Init error:', error);
      return false;
    }
  }

  /**
   * Refresh cache from Supabase
   * @param {boolean} force - Force refresh even if cache is fresh
   */
  async refreshCache(force = false) {
    try {
      if (!this.supabaseClient.isAuthenticated() || !navigator.onLine) {
        console.log('[CacheManager] Cannot refresh: offline or not authenticated');
        return { success: false, error: 'Offline or not authenticated' };
      }

      // Check if cache needs refresh
      const cacheAge = this.lastCacheRefresh 
        ? Date.now() - this.lastCacheRefresh 
        : Infinity;

      if (!force && cacheAge < this.cacheRefreshInterval) {
        console.log('[CacheManager] Cache is fresh, skipping refresh');
        return { success: true, cached: true };
      }

      console.log('[CacheManager] Refreshing cache...');

      // Fetch all data from Supabase
      const [capturesResponse, projectResponse, workspacesResponse] = await Promise.all([
        this.supabaseClient.getCaptures(),
        this.supabaseClient.getProject(),
        this.supabaseClient.getWorkspaces()
      ]);

      // Update local cache
      const updates = {};

      // Captures
      if (capturesResponse.success) {
        updates.capturesCache = {
          data: capturesResponse.captures,
          timestamp: Date.now()
        };
      }

      // Project
      if (projectResponse.success && projectResponse.project) {
        updates.projectCache = {
          data: projectResponse.project,
          timestamp: Date.now()
        };
      }

      // Workspaces
      if (workspacesResponse.success) {
        updates.workspacesCache = {
          data: workspacesResponse.workspaces,
          timestamp: Date.now()
        };
      }

      // Store cache and timestamp
      updates.lastCacheRefresh = Date.now();
      await chrome.storage.local.set(updates);

      this.lastCacheRefresh = Date.now();

      console.log('[CacheManager] Cache refreshed successfully');
      return { success: true, cached: false, updated: Object.keys(updates) };
    } catch (error) {
      console.error('[CacheManager] Refresh cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cached data with fallback to Supabase
   * @param {string} type - Type of data: 'captures', 'project', 'workspaces'
   */
  async getCached(type) {
    try {
      const cacheKey = `${type}Cache`;
      const result = await chrome.storage.local.get([cacheKey]);
      const cache = result[cacheKey];

      if (!cache) {
        // No cache, fetch from Supabase
        return await this._fetchFromSupabase(type);
      }

      const cacheAge = Date.now() - cache.timestamp;

      // If cache is too old, refresh in background and return cached data
      if (cacheAge > this.maxCacheAge) {
        console.log(`[CacheManager] Cache for ${type} is stale, refreshing in background`);
        this.refreshCache().catch(err => 
          console.error('[CacheManager] Background refresh error:', err)
        );
      }

      return { success: true, data: cache.data, cached: true, age: cacheAge };
    } catch (error) {
      console.error(`[CacheManager] Get cached ${type} error:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch data directly from Supabase
   */
  async _fetchFromSupabase(type) {
    if (!this.supabaseClient.isAuthenticated() || !navigator.onLine) {
      return { success: false, error: 'Offline or not authenticated' };
    }

    try {
      switch (type) {
        case 'captures':
          return await this.supabaseClient.getCaptures();
        case 'project':
          return await this.supabaseClient.getProject();
        case 'workspaces':
          return await this.supabaseClient.getWorkspaces();
        default:
          return { success: false, error: 'Unknown type' };
      }
    } catch (error) {
      console.error(`[CacheManager] Fetch ${type} error:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Invalidate cache for specific type or all
   * @param {string|null} type - Type to invalidate, or null for all
   */
  async invalidateCache(type = null) {
    try {
      if (type) {
        const cacheKey = `${type}Cache`;
        await chrome.storage.local.remove([cacheKey]);
        console.log(`[CacheManager] Invalidated cache for ${type}`);
      } else {
        await chrome.storage.local.remove([
          'capturesCache',
          'projectCache',
          'workspacesCache',
          'lastCacheRefresh'
        ]);
        this.lastCacheRefresh = null;
        console.log('[CacheManager] Invalidated all caches');
      }

      return { success: true };
    } catch (error) {
      console.error('[CacheManager] Invalidate cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ensure data consistency between local and server
   * Reconcile any differences
   */
  async ensureConsistency() {
    try {
      if (!this.supabaseClient.isAuthenticated() || !navigator.onLine) {
        console.log('[CacheManager] Cannot ensure consistency: offline or not authenticated');
        return { success: false, error: 'Offline or not authenticated' };
      }

      console.log('[CacheManager] Ensuring data consistency...');

      // Get local data
      const localData = await chrome.storage.local.get(['captures', 'project', 'syncQueue']);

      // Get server data
      const [capturesResponse, projectResponse] = await Promise.all([
        this.supabaseClient.getCaptures(),
        this.supabaseClient.getProject()
      ]);

      const inconsistencies = [];

      // Check captures consistency
      if (capturesResponse.success) {
        const localCaptures = localData.captures || [];
        const serverCaptures = capturesResponse.captures;

        // Find captures that exist locally but not on server (and are marked as synced)
        const orphanedSynced = localCaptures.filter(local => 
          local.syncStatus === 'synced' && 
          local.serverId && 
          !serverCaptures.some(server => server.id === local.serverId)
        );

        if (orphanedSynced.length > 0) {
          inconsistencies.push({
            type: 'orphaned_captures',
            count: orphanedSynced.length,
            items: orphanedSynced
          });
          
          // Mark as pending to re-sync
          orphanedSynced.forEach(capture => {
            capture.syncStatus = 'pending';
            capture.serverId = null;
          });
        }

        // Find captures on server not in local storage
        const missedCaptures = serverCaptures.filter(server =>
          !localCaptures.some(local => local.serverId === server.id)
        );

        if (missedCaptures.length > 0) {
          inconsistencies.push({
            type: 'missed_captures',
            count: missedCaptures.length,
            items: missedCaptures
          });

          // Add to local storage
          missedCaptures.forEach(capture => {
            localCaptures.push({
              ...capture,
              serverId: capture.id,
              localId: `remote-${capture.id}`,
              syncStatus: 'synced',
              syncedAt: Date.now()
            });
          });
        }

        // Update local storage
        await chrome.storage.local.set({ captures: localCaptures });
      }

      // Check project consistency
      if (projectResponse.success) {
        const localProject = localData.project;
        const serverProject = projectResponse.project;

        if (localProject && serverProject) {
          // Compare timestamps to detect divergence
          const localUpdated = localProject.updatedAt || localProject.createdAt || 0;
          const serverUpdated = serverProject.updated_at 
            ? new Date(serverProject.updated_at).getTime()
            : new Date(serverProject.created_at).getTime();

          if (Math.abs(localUpdated - serverUpdated) > 60000) { // More than 1 minute difference
            inconsistencies.push({
              type: 'project_diverged',
              local: localProject,
              server: serverProject,
              timeDiff: serverUpdated - localUpdated
            });

            // Use server version if it's newer
            if (serverUpdated > localUpdated) {
              await chrome.storage.local.set({ project: serverProject });
            }
          }
        } else if (!localProject && serverProject) {
          inconsistencies.push({
            type: 'missing_local_project',
            server: serverProject
          });
          await chrome.storage.local.set({ project: serverProject });
        } else if (localProject && !serverProject) {
          inconsistencies.push({
            type: 'missing_server_project',
            local: localProject
          });
          // Add to sync queue
          const syncQueue = localData.syncQueue || [];
          syncQueue.push({
            action: 'create',
            data: localProject,
            timestamp: Date.now()
          });
          await chrome.storage.local.set({ syncQueue });
        }
      }

      if (inconsistencies.length > 0) {
        console.warn('[CacheManager] Found inconsistencies:', inconsistencies);
      } else {
        console.log('[CacheManager] Data is consistent');
      }

      return { success: true, inconsistencies };
    } catch (error) {
      console.error('[CacheManager] Ensure consistency error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear cache on sign out
   */
  async clearOnSignOut() {
    try {
      await chrome.storage.local.remove([
        'capturesCache',
        'projectCache',
        'workspacesCache',
        'lastCacheRefresh'
      ]);

      this.lastCacheRefresh = null;
      
      console.log('[CacheManager] Cache cleared on sign out');
      return { success: true };
    } catch (error) {
      console.error('[CacheManager] Clear cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const result = await chrome.storage.local.get([
        'capturesCache',
        'projectCache',
        'workspacesCache',
        'lastCacheRefresh'
      ]);

      const stats = {
        lastRefresh: result.lastCacheRefresh,
        age: result.lastCacheRefresh ? Date.now() - result.lastCacheRefresh : null,
        captures: result.capturesCache ? {
          count: result.capturesCache.data?.length || 0,
          age: Date.now() - result.capturesCache.timestamp
        } : null,
        project: result.projectCache ? {
          exists: !!result.projectCache.data,
          age: Date.now() - result.projectCache.timestamp
        } : null,
        workspaces: result.workspacesCache ? {
          count: result.workspacesCache.data?.length || 0,
          age: Date.now() - result.workspacesCache.timestamp
        } : null
      };

      return { success: true, stats };
    } catch (error) {
      console.error('[CacheManager] Get cache stats error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default CacheManager;
