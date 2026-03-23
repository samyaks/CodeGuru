// src/content/google-detector.js
// Ultra-lightweight: runs once, sends message, done

(function detectGoogleDoc() {
    // Only run once
    if (window.__updateai_detected) return;
    window.__updateai_detected = true;
    
    // Quick detection - no heavy processing
    const url = window.location.href;
    const title = document.title;
    
    let platform, icon, cleanTitle;
    
    if (url.includes('/document/')) {
      platform = 'google_docs';
      icon = '📄';
      cleanTitle = title.replace(' - Google Docs', '').trim();
    } else if (url.includes('/spreadsheets/')) {
      platform = 'google_sheets';
      icon = '📊';
      cleanTitle = title.replace(' - Google Sheets', '').trim();
    } else if (url.includes('/presentation/')) {
      platform = 'google_slides';
      icon = '📽️';
      cleanTitle = title.replace(' - Google Slides', '').trim();
    } else {
      // Unknown Google Docs type, skip
      return;
    }
    
    // Send to background - fire and forget
    chrome.runtime.sendMessage({
      type: 'PAGE_DETECTED',
      pageInfo: {
        url,
        title: cleanTitle || 'Untitled',
        platform,
        icon,
        timestamp: Date.now()
      }
    }).catch(() => {
      // Extension context invalidated, ignore
    });
    
    console.log('[UpdateAI] Detected:', platform, cleanTitle);
  })();

// ============================================================================
// UPDATEAI CAPTURE FUNCTIONALITY
// ============================================================================

function captureGoogleContext() {
    const title = document.querySelector('.docs-title-input')?.value || 
                  document.title.split(' - ')[0] ||
                  'Untitled Document';
    
    const contentElements = document.querySelectorAll('.kix-paragraphrenderer');
    let content = '';
    contentElements.forEach((el, idx) => {
        if (idx < 10) content += el.textContent + '\n';
    });
    
    if (!content) content = 'Content extraction not available';
    else content = content.substring(0, 500);
    
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        type: 'google-docs',
        source: title,
        title: `Google Doc • ${title}`,
        content: content,
        timestamp: Date.now(),
        url: window.location.href,
        metadata: {}
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
    `;
    
    captureButton.textContent = '✨ Add to UpdateAI';
    
    captureButton.onclick = () => {
        const capture = {
            ...captureGoogleContext(),
            content: selectedText,
            title: `Google Doc (Selection)`
        };
        
        chrome.runtime.sendMessage({ type: 'ADD_CAPTURE', capture });
        
        captureButton.textContent = '✓ Added!';
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

console.log('UpdateAI: Google Docs capture ready');
