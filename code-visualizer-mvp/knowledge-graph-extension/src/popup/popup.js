// src/popup/popup.js
// Simple popup WITHOUT ES6 imports - Works in Chrome!

console.log('[UpdateAI Popup] Script loaded');

// ============================================
// STATE
// ============================================

const State = {
  currentPageInfo: null,
  project: null,
  captures: [],
  isGenerating: false,
  
  async loadProject() {
    try {
      const result = await chrome.storage.local.get(['project']);
      this.project = result.project;
      return this.project;
    } catch (error) {
      console.error('[State] Failed to load project:', error);
      return null;
    }
  },
  
  async saveProject() {
    try {
      await chrome.storage.local.set({ project: this.project });
      return true;
    } catch (error) {
      console.error('[State] Failed to save project:', error);
      showToast('Failed to save project', 'error');
      return false;
    }
  },
  
  async loadCaptures() {
    try {
      const result = await chrome.storage.local.get(['captures']);
      this.captures = result.captures || [];
      return this.captures;
    } catch (error) {
      console.error('[State] Failed to load captures:', error);
      return [];
    }
  },
  
  isPageInProject(pageInfo) {
    if (!pageInfo || !this.project || !this.project.links) return false;
    return this.project.links.some(link => link.url === pageInfo.url);
  }
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  console.log('[UpdateAI Popup] Initializing...');
  showLoadingState();
  
  try {
    // Get current page info
    const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_PAGE' });
    State.currentPageInfo = response?.pageInfo;
    
    // Load project and captures
    await State.loadProject();
    await State.loadCaptures();
    
    console.log('[UpdateAI Popup] Loaded:', State.project ? 'has project' : 'no project', `${State.captures.length} captures`);
    
    // Show appropriate view
    if (!State.project) {
      showFirstTimeSetup();
    } else if (State.currentPageInfo && !State.isPageInProject(State.currentPageInfo)) {
      showAddToProjectPrompt();
    } else {
      showProjectView();
    }
    
    // Load captures preview
    loadCapturesPreview();
    
  } catch (error) {
    console.error('[UpdateAI Popup] Init error:', error);
    showErrorState();
  }
}

// ============================================
// VIEWS
// ============================================

function showLoadingState() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div style="text-align: center; padding: 60px 20px;">
      <div style="font-size: 32px; margin-bottom: 12px;">🚀</div>
      <div style="color: #9ca3af; font-size: 14px;">Loading...</div>
    </div>
  `;
}

function showErrorState() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div style="text-align: center; padding: 40px 20px;">
      <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
      <div style="color: #ef4444; font-size: 14px; margin-bottom: 16px;">
        Something went wrong
      </div>
      <button class="btn btn-secondary" onclick="location.reload()">Retry</button>
    </div>
  `;
}

function showFirstTimeSetup() {
  const root = document.getElementById('root');
  const suggestedName = State.currentPageInfo?.title || '';
  
  root.innerHTML = `
    <div class="header">
      <h1>🎉 Welcome to UpdateAI!</h1>
      <p style="font-size: 14px; color: #6b7280; margin-top: 8px;">
        Capture context as you work
      </p>
    </div>
    
    ${State.currentPageInfo ? `
      <div class="card" style="background: #eff6ff; border: 2px solid #3b82f6; margin-bottom: 16px;">
        <div style="font-size: 13px; color: #1e40af; font-weight: 500; margin-bottom: 12px;">
          ✨ We noticed you're viewing:
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px;">
          <span style="font-size: 32px; line-height: 1;">${State.currentPageInfo.icon}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: 600; font-size: 15px; color: #111827; margin-bottom: 4px;">
              ${sanitizeText(State.currentPageInfo.title)}
            </div>
            <div style="font-size: 12px; color: #6b7280; word-break: break-all;">
              ${sanitizeText(State.currentPageInfo.url)}
            </div>
          </div>
        </div>
      </div>
    ` : ''}
    
    <div class="card">
      <div class="form-group">
        <label for="projectName">Project Name</label>
        <input 
          type="text" 
          id="projectName" 
          placeholder="e.g., Q1 Platform Redesign"
          value="${sanitizeText(suggestedName)}"
        />
      </div>
      
      <button class="btn btn-primary" onclick="createProject()">
        Start Tracking
      </button>
    </div>
  `;
  
  // Focus input
  setTimeout(() => {
    const input = document.getElementById('projectName');
    if (input) input.focus();
  }, 100);
  
  // Enter key to submit
  document.getElementById('projectName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createProject();
  });
}

