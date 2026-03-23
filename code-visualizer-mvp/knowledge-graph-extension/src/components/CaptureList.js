// src/components/CaptureList.js
// Reusable capture list component - Vanilla JS

/**
 * Creates a capture list UI
 * 
 * Usage:
 *   const list = createCaptureList(captures, {
 *     onRemove: (id) => { ... },
 *     onClick: (capture) => { ... }
 *   });
 *   container.appendChild(list);
 */
export function createCaptureList(captures = [], options = {}) {
  const {
    onRemove = () => {},
    onClick = () => {},
    emptyMessage = 'No captures yet',
    showRemoveButton = true,
    maxHeight = null
  } = options;

  const container = document.createElement('div');
  container.className = 'updateai-capture-list';

  // Styles
  Object.assign(container.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: maxHeight || 'none',
    overflowY: maxHeight ? 'auto' : 'visible'
  });

  if (captures.length === 0) {
    // Empty state
    const empty = document.createElement('div');
    empty.style.cssText = `
      text-align: center;
      padding: 40px 20px;
      color: #9ca3af;
      font-size: 14px;
    `;
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return container;
  }

  // Render captures
  captures.forEach(capture => {
    const item = createCaptureItem(capture, {
      onRemove: () => onRemove(capture.id),
      onClick: () => onClick(capture),
      showRemoveButton
    });
    container.appendChild(item);
  });

  return container;
}

/**
 * Creates a single capture item
 */
function createCaptureItem(capture, options = {}) {
  const {
    onRemove = () => {},
    onClick = () => {},
    showRemoveButton = true
  } = options;

  const item = document.createElement('div');
  item.className = 'updateai-capture-item';

  // Get icon and color based on type
  const typeConfig = {
    'jira': { icon: '📋', bg: '#eff6ff', border: '#dbeafe' },
    'slack': { icon: '💬', bg: '#faf5ff', border: '#f3e8ff' },
    'google-docs': { icon: '📝', bg: '#fef2f2', border: '#fee2e2' },
    'default': { icon: '📄', bg: '#f9fafb', border: '#e5e7eb' }
  };

  const config = typeConfig[capture.type] || typeConfig.default;

  // Styles
  item.style.cssText = `
    background: ${config.bg};
    padding: 12px;
    border-radius: 8px;
    border: 1px solid ${config.border};
    cursor: ${onClick ? 'pointer' : 'default'};
    transition: all 0.2s ease;
  `;

  item.onmouseenter = () => {
    if (onClick) {
      item.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
      item.style.transform = 'translateY(-1px)';
    }
  };

  item.onmouseleave = () => {
    item.style.boxShadow = 'none';
    item.style.transform = 'none';
  };

  // Content
  item.innerHTML = `
    <div style="display: flex; align-items: start; gap: 10px;">
      <span style="font-size: 20px; flex-shrink: 0;">${config.icon}</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 13px; font-weight: 600; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 4px;">
          ${sanitize(capture.source || capture.title)}
        </div>
        ${capture.content ? `
          <div style="font-size: 12px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 4px;">
            ${sanitize(capture.content.substring(0, 100))}${capture.content.length > 100 ? '...' : ''}
          </div>
        ` : ''}
        <div style="font-size: 11px; color: #9ca3af;">
          ${formatTimeAgo(capture.timestamp)}
        </div>
      </div>
      ${showRemoveButton ? `
        <button class="remove-btn" style="
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          padding: 4px;
          font-size: 18px;
          line-height: 1;
          transition: color 0.2s;
        ">×</button>
      ` : ''}
    </div>
  `;

  // Event listeners
  if (onClick) {
    item.onclick = (e) => {
      if (!e.target.classList.contains('remove-btn')) {
        onClick();
      }
    };
  }

  if (showRemoveButton) {
    const removeBtn = item.querySelector('.remove-btn');
    removeBtn.onmouseenter = () => { removeBtn.style.color = '#ef4444'; };
    removeBtn.onmouseleave = () => { removeBtn.style.color = '#9ca3af'; };
    removeBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Remove this capture?')) {
        onRemove();
      }
    };
  }

  return item;
}

/**
 * Helper functions
 */
function sanitize(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  if (days < 7) return `${days}d ago`;
  
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
