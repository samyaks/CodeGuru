// src/content/jira-detector.js

(function detectJira() {
    if (window.__updateai_detected) return;
    window.__updateai_detected = true;
    
    const url = window.location.href;
    
    // Only detect issue pages
    if (!url.includes('/browse/')) return;
    
    // Extract issue key from URL
    const issueKey = url.match(/\/browse\/([A-Z]+-\d+)/)?.[1];
    if (!issueKey) return;
    
    // Try to get issue title (might not be loaded yet)
    let title = issueKey;
    
    // Wait briefly for title to load (non-blocking)
    setTimeout(() => {
      const titleEl = document.querySelector('[data-test-id="issue.views.issue-base.foundation.summary.heading"]') ||
                      document.querySelector('h1');
      
      if (titleEl?.textContent) {
        title = `${issueKey}: ${titleEl.textContent.trim()}`;
      }
      
      chrome.runtime.sendMessage({
        type: 'PAGE_DETECTED',
        pageInfo: {
          url,
          title,
          platform: 'jira',
          icon: '🎫',
          timestamp: Date.now()
        }
      }).catch(() => {});
      
      console.log('[UpdateAI] Detected Jira:', title);
    }, 500);
  })();

// ============================================================================
// UPDATEAI CAPTURE FUNCTIONALITY
// ============================================================================

function captureJiraContext() {
    const issueKey = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]')?.textContent ||
                     window.location.pathname.match(/[A-Z]+-\d+/)?.[0] ||
                     'Unknown';
    
    const title = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]')?.textContent || 
                  document.querySelector('h1')?.textContent || 
                  'Untitled Issue';
    
    const descriptionEl = document.querySelector('[data-testid="issue.views.field.rich-text.description"]');
    const description = descriptionEl?.innerText || 'No description';
    
    const content = `${title}\n\n${description}`;
    
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        type: 'jira',
        source: issueKey,
        title: `Jira • ${issueKey}`,
        content: content,
        timestamp: Date.now(),
        url: window.location.href,
        metadata: { issueKey }
    };
}

let captureButton = null;

document.addEventListener('mouseup', () => {
    if (captureButton) {
        captureButton.remove();
        captureButton = null;
    }
    
    const selection = window.getSelection().toString().trim();
    if (selection.length > 20) {
        showCaptureButton(selection);
    }
});

function showCaptureButton(selectedText) {
    captureButton = document.createElement('div');
    captureButton.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 999999;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 12px;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    captureButton.innerHTML = '✨ Add to UpdateAI';
    
    captureButton.onclick = () => {
        const baseCapture = captureJiraContext();
        const capture = {
            ...baseCapture,
            content: selectedText,
            title: `${baseCapture.title} (Selection)`
        };
        
        chrome.runtime.sendMessage({ type: 'ADD_CAPTURE', capture });
        
        captureButton.innerHTML = '✓ Added!';
        captureButton.style.background = '#10b981';
        
        setTimeout(() => {
            captureButton.remove();
            captureButton = null;
        }, 1500);
    };
    
    document.body.appendChild(captureButton);
    
    setTimeout(() => {
        if (captureButton) {
            captureButton.remove();
            captureButton = null;
        }
    }, 5000);
}

console.log('UpdateAI: Jira capture ready');
