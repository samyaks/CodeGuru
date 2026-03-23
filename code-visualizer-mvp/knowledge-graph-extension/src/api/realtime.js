// src/api/realtime.js
// Real-time subscriptions for Supabase changes

class RealtimeManager {
  constructor(supabaseClient) {
    this.supabaseClient = supabaseClient;
    this.subscriptions = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
  }

  /**
   * Initialize realtime subscriptions
   * The Supabase client is already initialized, we just use it
   */
  async init() {
    try {
      if (!this.supabaseClient || !this.supabaseClient.client) {
        throw new Error('Supabase client not provided');
      }

      console.log('[Realtime] Ready to accept subscriptions');
      return true;
    } catch (error) {
      console.error('[Realtime] Init error:', error);
      return false;
    }
  }

  /**
   * Subscribe to capture changes
   */
  async subscribeToCaptureChanges(userId, onUpdate) {
    const channelName = `captures:${userId}`;
    
    // Unsubscribe existing if any
    this.unsubscribe(channelName);

    try {
      const channel = this.supabaseClient.client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'captures',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            console.log('[Realtime] New capture:', payload.new);
            this._handleCaptureInsert(payload.new, onUpdate);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'captures',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            console.log('[Realtime] Updated capture:', payload.new);
            this._handleCaptureUpdate(payload.new, onUpdate);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'DELETE',
            schema: 'public',
            table: 'captures',
            filter: `user_id=eq.${userId}`
          },
          (payload) => {
            console.log('[Realtime] Deleted capture:', payload.old);
            this._handleCaptureDelete(payload.old, onUpdate);
          }
        )
        .subscribe((status) => {
          console.log('[Realtime] Captures subscription status:', status);
          
          if (status === 'SUBSCRIBED') {
            this.reconnectAttempts = 0;
            chrome.notifications.create({
              type: 'basic',
              iconUrl: '/icons/icon128.png',
              title: 'UpdateAI Connected',
              message: 'Real-time sync is active',
              priority: 0
            });
          } else if (status === 'CHANNEL_ERROR') {
            this._handleReconnect(channelName, () => 
              this.subscribeToCaptureChanges(userId, onUpdate)
            );
          }
        });

      this.subscriptions.set(channelName, channel);
      console.log('[Realtime] Subscribed to captures');
      
