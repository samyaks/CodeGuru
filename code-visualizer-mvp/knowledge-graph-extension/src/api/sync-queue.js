// src/api/sync-queue.js
// Offline-first sync queue for captures and projects
// Works with Supabase client for real-time sync

class SyncQueue {
  constructor(supabaseClient) {
    this.supabaseClient = supabaseClient;
    this.isSyncing = false;
    this.syncInterval = null;
  }

  /**
   * Add capture to local storage and sync queue
   */
  async addCapture(capture) {
    try {
      // Add sync metadata
      const enrichedCapture = {
        ...capture,
        localId: capture.id,
        syncStatus: 'pending',
        createdAt: capture.timestamp,
        lastSyncAttempt: null,
        syncAttempts: 0
      };

      // Save to local storage
      const result = await chrome.storage.local.get(['captures', 'syncQueue']);
      const captures = result.captures || [];
      const syncQueue = result.syncQueue || [];

      captures.push(enrichedCapture);
      syncQueue.push({
        action: 'create',
        localId: capture.id,
        data: enrichedCapture,
        timestamp: Date.now()
      });

      await chrome.storage.local.set({ captures, syncQueue });

      // Try immediate sync if online
      if (navigator.onLine && this.supabaseClient.isAuthenticated()) {
        this.processSyncQueue();
      }

      return { success: true, capture: enrichedCapture };
    } catch (error) {
      console.error('[SyncQueue] Add capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update capture locally and add to sync queue
   */
  async updateCapture(captureId, updates) {
    try {
      const result = await chrome.storage.local.get(['captures', 'syncQueue']);
      const captures = result.captures || [];
      const syncQueue = result.syncQueue || [];

      const index = captures.findIndex(c => c.id === captureId || c.localId === captureId);
      if (index === -1) {
        return { success: false, error: 'Capture not found' };
      }

      // Update local capture
      captures[index] = {
        ...captures[index],
        ...updates,
        updatedAt: Date.now(),
        syncStatus: 'pending'
      };

      // Add to sync queue
      syncQueue.push({
        action: 'update',
        localId: captureId,
        serverId: captures[index].serverId,
        data: updates,
        timestamp: Date.now()
      });

      await chrome.storage.local.set({ captures, syncQueue });

      // Try immediate sync if online
      if (navigator.onLine && this.supabaseClient.isAuthenticated()) {
        this.processSyncQueue();
      }

      return { success: true, capture: captures[index] };
    } catch (error) {
      console.error('[SyncQueue] Update capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete capture locally and add to sync queue
   */
  async deleteCapture(captureId) {
    try {
      const result = await chrome.storage.local.get(['captures', 'syncQueue']);
      const captures = result.captures || [];
      const syncQueue = result.syncQueue || [];

      const index = captures.findIndex(c => c.id === captureId || c.localId === captureId);
      if (index === -1) {
        return { success: false, error: 'Capture not found' };
      }

      const capture = captures[index];
      captures.splice(index, 1);

      // Only add to sync queue if it was synced before
      if (capture.serverId) {
        syncQueue.push({
          action: 'delete',
          serverId: capture.serverId,
          timestamp: Date.now()
        });
      }

      await chrome.storage.local.set({ captures, syncQueue });

      // Try immediate sync if online
      if (navigator.onLine && this.supabaseClient.isAuthenticated()) {
        this.processSyncQueue();
      }

      return { success: true };
    } catch (error) {
      console.error('[SyncQueue] Delete capture error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Process sync queue - sync pending changes to backend
   * Now with exponential backoff and priority queue
   */
  async processSyncQueue() {
    if (this.isSyncing || !this.supabaseClient.isAuthenticated() || !navigator.onLine) {
      return;
    }

    this.isSyncing = true;

    try {
      const result = await chrome.storage.local.get(['syncQueue', 'captures']);
      let syncQueue = result.syncQueue || [];
      let captures = result.captures || [];

      if (syncQueue.length === 0) {
        this.isSyncing = false;
        return;
      }

      console.log(`[SyncQueue] Processing ${syncQueue.length} items`);

      // Sort by priority (captures before projects, then by timestamp)
      syncQueue.sort((a, b) => {
        const priorityA = this._getPriority(a);
        const priorityB = this._getPriority(b);
        if (priorityA !== priorityB) {
          return priorityB - priorityA; // Higher priority first
        }
        return a.timestamp - b.timestamp; // Older first
      });

      const processed = [];
      const failed = [];
      const conflicts = [];

      // Process queue items
      for (const item of syncQueue) {
        // Calculate exponential backoff delay
        const backoffDelay = this._calculateBackoffDelay(item.syncAttempts || 0);
        const timeSinceLastAttempt = Date.now() - (item.lastSyncAttempt || 0);
        
        // Skip if still in backoff period
        if (item.lastSyncAttempt && timeSinceLastAttempt < backoffDelay) {
          failed.push(item);
          continue;
        }

        try {
          item.lastSyncAttempt = Date.now();
          
          if (item.action === 'create') {
            const response = await this.supabaseClient.createCapture(item.data);
            
            if (response.success) {
              // Update local capture with server ID
              const captureIndex = captures.findIndex(c => c.localId === item.localId);
              if (captureIndex !== -1) {
                captures[captureIndex] = {
                  ...captures[captureIndex],
                  serverId: response.capture.id,
                  syncStatus: 'synced',
                  syncedAt: Date.now()
                };
              }
              processed.push(item);
            } else {
              item.syncAttempts = (item.syncAttempts || 0) + 1;
              item.lastError = response.error;
              failed.push(item);
            }
          } else if (item.action === 'update') {
            const serverId = item.serverId || this._getServerId(captures, item.localId);
            if (serverId) {
              const response = await this.supabaseClient.updateCapture(serverId, item.data);
              
              if (response.success) {
                const captureIndex = captures.findIndex(c => c.serverId === serverId);
                if (captureIndex !== -1) {
                  captures[captureIndex].syncStatus = 'synced';
                  captures[captureIndex].syncedAt = Date.now();
                }
                processed.push(item);
              } else if (response.error?.includes('conflict')) {
                // Handle conflict
                conflicts.push({
                  type: 'capture',
                  localId: item.localId,
                  serverId: serverId,
                  localData: item.data,
                  timestamp: Date.now()
                });
                processed.push(item); // Remove from queue
              } else {
                item.syncAttempts = (item.syncAttempts || 0) + 1;
                item.lastError = response.error;
                failed.push(item);
              }
            } else {
              processed.push(item); // Skip if no server ID
            }
          } else if (item.action === 'delete') {
            const response = await this.supabaseClient.deleteCapture(item.serverId);
            
            if (response.success || response.error?.includes('not found')) {
              // Remove from queue if deleted or already doesn't exist
              processed.push(item);
            } else {
              item.syncAttempts = (item.syncAttempts || 0) + 1;
              item.lastError = response.error;
              failed.push(item);
            }
          }
        } catch (error) {
          console.error('[SyncQueue] Item sync error:', error);
          item.syncAttempts = (item.syncAttempts || 0) + 1;
          item.lastError = error.message;
          failed.push(item);
        }
      }

      // Keep failed items in queue (up to max attempts)
      const MAX_ATTEMPTS = 10;
      const remainingQueue = failed.filter(item => item.syncAttempts < MAX_ATTEMPTS);
      
      // Log failed items that exceeded max attempts
      const abandoned = failed.filter(item => item.syncAttempts >= MAX_ATTEMPTS);
      if (abandoned.length > 0) {
        console.error(`[SyncQueue] Abandoned ${abandoned.length} items after max attempts:`, abandoned);
        await this._saveFailedItems(abandoned);
      }

      // Save conflicts for manual resolution
      if (conflicts.length > 0) {
        console.warn(`[SyncQueue] Detected ${conflicts.length} conflicts`, conflicts);
        await this._saveConflicts(conflicts);
      }

      // Update storage
      await chrome.storage.local.set({
        syncQueue: remainingQueue,
        captures,
        lastSyncAttempt: Date.now(),
        lastSyncSuccess: processed.length > 0 ? Date.now() : result.lastSyncSuccess
      });

      console.log(`[SyncQueue] Processed: ${processed.length}, Failed: ${failed.length}, Remaining: ${remainingQueue.length}, Conflicts: ${conflicts.length}`);

      // Update badge with pending count
      if (remainingQueue.length > 0) {
        chrome.action.setBadgeText({ text: remainingQueue.length.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      } else {
        chrome.action.setBadgeText({ text: '' });
      }

    } catch (error) {
      console.error('[SyncQueue] Process queue error:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Calculate exponential backoff delay in milliseconds
   */
  _calculateBackoffDelay(attempts) {
    // Base delay: 1 second
    // Max delay: 5 minutes
    const baseDelay = 1000;
    const maxDelay = 5 * 60 * 1000;
    const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }

  /**
   * Get priority for queue item (higher = more important)
   */
  _getPriority(item) {
    // Captures have higher priority than other operations
    if (item.action === 'create' && item.data?.type) {
      return 100;
    }
    if (item.action === 'update') {
      return 50;
    }
    if (item.action === 'delete') {
      return 10;
    }
    return 0;
  }

  /**
   * Save failed items for debugging
   */
  async _saveFailedItems(failedItems) {
    try {
      const result = await chrome.storage.local.get(['syncFailures']);
      const failures = result.syncFailures || [];
      
      failures.push({
        timestamp: Date.now(),
        items: failedItems,
        reason: 'max_attempts_exceeded'
      });
      
      // Keep only last 100 failures
      if (failures.length > 100) {
        failures.splice(0, failures.length - 100);
      }
      
      await chrome.storage.local.set({ syncFailures: failures });
    } catch (error) {
      console.error('[SyncQueue] Failed to save failed items:', error);
    }
  }

  /**
   * Save conflicts for manual resolution
   */
  async _saveConflicts(conflicts) {
    try {
      const result = await chrome.storage.local.get(['syncConflicts']);
      const existingConflicts = result.syncConflicts || [];
      
      existingConflicts.push(...conflicts);
      
      // Keep only last 50 conflicts
      if (existingConflicts.length > 50) {
        existingConflicts.splice(0, existingConflicts.length - 50);
      }
      
      await chrome.storage.local.set({ syncConflicts: existingConflicts });
      
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Sync Conflict Detected',
        message: `${conflicts.length} item${conflicts.length > 1 ? 's' : ''} have conflicting changes. Please resolve manually.`,
        priority: 2
      });
    } catch (error) {
      console.error('[SyncQueue] Failed to save conflicts:', error);
    }
  }

  /**
   * Pull captures from Supabase and merge with local
   */
  async pullFromBackend() {
    if (!this.supabaseClient.isAuthenticated() || !navigator.onLine) {
      return { success: false, error: 'Not authenticated or offline' };
    }

    try {
      const response = await this.supabaseClient.getCaptures();
      
      if (!response.success) {
        return response;
      }

      const serverCaptures = response.captures;
      const result = await chrome.storage.local.get(['captures']);
      let localCaptures = result.captures || [];

      // Merge strategy: server wins for conflicts, keep local-only items
      const merged = this._mergeCaptures(localCaptures, serverCaptures);

      await chrome.storage.local.set({
        captures: merged,
        lastPullTime: Date.now()
      });

      console.log(`[SyncQueue] Pulled ${serverCaptures.length} captures, merged to ${merged.length}`);

      return {
        success: true,
        merged: merged.length,
        pulled: serverCaptures.length
      };
    } catch (error) {
      console.error('[SyncQueue] Pull error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Merge local and server captures with conflict resolution
   * Enhanced with last-write-wins strategy and conflict detection
   */
  _mergeCaptures(localCaptures, serverCaptures) {
    const merged = new Map();
    const conflicts = [];

    // Add server captures (server is source of truth for synced items)
    serverCaptures.forEach(serverCapture => {
      merged.set(serverCapture.id, {
        ...serverCapture,
        serverId: serverCapture.id,
        syncStatus: 'synced',
        syncedAt: Date.now()
      });
    });

    // Add local-only captures (not synced yet)
    localCaptures.forEach(localCapture => {
      if (localCapture.serverId) {
        // Already synced - check if we have server version
        if (!merged.has(localCapture.serverId)) {
          // Server deleted it, keep local if modified recently
          if (localCapture.syncStatus === 'pending') {
            merged.set(localCapture.serverId, localCapture);
          } else {
            // Server deleted and no local changes - respect deletion
            console.log(`[SyncQueue] Item ${localCapture.serverId} deleted on server`);
          }
        } else {
          // Server has it - use timestamp for conflict resolution (last-write-wins)
          const serverVersion = merged.get(localCapture.serverId);
          const localUpdated = localCapture.updatedAt || localCapture.createdAt;
          const serverUpdated = serverVersion.updated_at || serverVersion.created_at;
          
          if (localUpdated && serverUpdated) {
            const localTime = new Date(localUpdated).getTime();
            const serverTime = new Date(serverUpdated).getTime();
            
            if (localTime > serverTime) {
              // Local is newer - use local version but mark for sync
              console.log(`[SyncQueue] Local version newer for ${localCapture.serverId}`);
              merged.set(localCapture.serverId, {
                ...localCapture,
                syncStatus: 'pending'
              });
              
              // If difference is small (< 5 seconds), it might be a race condition
              if (Math.abs(localTime - serverTime) < 5000) {
                conflicts.push({
                  type: 'capture',
                  id: localCapture.serverId,
                  localVersion: localCapture,
                  serverVersion: serverVersion,
                  resolution: 'last_write_wins_local',
                  timeDiff: localTime - serverTime
                });
              }
            } else if (serverTime > localTime) {
              // Server is newer - use server version
              console.log(`[SyncQueue] Server version newer for ${localCapture.serverId}`);
              // Already in merged, no action needed
              
              // Check for conflicts
              if (localCapture.syncStatus === 'pending') {
                conflicts.push({
                  type: 'capture',
                  id: localCapture.serverId,
                  localVersion: localCapture,
                  serverVersion: serverVersion,
                  resolution: 'last_write_wins_server',
                  timeDiff: serverTime - localTime
                });
              }
            } else {
              // Same timestamp - use server version
              console.log(`[SyncQueue] Same timestamp for ${localCapture.serverId}, using server version`);
            }
          } else if (localCapture.syncStatus === 'pending') {
            // Local has pending changes, use local version
            merged.set(localCapture.serverId, {
              ...localCapture,
              syncStatus: 'pending'
            });
          }
        }
      } else {
        // Local-only, not synced yet
        const key = localCapture.localId || localCapture.id;
        merged.set(key, localCapture);
      }
    });

    // Save conflicts if any were detected
    if (conflicts.length > 0) {
      console.warn(`[SyncQueue] Detected ${conflicts.length} conflicts during merge`, conflicts);
      this._saveConflicts(conflicts).catch(err => 
        console.error('[SyncQueue] Failed to save conflicts:', err)
      );
    }

    return Array.from(merged.values());
  }

  /**
   * Get server ID for a local ID
   */
  _getServerId(captures, localId) {
    const capture = captures.find(c => c.localId === localId);
    return capture?.serverId;
  }

  /**
   * Get sync status with detailed information
   */
  async getSyncStatus() {
    const result = await chrome.storage.local.get([
      'syncQueue', 
      'captures', 
      'lastSyncAttempt',
      'lastSyncSuccess',
      'syncConflicts',
      'syncFailures'
    ]);
    
    const syncQueue = result.syncQueue || [];
    const captures = result.captures || [];
    const conflicts = result.syncConflicts || [];
    const failures = result.syncFailures || [];

    const synced = captures.filter(c => c.syncStatus === 'synced').length;
    const pending = captures.filter(c => c.syncStatus === 'pending').length;
    const localOnly = captures.filter(c => !c.serverId).length;
    
    // Calculate next retry time for failed items
    let nextRetryTime = null;
    if (syncQueue.length > 0) {
      const itemsWithRetry = syncQueue
        .filter(item => item.lastSyncAttempt && item.syncAttempts)
        .map(item => {
          const backoffDelay = this._calculateBackoffDelay(item.syncAttempts);
          return item.lastSyncAttempt + backoffDelay;
        });
      
      if (itemsWithRetry.length > 0) {
        nextRetryTime = Math.min(...itemsWithRetry);
      }
    }

    return {
      total: captures.length,
      synced,
      pending,
      localOnly,
      queueSize: syncQueue.length,
      conflicts: conflicts.length,
      failures: failures.length,
      lastSyncAttempt: result.lastSyncAttempt,
      lastSyncSuccess: result.lastSyncSuccess,
      nextRetryTime,
      isOnline: navigator.onLine,
      isAuthenticated: this.supabaseClient.isAuthenticated(),
      isSyncing: this.isSyncing,
      status: this._getOverallStatus(syncQueue.length, conflicts.length, navigator.onLine, this.supabaseClient.isAuthenticated())
    };
  }

  /**
   * Get overall sync status string
   */
  _getOverallStatus(queueSize, conflictCount, isOnline, isAuthenticated) {
    if (!isAuthenticated) {
      return 'not_authenticated';
    }
    if (!isOnline) {
      return 'offline';
    }
    if (conflictCount > 0) {
      return 'has_conflicts';
    }
    if (queueSize > 0) {
      return 'syncing';
    }
    return 'synced';
  }

  /**
   * Get conflicts for manual resolution
   */
  async getConflicts() {
    const result = await chrome.storage.local.get(['syncConflicts']);
    return result.syncConflicts || [];
  }

  /**
   * Resolve conflict by choosing local or server version
   */
  async resolveConflict(conflictId, resolution) {
    try {
      const result = await chrome.storage.local.get(['syncConflicts', 'captures', 'syncQueue']);
      let conflicts = result.syncConflicts || [];
      let captures = result.captures || [];
      let syncQueue = result.syncQueue || [];

      const conflictIndex = conflicts.findIndex((c, i) => i === conflictId);
      if (conflictIndex === -1) {
        return { success: false, error: 'Conflict not found' };
      }

      const conflict = conflicts[conflictIndex];

      if (resolution === 'use_local') {
        // Keep local version and add to sync queue
        const captureIndex = captures.findIndex(c => c.serverId === conflict.id);
        if (captureIndex !== -1) {
          captures[captureIndex].syncStatus = 'pending';
          
          // Add to sync queue
          syncQueue.push({
            action: 'update',
            serverId: conflict.id,
            localId: captures[captureIndex].localId,
            data: conflict.localVersion,
            timestamp: Date.now(),
            syncAttempts: 0
          });
        }
      } else if (resolution === 'use_server') {
        // Use server version
        const captureIndex = captures.findIndex(c => c.serverId === conflict.id);
        if (captureIndex !== -1) {
          captures[captureIndex] = {
            ...conflict.serverVersion,
            serverId: conflict.id,
            syncStatus: 'synced',
            syncedAt: Date.now()
          };
        }
      }

      // Remove conflict
      conflicts.splice(conflictIndex, 1);

      await chrome.storage.local.set({ syncConflicts: conflicts, captures, syncQueue });

      return { success: true };
    } catch (error) {
      console.error('[SyncQueue] Resolve conflict error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clear all resolved conflicts
   */
  async clearConflicts() {
    await chrome.storage.local.set({ syncConflicts: [] });
  }

  /**
   * Force sync now (ignore backoff delays)
   */
  async forceSyncNow() {
    // Clear backoff timestamps
    const result = await chrome.storage.local.get(['syncQueue']);
    const syncQueue = result.syncQueue || [];
    
    syncQueue.forEach(item => {
      item.lastSyncAttempt = null;
    });
    
    await chrome.storage.local.set({ syncQueue });
    
    // Process queue immediately
    return this.processSyncQueue();
  }

  /**
   * Start periodic sync (called by service worker)
   */
  startPeriodicSync() {
    // Clear existing interval
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    // Sync every 5 minutes
    this.syncInterval = setInterval(() => {
      if (navigator.onLine && this.supabaseClient.isAuthenticated()) {
        this.processSyncQueue();
        this.pullFromBackend();
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export default SyncQueue;
