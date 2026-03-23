// src/background/service-worker-simple.js
// Simple service worker WITHOUT ES6 imports - Actually works in Chrome!

console.log('[UpdateAI Background] Service worker loaded');

// State
let currentPageInfo = null;

// ============================================
// INITIALIZATION
// ============================================

chrome.runtime.onInstalled.addListener(() => {
  console.log('[UpdateAI Background] Extension installed');
  
  // Initialize storage if needed
  chrome.storage.local.get(['captures', 'project'], (result) => {
    if (!result.captures) {
      chrome.storage.local.set({ captures: [] });
    }
    console.log('[UpdateAI Background] Initialized with', result.captures?.length || 0, 'captures');
  });
});

// ============================================
// MESSAGE HANDLERS
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[UpdateAI Background] Message received:', message.type);
  
  switch (message.type) {
    case 'PAGE_DETECTED':
      handlePageDetected(message.pageInfo);
      sendResponse({ success: true });
      break;
      
    case 'GET_CURRENT_PAGE':
      sendResponse({ pageInfo: currentPageInfo });
      break;
      
    case 'ADD_CAPTURE':
      handleAddCapture(message.capture, sendResponse);
      return true; // Keep channel open for async response
      
    case 'CLEAR_BADGE':
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  
  return false;
});

// ============================================
// PAGE DETECTION
// ============================================

async function handlePageDetected(pageInfo) {
  console.log('[UpdateAI Background] Page detected:', pageInfo.platform, pageInfo.title);
  
  // Update cached page info
  currentPageInfo = pageInfo;
  
  // Check if already in project
  try {
    const result = await chrome.storage.local.get(['project']);
    
    if (!result.project) {
      // No project yet - show "new" badge
      setBadge('new');
      return;
    }
    
    // Check if URL already in project
    const isInProject = result.project.links?.some(link => 
      link.url === pageInfo.url
    );
    
    if (isInProject) {
      // Already added - no badge
      setBadge('');
    } else {
      // Suggest adding
      setBadge('add');
    }
  } catch (error) {
    console.error('[UpdateAI Background] Error checking project:', error);
  }
}

function setBadge(type) {
  switch(type) {
    case 'new':
      // Blue badge - create project
      chrome.action.setBadgeText({ text: '1' });
      chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      break;
    case 'add':
      // Green badge - add to project
      chrome.action.setBadgeText({ text: '+' });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
      break;
    default:
      // Clear badge
      chrome.action.setBadgeText({ text: '' });
  }
}

// ============================================
// CAPTURE HANDLING
// ============================================

async function handleAddCapture(capture, sendResponse) {
  try {
    console.log('[UpdateAI Background] Adding capture:', capture.type, capture.source);
    
    // Get existing captures
    const result = await chrome.storage.local.get(['captures']);
    const captures = result.captures || [];
    
    // Add new capture
    captures.push(capture);
    
    // Save back to storage
    await chrome.storage.local.set({ captures });
    
    // Update badge with count
    chrome.action.setBadgeText({ text: captures.length.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    
    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon128.png',
      title: 'Capture Added',
      message: `Captured from ${capture.source}`,
      priority: 1
    });
    
    console.log('[UpdateAI Background] Capture saved. Total:', captures.length);
    
    sendResponse({ success: true, count: captures.length });
    
  } catch (error) {
    console.error('[UpdateAI Background] Error saving capture:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// ============================================
// BADGE INITIALIZATION ON STARTUP
// ============================================

chrome.storage.local.get(['captures'], (result) => {
  const count = (result.captures || []).length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  }
  console.log('[UpdateAI Background] Initialized with', count, 'captures');
});

console.log('[UpdateAI Background] Service worker ready');
