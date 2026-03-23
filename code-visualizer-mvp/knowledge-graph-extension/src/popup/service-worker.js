// src/background/service-worker.js
// Minimal, event-driven background worker

console.log('[UpdateAI Background] Service worker loaded');

// Cache current page info (lightweight)
let currentPageInfo = null;

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  if (message.type === 'PAGE_DETECTED') {
    handlePageDetected(message.pageInfo);
    return false;
  }
  
  if (message.type === 'GET_CURRENT_PAGE') {
    sendResponse({ pageInfo: currentPageInfo });
    return false;
  }
  
  if (message.type === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
    return false;
  }
  
  // For backward compatibility - keep existing handlers
  return false;
});

async function handlePageDetected(pageInfo) {
  console.log('[UpdateAI Background] Page detected:', pageInfo);
  
  // Update cached page info
  currentPageInfo = pageInfo;
  
  // Check if already in project
  try {
    const result = await chrome.storage.local.get(['project']);
    
    if (!result.project) {
      // No project yet - suggest creating one
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

// ============================================================================
// UPDATEAI WORKSPACE INTEGRATION
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ADD_CAPTURE') {
        chrome.storage.local.get(['captures'], (result) => {
            const captures = result.captures || [];
            captures.push(message.capture);
            
            chrome.storage.local.set({ captures }, () => {
                chrome.action.setBadgeText({ text: captures.length.toString() });
                chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
                console.log('Capture added:', message.capture);
                sendResponse({ success: true });
            });
        });
        return true;
    }
    
    if (message.type === 'GET_CAPTURES') {
        chrome.storage.local.get(['captures'], (result) => {
            sendResponse({ captures: result.captures || [] });
        });
        return true;
    }
    
    if (message.type === 'CLEAR_CAPTURES') {
        chrome.storage.local.set({ captures: [] }, () => {
            chrome.action.setBadgeText({ text: '' });
            sendResponse({ success: true });
        });
        return true;
    }
});

// Initialize badge on startup
chrome.storage.local.get(['captures'], (result) => {
    const count = (result.captures || []).length;
    if (count > 0) {
        chrome.action.setBadgeText({ text: count.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    }
});

console.log('UpdateAI: Service worker ready');
