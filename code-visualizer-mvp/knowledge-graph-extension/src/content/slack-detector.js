// src/content/slack-detector.js

(function detectSlack() {
    if (window.__updateai_detected) return;
    window.__updateai_detected = true;
    
    const url = window.location.href;
    
    // Detect channel or thread URLs
    const isChannel = url.includes('/archives/');
    const isThread = url.includes('/p');
    
    if (!isChannel && !isThread) return;
    
    // Extract channel name from URL or page
    let title = 'Slack Channel';
    
    // Wait for Slack to load
    setTimeout(() => {
      const channelName = document.querySelector('[data-qa="channel-name"]')?.textContent ||
                          document.querySelector('.p-channel_sidebar__name')?.textContent;
      
      if (channelName) {
        title = `#${channelName.trim()}`;
      }
      
      chrome.runtime.sendMessage({
        type: 'PAGE_DETECTED',
        pageInfo: {
          url,
          title,
          platform: 'slack',
          icon: '💬',
          timestamp: Date.now()
        }
      }).catch(() => {});
      
      console.log('[UpdateAI] Detected Slack:', title);
    }, 500);
  })();

// ============================================================================
// UPDATEAI CAPTURE FUNCTIONALITY
// ============================================================================

function captureSlackContext() {
    const channelName = document.querySelector('[data-qa="channel_name"]')?.textContent ||
                       document.querySelector('.p-channel_sidebar__name')?.textContent ||
                       'Unknown Channel';
    
    const messages = document.querySelectorAll('.c-virtual_list__item [data-qa="message_content"]');
    let content = '';
    
    Array.from(messages).slice(-5).forEach(msg => {
        const author = msg.closest('[data-qa^="message_container"]')?.querySelector('[data-qa="message_sender_name"]')?.textContent || 'Unknown';
        const text = msg.textContent;
        content += `${author}: ${text}\n\n`;
    });
    
    if (!content) content = 'Could not extract message content';
    
    return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        type: 'slack',
        source: channelName,
        title: `Slack • ${channelName}`,
        content: content.trim(),
        timestamp: Date.now(),
        url: window.location.href,
        metadata: { channelName }
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
            ...captureSlackContext(),
            content: selectedText,
            title: `Slack (Selection)`
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

console.log('UpdateAI: Slack capture ready');
