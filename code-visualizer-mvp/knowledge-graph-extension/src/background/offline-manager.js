// src/background/offline-manager.js
// Offline/online detection and network status management
// Handles Chrome storage quota and network state transitions

class OfflineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.lastOnlineTime = Date.now();
    this.lastOfflineTime = null;
    this.onlineListeners = [];
    this.offlineListeners = [];
    this.quotaWarningThreshold = 0.8; // Warn at 80% quota usage
  }

  /**
   * Initialize offline manager
   */
  async init() {
    try {
      // Listen for online/offline events
      self.addEventListener('online', () => this._handleOnline());
      self.addEventListener('offline', () => this._handleOffline());

      // Check initial state
      await this._updateNetworkStatus();

      // Check storage quota
      await this._checkStorageQuota();

      // Set up periodic quota check (every 5 minutes)
      setInterval(() => this._checkStorageQuota(), 5 * 60 * 1000);

      console.log('[OfflineManager] Initialized. Network status:', this.isOnline ? 'online' : 'offline');
      return true;
    } catch (error) {
      console.error('[OfflineManager] Init error:', error);
      return false;
    }
  }

  /**
   * Handle online event
   */
  async _handleOnline() {
    console.log('[OfflineManager] Network came online');
    
    this.isOnline = true;
    this.lastOnlineTime = Date.now();
    
    // Calculate offline duration
    const offlineDuration = this.lastOfflineTime 
      ? Date.now() - this.lastOfflineTime 
      : 0;
    
    // Store network status
    await chrome.storage.local.set({
      networkStatus: 'online',
      lastOnlineTime: this.lastOnlineTime,
      lastOfflineDuration: offlineDuration
    });

    // Update badge
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });

    // Show notification if offline for more than 5 minutes
    if (offlineDuration > 5 * 60 * 1000) {
      const minutes = Math.floor(offlineDuration / 60000);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'UpdateAI Back Online',
        message: `Connection restored after ${minutes} minute${minutes > 1 ? 's' : ''}. Syncing changes...`,
        priority: 1
      });
    }

    // Notify listeners
    this.onlineListeners.forEach(listener => {
      try {
        listener({ isOnline: true, offlineDuration });
      } catch (error) {
        console.error('[OfflineManager] Listener error:', error);
      }
    });

    // Update network status
    await this._updateNetworkStatus();
  }

  /**
   * Handle offline event
   */
  async _handleOffline() {
    console.log('[OfflineManager] Network went offline');
    
    this.isOnline = false;
    this.lastOfflineTime = Date.now();
    
    // Store network status
    await chrome.storage.local.set({
      networkStatus: 'offline',
      lastOfflineTime: this.lastOfflineTime
    });

    // Update badge
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });

    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon128.png',
      title: 'UpdateAI Offline',
      message: 'You\'re offline. Changes will sync when back online.',
      priority: 0
    });

    // Notify listeners
    this.offlineListeners.forEach(listener => {
      try {
        listener({ isOnline: false });
      } catch (error) {
        console.error('[OfflineManager] Listener error:', error);
      }
    });

    // Update network status
    await this._updateNetworkStatus();
  }

  /**
   * Update network status with connection quality
   */
  async _updateNetworkStatus() {
    const status = {
      isOnline: navigator.onLine,
      timestamp: Date.now(),
      lastOnlineTime: this.lastOnlineTime,
      lastOfflineTime: this.lastOfflineTime
    };

    // Try to detect connection quality (if online)
    if (navigator.onLine) {
      status.connectionQuality = await this._detectConnectionQuality();
    }

    await chrome.storage.local.set({ detailedNetworkStatus: status });
    return status;
  }

  /**
   * Detect connection quality by testing a quick request
   */
  async _detectConnectionQuality() {
    try {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      // Test with a small Supabase request
      await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-cache'
      });

      clearTimeout(timeout);
      const latency = Date.now() - start;

      if (latency < 500) return 'good';
      if (latency < 2000) return 'fair';
      return 'poor';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Check chrome.storage quota and warn if running low
   */
  async _checkStorageQuota() {
    try {
      // Get storage info
      const bytesInUse = await chrome.storage.local.getBytesInUse();
      const maxBytes = chrome.storage.local.QUOTA_BYTES || 10485760; // 10MB default
      const usagePercent = bytesInUse / maxBytes;

      console.log(`[OfflineManager] Storage usage: ${bytesInUse} / ${maxBytes} bytes (${Math.round(usagePercent * 100)}%)`);

      // Store quota info
      await chrome.storage.local.set({
        storageQuota: {
          bytesInUse,
          maxBytes,
          usagePercent,
          lastCheck: Date.now()
        }
      });

      // Warn if approaching limit
      if (usagePercent >= this.quotaWarningThreshold) {
        console.warn('[OfflineManager] Storage quota warning:', usagePercent * 100, '%');
        
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icons/icon128.png',
          title: 'UpdateAI Storage Warning',
          message: `Storage is ${Math.round(usagePercent * 100)}% full. Consider syncing or clearing old data.`,
          priority: 2
        });

        // If over 95%, try to cleanup
        if (usagePercent >= 0.95) {
          await this._emergencyCleanup();
        }
      }

      return { bytesInUse, maxBytes, usagePercent };
    } catch (error) {
      console.error('[OfflineManager] Check storage quota error:', error);
      return null;
    }
  }

  /**
   * Emergency cleanup when storage is critically full
   */
  async _emergencyCleanup() {
    console.log('[OfflineManager] Starting emergency cleanup');
    
    try {
      const result = await chrome.storage.local.get([
        'syncFailures',
        'syncConflicts',
        'captures'
      ]);

      let itemsRemoved = 0;

      // Remove old sync failures (keep last 10)
      if (result.syncFailures && result.syncFailures.length > 10) {
        result.syncFailures = result.syncFailures.slice(-10);
        await chrome.storage.local.set({ syncFailures: result.syncFailures });
        itemsRemoved += result.syncFailures.length - 10;
      }

      // Remove resolved conflicts
      if (result.syncConflicts && result.syncConflicts.length > 0) {
        await chrome.storage.local.set({ syncConflicts: [] });
        itemsRemoved += result.syncConflicts.length;
      }

      // Remove synced captures older than 30 days (keep unsynced)
      if (result.captures) {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const filtered = result.captures.filter(c => 
          c.syncStatus !== 'synced' || 
          (c.syncedAt && c.syncedAt > thirtyDaysAgo)
        );
        
        if (filtered.length < result.captures.length) {
          await chrome.storage.local.set({ captures: filtered });
          itemsRemoved += result.captures.length - filtered.length;
        }
      }

      console.log(`[OfflineManager] Emergency cleanup removed ${itemsRemoved} items`);

      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Storage Cleanup Complete',
        message: `Removed ${itemsRemoved} old items to free up space.`,
        priority: 1
      });

      return itemsRemoved;
    } catch (error) {
      console.error('[OfflineManager] Emergency cleanup error:', error);
      return 0;
    }
  }

  /**
   * Get current network status
   */
  async getNetworkStatus() {
    await this._updateNetworkStatus();
    
    const result = await chrome.storage.local.get(['detailedNetworkStatus', 'storageQuota']);
    
    return {
      isOnline: this.isOnline,
      lastOnlineTime: this.lastOnlineTime,
      lastOfflineTime: this.lastOfflineTime,
      offlineDuration: this.lastOfflineTime ? Date.now() - this.lastOfflineTime : 0,
      detailed: result.detailedNetworkStatus,
      storageQuota: result.storageQuota
    };
  }

  /**
   * Register listener for online events
   */
  onOnline(callback) {
    this.onlineListeners.push(callback);
  }

  /**
   * Register listener for offline events
   */
  onOffline(callback) {
    this.offlineListeners.push(callback);
  }

  /**
   * Remove listener
   */
  removeListener(callback) {
    this.onlineListeners = this.onlineListeners.filter(l => l !== callback);
    this.offlineListeners = this.offlineListeners.filter(l => l !== callback);
  }

  /**
   * Force check network status (useful for testing)
   */
  async forceCheckNetworkStatus() {
    const wasOnline = this.isOnline;
    this.isOnline = navigator.onLine;

    if (wasOnline !== this.isOnline) {
      if (this.isOnline) {
        await this._handleOnline();
      } else {
        await this._handleOffline();
      }
    }

    return await this._updateNetworkStatus();
  }

  /**
   * Get storage statistics
   */
  async getStorageStats() {
    try {
      const result = await chrome.storage.local.get([
        'captures',
        'syncQueue',
        'syncFailures',
        'syncConflicts',
        'project'
      ]);

      const stats = {
        captures: result.captures?.length || 0,
        syncQueue: result.syncQueue?.length || 0,
        syncFailures: result.syncFailures?.length || 0,
        syncConflicts: result.syncConflicts?.length || 0,
        hasProject: !!result.project
      };

      // Add storage quota info
      const quota = await this._checkStorageQuota();
      if (quota) {
        stats.quota = quota;
      }

      return stats;
    } catch (error) {
      console.error('[OfflineManager] Get storage stats error:', error);
      return null;
    }
  }

  /**
   * Clear all local data (use with caution)
   */
  async clearAllData() {
    try {
      await chrome.storage.local.clear();
      console.log('[OfflineManager] All local data cleared');
      return { success: true };
    } catch (error) {
      console.error('[OfflineManager] Clear data error:', error);
      return { success: false, error: error.message };
    }
  }
}

export default OfflineManager;