function showAddToProjectPrompt() {
  const root = document.getElementById('root');
  
  root.innerHTML = `
    <div class="header">
      <h1>📋 ${sanitizeText(State.project.name)}</h1>
      <p>Project tracking active</p>
    </div>
    
    <div class="card" style="background: #f0fdf4; border: 2px solid #10b981; margin-bottom: 16px;">
      <div style="font-size: 13px; color: #166534; font-weight: 500; margin-bottom: 12px;">
        ✨ New page detected!
      </div>
      <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px;">
        <span style="font-size: 32px; line-height: 1;">${State.currentPageInfo.icon}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; font-size: 15px; color: #111827; margin-bottom: 4px;">
            ${sanitizeText(State.currentPageInfo.title)}
          </div>
          <div style="font-size: 12px; color: #6b7280; word-break: break-all;">
            ${sanitizeText(State.currentPageInfo.url)}
          </div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="addCurrentPage()">
        ✓ Add to Project
      </button>
    </div>
    
    <button class="btn btn-secondary" onclick="showProjectView()">
      View My Project
    </button>
  `;
}

function showProjectView() {
  const root = document.getElementById('root');
  const links = State.project?.links || [];
  
  root.innerHTML = `
    <div class="header">
      <h1>📋 ${sanitizeText(State.project?.name || 'My Project')}</h1>
      <p style="font-size: 13px; color: #6b7280;">
        ${links.length} link${links.length !== 1 ? 's' : ''} tracked
      </p>
    </div>
    
    ${links.length === 0 ? `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <p>No links added yet</p>
        <p style="font-size: 13px; color: #9ca3af; margin-top: -12px;">
          Visit a page to start tracking
        </p>
      </div>
    ` : `
      <div class="card" style="margin-bottom: 16px;">
        ${links.map((link, index) => `
          <div class="link" style="margin-bottom: 12px; border: 1px solid #e5e7eb;">
            <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
              <span style="font-size: 20px; flex-shrink: 0;">${link.icon}</span>
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 500; font-size: 13px; color: #111827; margin-bottom: 2px;">
                  ${sanitizeText(link.title)}
                </div>
                <div style="font-size: 11px; color: #9ca3af;">
                  Added ${formatDate(link.addedAt)}
                </div>
              </div>
            </div>
            
            <div class="link-actions">
              <button class="btn btn-small btn-secondary" onclick="removeLink(${index})">
                Remove
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    
    <button class="btn btn-secondary" onclick="resetProject()" style="margin-top: 8px;">
      🔄 Start New Project
    </button>
  `;
}

// ============================================
// ACTIONS
// ============================================

async function createProject() {
  const projectName = document.getElementById('projectName').value.trim();
  
  if (!projectName) {
    showToast('⚠️ Please enter a project name', 'warning');
    document.getElementById('projectName').focus();
    return;
  }
  
  // Create new project
  State.project = {
    name: sanitizeText(projectName),
    links: State.currentPageInfo ? [{
      title: sanitizeText(State.currentPageInfo.title),
      url: sanitizeText(State.currentPageInfo.url),
      platform: State.currentPageInfo.platform,
      icon: State.currentPageInfo.icon,
      addedAt: Date.now()
    }] : [],
    createdAt: Date.now()
  };
  
  const saved = await State.saveProject();
  if (!saved) return;
  
  // Clear badge
  await chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
  
  showToast('✓ Project created!');
  showProjectView();
}

async function addCurrentPage() {
  if (!State.currentPageInfo) {
    showToast('⚠️ No page detected', 'warning');
    return;
  }
  
  if (State.isPageInProject(State.currentPageInfo)) {
    showToast('⚠️ Page already in project', 'warning');
    return;
  }
  
  if (!State.project.links) State.project.links = [];
  
  State.project.links.push({
    title: sanitizeText(State.currentPageInfo.title),
    url: sanitizeText(State.currentPageInfo.url),
    platform: State.currentPageInfo.platform,
    icon: State.currentPageInfo.icon,
    addedAt: Date.now()
  });
  
  const saved = await State.saveProject();
  if (!saved) return;
  
  await chrome.runtime.sendMessage({ type: 'CLEAR_BADGE' });
  
  showToast('✓ Added to project!');
  showProjectView();
}

async function removeLink(index) {
  if (!confirm('Remove this link from project?')) return;
  
  State.project.links.splice(index, 1);
  
  const saved = await State.saveProject();
  if (!saved) return;
  
  showToast('✓ Link removed');
  showProjectView();
}

async function resetProject() {
  if (!confirm('Start a new project? This will clear your current project.')) return;
  
  State.project = null;
  await chrome.storage.local.remove(['project']);
  
  showToast('✓ Project reset');
  showFirstTimeSetup();
}

// ============================================
// WORKSPACE & CAPTURES
// ============================================

async function loadCapturesPreview() {
  const container = document.getElementById('captures-preview');
  if (!container) return;
  
  await State.loadCaptures();
  const captures = State.captures;
  
  if (captures.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; font-size: 12px; color: #9ca3af;">
        No captures yet.<br>
        <span style="font-size: 11px;">Highlight text on Jira, Docs, or Slack to capture.</span>
      </div>
    `;
    return;
  }
  
  container.innerHTML = captures.map(capture => {
    let icon = '📄';
    let bgColor = '#f9fafb';
    
    if (capture.type === 'jira') { icon = '📋'; bgColor = '#eff6ff'; }
    if (capture.type === 'slack') { icon = '💬'; bgColor = '#faf5ff'; }
    if (capture.type === 'google-docs') { icon = '📝'; bgColor = '#fef2f2'; }
    
    return `
      <div style="background: ${bgColor}; padding: 10px; border-radius: 8px; margin-bottom: 8px; border: 1px solid #e5e7eb;">
        <div style="display: flex; align-items: start; gap: 10px;">
          <span style="font-size: 18px; flex-shrink: 0;">${icon}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 12px; font-weight: 600; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${sanitizeText(capture.source)}
            </div>
            <div style="font-size: 10px; color: #6b7280;">${getTimeAgo(capture.timestamp)}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Open Workspace button
document.getElementById('openWorkspace')?.addEventListener('click', async () => {
  if (State.captures.length === 0) {
    alert('No captures yet! Highlight text on Jira, Docs, or Slack to capture context.');
    return;
  }
  
  // For now, just open the workspace HTML file
  // Later this will be a deployed web app
  const workspaceUrl = '/Users/samyak/Downloads/app.html';
  chrome.tabs.create({ url: workspaceUrl });
});

// Clear Captures button
document.getElementById('clearCaptures')?.addEventListener('click', async () => {
  if (confirm('Clear all captured context?')) {
    await chrome.storage.local.set({ captures: [] });
    chrome.action.setBadgeText({ text: '' });
    State.captures = [];
    loadCapturesPreview();
    showToast('✓ Captures cleared');
  }
});

// ============================================
// HELPERS
// ============================================

function sanitizeText(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());
  
  const bgColors = {
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444'
  };
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bgColors[type] || bgColors.success};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    opacity: 0;
    transition: opacity 300ms;
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });
  
  // Auto-remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

console.log('[UpdateAI Popup] Ready');