      return { success: true, channelName };
    } catch (error) {
      console.error('[Realtime] Subscribe to captures error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Subscribe to workspace changes
   */
  async subscribeToWorkspaceChanges(workspaceId, onUpdate) {
    const channelName = `workspace:${workspaceId}`;
    
    // Unsubscribe existing if any
    this.unsubscribe(channelName);

    try {
      const channel = this.supabaseClient.client
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'workspaces',
            filter: `id=eq.${workspaceId}`
          },
          (payload) => {
            console.log('[Realtime] Workspace change:', payload);
            this._handleWorkspaceChange(payload, onUpdate);
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'workspace_captures',
            filter: `workspace_id=eq.${workspaceId}`
          },
          (payload) => {
            console.log('[Realtime] Workspace capture change:', payload);
            this._handleWorkspaceCaptureChange(payload, onUpdate);
          }
        )
        .subscribe((status) => {
          console.log('[Realtime] Workspace subscription status:', status);
          
          if (status === 'CHANNEL_ERROR') {
            this._handleReconnect(channelName, () => 
              this.subscribeToWorkspaceChanges(workspaceId, onUpdate)
            );
          }
        });

      this.subscriptions.set(channelName, channel);
      console.log('[Realtime] Subscribed to workspace');
      
      return { success: true, channelName };
    } catch (error) {
      console.error('[Realtime] Subscribe to workspace error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Subscribe to collaboration/presence in a workspace
   */
  async subscribeToCollaboration(workspaceId, userId, onUpdate) {
    const channelName = `presence:${workspaceId}`;
    
    // Unsubscribe existing if any
    this.unsubscribe(channelName);

    try {
      const channel = this.supabaseClient.client
        .channel(channelName)
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          console.log('[Realtime] Presence sync:', state);
          if (onUpdate) {
            onUpdate({
              type: 'presence_sync',
              collaborators: this._formatPresenceState(state)
            });
          }
        })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          console.log('[Realtime] User joined:', key, newPresences);
          if (onUpdate) {
            onUpdate({
              type: 'user_joined',
              users: newPresences
            });
          }
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          console.log('[Realtime] User left:', key, leftPresences);
          if (onUpdate) {
            onUpdate({
              type: 'user_left',
              users: leftPresences
            });
          }
        })
        .subscribe(async (status) => {
          console.log('[Realtime] Collaboration subscription status:', status);
          
          if (status === 'SUBSCRIBED') {
            // Track our presence
            await channel.track({
              user_id: userId,
              online_at: new Date().toISOString()
            });
          }
        });

      this.subscriptions.set(channelName, channel);
      console.log('[Realtime] Subscribed to collaboration');
      
      return { success: true, channelName };
    } catch (error) {
      console.error('[Realtime] Subscribe to collaboration error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle capture insert
   */
  async _handleCaptureInsert(capture, onUpdate) {
    try {
      // Check if this is from another device (not local)
      const result = await chrome.storage.local.get(['captures']);
      const captures = result.captures || [];
      
      const exists = captures.some(c => c.serverId === capture.id);
      
      if (!exists) {
        // New capture from another device - add to local storage
        captures.push({
          ...capture,
          serverId: capture.id,
          localId: `remote-${capture.id}`,
          syncStatus: 'synced',
          syncedAt: Date.now()
        });
        
        await chrome.storage.local.set({ captures });
        
        // Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icons/icon128.png',
          title: 'New Capture Synced',
          message: `${capture.source || 'New capture'} added from another device`,
          priority: 1
        });
        
        // Update badge
        chrome.action.setBadgeText({ text: captures.length.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        
        if (onUpdate) {
          onUpdate({ type: 'insert', capture });
        }
      }
    } catch (error) {
      console.error('[Realtime] Handle capture insert error:', error);
    }
  }

  /**
   * Handle capture update
   */
  async _handleCaptureUpdate(capture, onUpdate) {
    try {
      const result = await chrome.storage.local.get(['captures']);
      let captures = result.captures || [];
      
      const index = captures.findIndex(c => c.serverId === capture.id);
      
      if (index !== -1) {
        // Check if local version is newer
        const localVersion = captures[index];
        const localTime = new Date(localVersion.updatedAt || localVersion.createdAt).getTime();
        const serverTime = new Date(capture.updated_at || capture.created_at).getTime();
        
        if (serverTime >= localTime) {
          // Server version is newer or same - update local
          captures[index] = {
            ...capture,
            serverId: capture.id,
            localId: localVersion.localId,
            syncStatus: 'synced',
            syncedAt: Date.now()
          };
          
          await chrome.storage.local.set({ captures });
          
          if (onUpdate) {
            onUpdate({ type: 'update', capture });
          }
        } else {
          // Local version is newer - ignore server update
          console.log('[Realtime] Ignoring server update, local version is newer');
        }
      }
    } catch (error) {
      console.error('[Realtime] Handle capture update error:', error);
    }
  }

  /**
   * Handle capture delete
   */
  async _handleCaptureDelete(capture, onUpdate) {
    try {
      const result = await chrome.storage.local.get(['captures']);
      let captures = result.captures || [];
      
      const index = captures.findIndex(c => c.serverId === capture.id);
      
      if (index !== -1) {
        captures.splice(index, 1);
        await chrome.storage.local.set({ captures });
        
        if (onUpdate) {
          onUpdate({ type: 'delete', capture });
        }
      }
    } catch (error) {
      console.error('[Realtime] Handle capture delete error:', error);
    }
  }

  /**
   * Handle workspace change
   */
  async _handleWorkspaceChange(payload, onUpdate) {
    if (onUpdate) {
      onUpdate({
        type: 'workspace_change',
        event: payload.eventType,
        data: payload.new || payload.old
      });
    }
  }

  /**
   * Handle workspace capture link change
   */
  async _handleWorkspaceCaptureChange(payload, onUpdate) {
    if (onUpdate) {
      onUpdate({
        type: 'workspace_capture_change',
        event: payload.eventType,
        data: payload.new || payload.old
      });
    }
  }

  /**
   * Format presence state for UI
   */
  _formatPresenceState(state) {
    const collaborators = [];
    
    for (const [key, presences] of Object.entries(state)) {
      presences.forEach(presence => {
        collaborators.push({
          userId: presence.user_id,
          onlineAt: presence.online_at
        });
      });
    }
    
    return collaborators;
  }

  /**
   * Handle reconnection with exponential backoff
   */
  async _handleReconnect(channelName, reconnectFn) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Realtime] Max reconnect attempts reached');
      
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'UpdateAI Sync Issue',
        message: 'Unable to connect to real-time sync. Will retry when online.',
        priority: 1
      });
      
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    
    console.log(`[Realtime] Reconnecting ${channelName} in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (navigator.onLine) {
        reconnectFn();
      } else {
        // Wait for online event
        const onlineHandler = () => {
          window.removeEventListener('online', onlineHandler);
          reconnectFn();
        };
        window.addEventListener('online', onlineHandler);
      }
    }, delay);
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(channelName) {
    const channel = this.subscriptions.get(channelName);
    if (channel) {
      channel.unsubscribe();
      this.subscriptions.delete(channelName);
      console.log('[Realtime] Unsubscribed from', channelName);
    }
  }

  /**
   * Unsubscribe from all channels
   */
  unsubscribeAll() {
    for (const [channelName, channel] of this.subscriptions.entries()) {
      channel.unsubscribe();
      console.log('[Realtime] Unsubscribed from', channelName);
    }
    this.subscriptions.clear();
  }

  /**
   * Check connection status
   */
  isConnected() {
    return this.supabaseClient && this.supabaseClient.client && this.subscriptions.size > 0;
  }

  /**
   * Get active subscriptions count
   */
  getSubscriptionCount() {
    return this.subscriptions.size;
  }
}

export default RealtimeManager;
