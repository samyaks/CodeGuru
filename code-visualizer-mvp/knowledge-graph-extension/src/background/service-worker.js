// src/background/service-worker.js
// Background service worker for UpdateAI extension

import supabaseClient from '../api/supabase-client.js';
import SyncQueue from '../api/sync-queue.js';
import RealtimeManager from '../api/realtime.js';
import OfflineManager from './offline-manager.js';
import CacheManager from '../api/cache-manager.js';

// Initialize
let syncQueue;
let realtimeManager;
let offlineManager;
let cacheManager;
let currentPageInfo = null;

// Service worker lifecycle
self.addEventListener('install', (event) => {
  console.log('[UpdateAI] Service worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[UpdateAI] Service worker activated');
  event.waitUntil(initialize());
});

/**
 * Initialize extension on startup
 */
async function initialize() {
  try {
    // Initialize offline manager first
    offlineManager = new OfflineManager();
    await offlineManager.init();
    
    // Initialize Supabase client
    const isAuthenticated = await supabaseClient.init();
    
    // Initialize sync queue with Supabase client
    syncQueue = new SyncQueue(supabaseClient);
    
    // Initialize cache manager
    cacheManager = new CacheManager(supabaseClient);
    await cacheManager.init();
    
    // Initialize realtime manager
    realtimeManager = new RealtimeManager(supabaseClient);
    await realtimeManager.init();
    
    if (isAuthenticated) {
      console.log('[UpdateAI] User authenticated:', supabaseClient.getUser()?.email);
      
      // Pull data from backend and start sync
      await syncQueue.pullFromBackend();
      syncQueue.startPeriodicSync();
      
      // Refresh cache
      await cacheManager.refreshCache();
      
      // Ensure data consistency
      await cacheManager.ensureConsistency();
      
      // Set up real-time subscriptions
      await setupRealtimeSubscriptions();
      
      // Set up alarm for background sync
      setupBackgroundSync();
    } else {
      console.log('[UpdateAI] User not authenticated');
    }
    
    // Set up notification listeners
    setupNotificationListeners();
    
    // Set up offline/online handlers
    setupNetworkHandlers();
    
  } catch (error) {
    console.error('[UpdateAI] Initialization error:', error);
  }
}

/**
 * Setup chrome alarms for background sync
 */
function setupBackgroundSync() {
  // Clear existing alarms
  chrome.alarms.clear('syncQueue');
  chrome.alarms.clear('pullUpdates');
  
  // Sync queue every 5 minutes
  chrome.alarms.create('syncQueue', {
    periodInMinutes: 5
  });
  
  // Pull updates every 10 minutes
  chrome.alarms.create('pullUpdates', {
    periodInMinutes: 10
  });
  
  // Try to register background sync if available
  try {
    if (self.registration && self.registration.sync) {
      self.registration.sync.register('sync-captures').then(() => {
        console.log('[UpdateAI] Background sync registered');
      }).catch(error => {
        console.warn('[UpdateAI] Background sync not available:', error);
      });
    }
  } catch (error) {
    console.warn('[UpdateAI] Background Sync API not available');
  }
}

/**
 * Setup real-time subscriptions for authenticated user
 */
