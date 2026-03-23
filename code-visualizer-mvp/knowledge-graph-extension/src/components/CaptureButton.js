// src/components/CaptureButton.js
// Reusable capture button component - Vanilla JS (works everywhere)

/**
 * Creates a capture button that can be injected into any page
 * 
 * Usage:
 *   const button = createCaptureButton(selectedText, {
 *     onCapture: (text) => { ... },
 *     onClose: () => { ... }
 *   });
 *   document.body.appendChild(button);
 */
export function createCaptureButton(selectedText, options = {}) {
  const {
    onCapture = () => {},
    onClose = () => {},
    position = 'center', // 'center', 'mouse', or {x, y}
    autoHide = 5000,
    text = '✨ Add to UpdateAI',
    successText = '✓ Added!',
    style = {}
  } = options;

  // Create button element
  const button = document.createElement('div');
  button.className = 'updateai-capture-button';
  
  // Default styles
  const defaultStyle = {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: '2147483647', // Maximum z-index
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '12px 20px',
    borderRadius: '12px',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(102, 126, 234, 0.4)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    userSelect: 'none',
    transition: 'all 0.2s ease',
    animation: 'fadeIn 0.3s ease'
  };

  // Merge custom styles
  Object.assign(button.style, defaultStyle, style);

  // Position button
  if (position === 'center') {
    // Already centered by default
  } else if (position === 'mouse' && window.event) {
    button.style.top = `${window.event.clientY + 20}px`;
    button.style.left = `${window.event.clientX}px`;
    button.style.transform = 'none';
  } else if (typeof position === 'object' && position.x && position.y) {
    button.style.top = `${position.y}px`;
    button.style.left = `${position.x}px`;
    button.style.transform = 'none';
  }

  button.textContent = text;

  // Add CSS animation
  if (!document.getElementById('updateai-animations')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'updateai-animations';
    styleSheet.textContent = `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
      
      .updateai-capture-button:hover {
        transform: translate(-50%, -50%) scale(1.05);
        box-shadow: 0 12px 32px rgba(102, 126, 234, 0.5);
      }
    `;
    document.head.appendChild(styleSheet);
  }

  // Click handler
  button.onclick = async (e) => {
    e.stopPropagation();
    
    // Call capture callback
    try {
      await onCapture(selectedText);
      
      // Success state
      button.textContent = successText;
      button.style.background = '#10b981';
      button.style.cursor = 'default';
      
      // Remove after delay
      setTimeout(() => {
        button.remove();
        onClose();
      }, 1500);
      
    } catch (error) {
      console.error('[CaptureButton] Capture failed:', error);
      button.textContent = '❌ Failed';
      button.style.background = '#ef4444';
      
      setTimeout(() => {
        button.remove();
        onClose();
      }, 2000);
    }
  };

  // Auto-hide timer
  let hideTimer;
  if (autoHide > 0) {
    hideTimer = setTimeout(() => {
      button.remove();
      onClose();
    }, autoHide);
  }

  // Cancel timer on hover
  button.onmouseenter = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  // Restart timer on mouse leave
  button.onmouseleave = () => {
    if (autoHide > 0 && !hideTimer) {
      hideTimer = setTimeout(() => {
        button.remove();
        onClose();
      }, autoHide);
    }
  };

  // Add cleanup method
  button.destroy = () => {
    if (hideTimer) clearTimeout(hideTimer);
    button.remove();
    onClose();
  };

  return button;
}

/**
 * Setup automatic capture button on text selection
 * 
 * Usage:
 *   setupAutoCaptureButton({
 *     minLength: 20,
 *     onCapture: async (text) => { ... }
 *   });
 */
export function setupAutoCaptureButton(options = {}) {
  const {
    minLength = 20,
    onCapture,
    container = document
  } = options;

  let currentButton = null;

  // Listen for text selection
  container.addEventListener('mouseup', () => {
    // Remove previous button
    if (currentButton) {
      currentButton.destroy();
      currentButton = null;
    }

    // Get selected text
    const selection = window.getSelection().toString().trim();
    
    // Check minimum length
    if (selection.length < minLength) {
      return;
    }

    // Create button
    currentButton = createCaptureButton(selection, {
      ...options,
      onCapture,
      onClose: () => {
        currentButton = null;
      }
    });

    // Add to page
    document.body.appendChild(currentButton);
  });

  // Cleanup function
  return () => {
    if (currentButton) {
      currentButton.destroy();
    }
  };
}