async function setupRealtimeSubscriptions() {
  try {
    const user = supabaseClient.getUser();
    if (!user) return;

    // Subscribe to capture changes
    await realtimeManager.subscribeToCaptureChanges(user.id, async (payload) => {
      console.log('[UpdateAI] Realtime capture update:', payload);
      
      // Update local state
      if (payload.type === 'insert') {
        // Badge update for new capture from another device
        const result = await chrome.storage.local.get(['captures']);
        const captures = result.captures || [];
        chrome.action.setBadgeText({ text: captures.length.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      }
    });

    console.log('[UpdateAI] Real-time subscriptions active');
  } catch (error) {
    console.error('[UpdateAI] Setup realtime error:', error);
  }
}

/**
 * Setup network status change handlers
 */
function setupNetworkHandlers() {
  if (!offlineManager) return;

  // Handle online event
  offlineManager.onOnline(async ({ offlineDuration }) => {
    console.log('[UpdateAI] Back online after', offlineDuration, 'ms');
    
    if (supabaseClient.isAuthenticated() && syncQueue) {
      // Process sync queue immediately
      await syncQueue.processSyncQueue();
      await syncQueue.pullFromBackend();
      
      // Re-subscribe to realtime
      await setupRealtimeSubscriptions();
    }
  });

  // Handle offline event
  offlineManager.onOffline(async () => {
    console.log('[UpdateAI] Gone offline');
    
    // Unsubscribe from realtime to save resources
    if (realtimeManager) {
      realtimeManager.unsubscribeAll();
    }
  });
}

/**
 * Setup listeners for workspace notifications
 */
function setupNotificationListeners() {
  // Poll for workspace activity every 15 minutes if authenticated
  chrome.alarms.create('checkActivity', {
    periodInMinutes: 15
  });
}

/**
 * Handle alarm triggers
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  console.log('[UpdateAI] Alarm triggered:', alarm.name);
  
  if (!supabaseClient.isAuthenticated() || !navigator.onLine) {
    return;
  }
  
  switch (alarm.name) {
    case 'syncQueue':
      await syncQueue.processSyncQueue();
      break;
      
    case 'pullUpdates':
      await syncQueue.pullFromBackend();
      break;
      
    case 'checkActivity':
      await checkWorkspaceActivity();
      break;
  }
});

/**
 * Check for new workspace activity
 */
async function checkWorkspaceActivity() {
  try {
    // Get user's workspaces from Supabase
    const response = await supabaseClient.getWorkspaces();
    
    if (!response.success) {
      console.error('[UpdateAI] Failed to get workspaces:', response.error);
      return;
    }
    
    const workspaces = response.workspaces || [];
    const result = await chrome.storage.local.get(['lastActivityCheck']);
    const lastCheck = result.lastActivityCheck || Date.now() - 3600000; // 1 hour ago
    
    let totalNewItems = 0;
    
    // Check for updates in each workspace
    for (const workspace of workspaces) {
      // Check if workspace was updated since last check
      const workspaceUpdated = new Date(workspace.last_activity_at).getTime();
      
      if (workspaceUpdated > lastCheck) {
        totalNewItems++;
        
        // Show notification for new activity
        chrome.notifications.create({
          type: 'basic',
          iconUrl: '/icons/icon128.png',
          title: `New activity in ${workspace.name}`,
          message: `Workspace was updated`,
          priority: 1
        });
      }
    }
    
    // Update badge
    if (totalNewItems > 0) {
      chrome.action.setBadgeText({ text: totalNewItems.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    }
    
    await chrome.storage.local.set({ lastActivityCheck: Date.now() });
    
  } catch (error) {
    console.error('[UpdateAI] Check activity error:', error);
  }
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[UpdateAI] Message received:', message.type);
  
  // Handle async responses
  (async () => {
    try {
      switch (message.type) {
        case 'PAGE_DETECTED':
          await handlePageDetected(message.pageInfo);
          sendResponse({ success: true });
          break;
          
        case 'GET_CURRENT_PAGE':
          sendResponse({ success: true, pageInfo: currentPageInfo });
          break;
          
        case 'ADD_CAPTURE':
          const result = await handleAddCapture(message.capture);
          sendResponse(result);
          break;
          
        case 'CLEAR_BADGE':
          chrome.action.setBadgeText({ text: '' });
          sendResponse({ success: true });
          break;
          
        case 'REQUEST_MAGIC_LINK':
          const linkResult = await supabaseClient.requestMagicLink(message.email);
          sendResponse(linkResult);
          break;
          
        case 'VERIFY_MAGIC_LINK':
          const verifyResult = await supabaseClient.verifyOTP(message.email, message.token);
          if (verifyResult.success) {
            // Initialize sync after successful auth
            await initializeAfterAuth();
          }
          sendResponse(verifyResult);
          break;
          
        case 'LOGOUT':
          await handleLogout();
          sendResponse({ success: true });
          break;
          
        case 'AUTH_STATE_CHANGED':
          // Handle auth state changes from Supabase client
          await handleAuthStateChange(message.event, message.user);
          sendResponse({ success: true });
          break;
          
        case 'SYNC_NOW':
          await syncQueue.processSyncQueue();
          await syncQueue.pullFromBackend();
          sendResponse({ success: true });
          break;
          
        case 'GET_SYNC_STATUS':
          const status = await syncQueue.getSyncStatus();
          sendResponse({ success: true, status });
          break;
          
        case 'GET_NETWORK_STATUS':
          const netStatus = offlineManager 
            ? await offlineManager.getNetworkStatus() 
            : { isOnline: navigator.onLine };
          sendResponse({ success: true, status: netStatus });
          break;
          
        case 'GET_CONFLICTS':
          const conflicts = await syncQueue.getConflicts();
          sendResponse({ success: true, conflicts });
          break;
          
        case 'RESOLVE_CONFLICT':
          const resolveResult = await syncQueue.resolveConflict(message.conflictId, message.resolution);
          sendResponse(resolveResult);
          break;
          
        case 'FORCE_SYNC':
          await syncQueue.forceSyncNow();
          sendResponse({ success: true });
          break;
          
        case 'GET_REALTIME_STATUS':
          const realtimeStatus = {
            connected: realtimeManager?.isConnected() || false,
            subscriptions: realtimeManager?.getSubscriptionCount() || 0
          };
          sendResponse({ success: true, status: realtimeStatus });
          break;
          
        case 'GET_STORAGE_STATS':
          const storageStats = offlineManager 
            ? await offlineManager.getStorageStats()
            : null;
          sendResponse({ success: true, stats: storageStats });
          break;
          
        case 'FORCE_CHECK_NETWORK':
          const forcedStatus = offlineManager
            ? await offlineManager.forceCheckNetworkStatus()
            : { isOnline: navigator.onLine };
          sendResponse({ success: true, status: forcedStatus });
          break;
          
        case 'REFRESH_CACHE':
          const refreshResult = cacheManager
            ? await cacheManager.refreshCache(message.force || false)
            : { success: false, error: 'Cache manager not initialized' };
          sendResponse(refreshResult);
          break;
          
        case 'INVALIDATE_CACHE':
          const invalidateResult = cacheManager
            ? await cacheManager.invalidateCache(message.type || null)
            : { success: false, error: 'Cache manager not initialized' };
          sendResponse(invalidateResult);
          break;
          
        case 'GET_CACHE_STATS':
          const cacheStats = cacheManager
            ? await cacheManager.getCacheStats()
            : { success: false, error: 'Cache manager not initialized' };
          sendResponse(cacheStats);
          break;
          
        case 'ENSURE_CONSISTENCY':
          const consistencyResult = cacheManager
            ? await cacheManager.ensureConsistency()
            : { success: false, error: 'Cache manager not initialized' };
          sendResponse(consistencyResult);
          break;
          
        case 'GET_WORKSPACES':
          const workspaces = await supabaseClient.getWorkspaces();
          sendResponse(workspaces);
          break;
          
        case 'CREATE_WORKSPACE':
          const workspace = await supabaseClient.createWorkspace(message.data);
          sendResponse(workspace);
          break;
          
        case 'ADD_TO_WORKSPACE':
          const added = await supabaseClient.addCaptureToWorkspace(message.workspaceId, message.captureId);
          sendResponse(added);
          break;
          
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[UpdateAI] Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  // Keep channel open for async response
  return true;
});

/**
 * Handle page detected from content script
 */
async function handlePageDetected(pageInfo) {
  currentPageInfo = pageInfo;
  
  // Check if user has an active project
  const result = await chrome.storage.local.get(['project']);
  
  if (result.project && result.project.links) {
    const isInProject = result.project.links.some(link => link.url === pageInfo.url);
    
    if (!isInProject) {
      // Show badge to indicate new page
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    }
  }
}

/**
 * Handle add capture
 */
async function handleAddCapture(capture) {
  try {
    // Add to sync queue (saves locally and syncs if online)
    const result = await syncQueue.addCapture(capture);
    
    if (result.success) {
      // Update badge
      const status = await syncQueue.getSyncStatus();
      if (status.pending > 0) {
        chrome.action.setBadgeText({ text: status.pending.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      } else {
        chrome.action.setBadgeText({ text: '' });
      }
      
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icons/icon128.png',
        title: 'Capture Added',
        message: 'Context saved to UpdateAI',
        priority: 0
      });
    }
    
    return result;
  } catch (error) {
    console.error('[UpdateAI] Add capture error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize after successful authentication
 */
async function initializeAfterAuth() {
  try {
    // Initialize sync queue with Supabase client
    syncQueue = new SyncQueue(supabaseClient);
    
    // Start background sync
    setupBackgroundSync();
    syncQueue.startPeriodicSync();
    
    // Migrate existing local data to Supabase
    await migrateLocalData();
    
    // Pull latest data from backend
    await syncQueue.pullFromBackend();
    
    console.log('[UpdateAI] Post-auth initialization complete');
  } catch (error) {
    console.error('[UpdateAI] Post-auth init error:', error);
  }
}

/**
 * Handle auth state changes from Supabase
 */
async function handleAuthStateChange(event, user) {
  console.log('[UpdateAI] Auth state change:', event);
  
  switch (event) {
    case 'SIGNED_IN':
      await initializeAfterAuth();
      break;
      
    case 'SIGNED_OUT':
      await handleLogout();
      break;
      
    case 'TOKEN_REFRESHED':
      console.log('[UpdateAI] Token refreshed successfully');
      break;
      
    case 'USER_UPDATED':
      console.log('[UpdateAI] User profile updated');
      break;
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    await supabaseClient.signOut();
    
    // Stop background sync
    if (syncQueue) {
      syncQueue.stopPeriodicSync();
    }
    chrome.alarms.clearAll();
    
    // Unsubscribe from realtime
    if (realtimeManager) {
      realtimeManager.unsubscribeAll();
    }
    
    // Clear cache
    if (cacheManager) {
      await cacheManager.clearOnSignOut();
    }
    
    // Clear badge
    chrome.action.setBadgeText({ text: '' });
    
    console.log('[UpdateAI] Logout successful');
  } catch (error) {
    console.error('[UpdateAI] Logout error:', error);
  }
}

/**
 * Migrate existing local data to Supabase on first login
 */
async function handleMigrateData() {
  try {
    const result = await chrome.storage.local.get(['captures', 'project', 'hasMigrated']);
    
    // Skip if already migrated
    if (result.hasMigrated) {
      return { success: true, message: 'Already migrated' };
    }
    
    const captures = result.captures || [];
    const project = result.project;
    
    let migrated = 0;
    let failed = 0;
    
    // Migrate captures
    if (captures.length > 0) {
      console.log(`[UpdateAI] Migrating ${captures.length} local captures`);
      
      for (const capture of captures) {
        // Skip if already synced
        if (capture.serverId) {
          migrated++;
          continue;
        }
        
        const response = await supabaseClient.createCapture(capture);
        
        if (response.success) {
          migrated++;
          // Update local capture with server ID
          capture.serverId = response.capture.id;
          capture.syncStatus = 'synced';
          capture.syncedAt = Date.now();
        } else {
          failed++;
          console.error('[UpdateAI] Capture migration failed:', capture.id, response.error);
        }
      }
      
      // Save updated captures
      await chrome.storage.local.set({ captures });
    }
    
    // Migrate project
    if (project) {
      console.log('[UpdateAI] Migrating project:', project.name);
      const response = await supabaseClient.saveProject(project);
      
      if (response.success) {
        // Update local project with server ID
        project.id = response.project.id;
        await chrome.storage.local.set({ project });
        migrated++;
      } else {
        console.error('[UpdateAI] Project migration failed:', response.error);
        failed++;
      }
    }
    
    // Mark as migrated
    await chrome.storage.local.set({
      hasMigrated: true,
      lastMigration: Date.now()
    });
    
    console.log(`[UpdateAI] Migration complete: ${migrated} migrated, ${failed} failed`);
    
    return {
      success: true,
      message: `Migrated ${migrated} items`,
      migrated,
      failed
    };
  } catch (error) {
    console.error('[UpdateAI] Migration error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Migrate local data wrapper
 */
async function migrateLocalData() {
  return handleMigrateData();
}

/**
 * Handle tab updates to detect page changes
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    currentPageInfo = null; // Reset on page change
  }
});

/**
 * Handle online/offline events
 */
self.addEventListener('online', () => {
  console.log('[UpdateAI] Back online');
  if (supabaseClient.isAuthenticated() && syncQueue) {
    syncQueue.processSyncQueue();
    syncQueue.pullFromBackend();
  }
});

self.addEventListener('offline', () => {
  console.log('[UpdateAI] Gone offline');
});

/**
 * Handle Chrome Background Sync API
 * Triggered when browser detects network connectivity
 */
self.addEventListener('sync', (event) => {
  console.log('[UpdateAI] Background sync event:', event.tag);
  
  if (event.tag === 'sync-captures') {
    event.waitUntil(
      (async () => {
        try {
          if (supabaseClient.isAuthenticated() && syncQueue) {
            await syncQueue.processSyncQueue();
            await syncQueue.pullFromBackend();
            console.log('[UpdateAI] Background sync completed');
          }
        } catch (error) {
          console.error('[UpdateAI] Background sync error:', error);
          // Re-register for retry
          try {
            await self.registration.sync.register('sync-captures');
          } catch (e) {
            console.error('[UpdateAI] Failed to re-register sync:', e);
          }
        }
      })()
    );
  }
});

/**
 * Handle extension icon click
 */
chrome.action.onClicked.addListener((tab) => {
  // Open popup (default behavior)
  chrome.action.openPopup();
});

console.log('[UpdateAI] Service worker ready');
