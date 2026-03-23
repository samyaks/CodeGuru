// src/popup/popup.js
// Production-ready: Security hardened + best practices + Supabase integration

import { showLoginScreen, showUserProfile, showSyncStatus } from './auth-ui.js';
import supabaseClient from '../api/supabase-client.js';

// ==============================================
// CONSTANTS
// ==============================================

const TIMINGS = {
  FOCUS_DELAY: 100,
  MESSAGE_CYCLE: 2000,
  TOAST_DURATION: 2500,
  TOAST_FADE: 300
};

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

// ==============================================
// STATE
// ==============================================

const State = {
  _currentPageInfo: null,
  _project: null,
  _isGenerating: false,
  _user: null,
  _isAuthenticated: false,
  _workspaces: [],
  _syncStatus: null,
  
  get currentPageInfo() {
    return this._currentPageInfo;
  },
  
  set currentPageInfo(value) {
    this._currentPageInfo = value;
  },
  
  get project() {
    return this._project;
  },
  
  set project(value) {
    this._project = value;
  },
  
  get isGenerating() {
    return this._isGenerating;
  },
  
  set isGenerating(value) {
    this._isGenerating = value;
  },
  
  get user() {
    return this._user;
  },
  
  set user(value) {
    this._user = value;
  },
  
  get isAuthenticated() {
    return this._isAuthenticated;
  },
  
  set isAuthenticated(value) {
    this._isAuthenticated = value;
  },
  
  get workspaces() {
    return this._workspaces;
  },
  
  set workspaces(value) {
    this._workspaces = value;
  },
  
  get syncStatus() {
    return this._syncStatus;
  },
  
  set syncStatus(value) {
    this._syncStatus = value;
  },
  
  async loadProject() {
    try {
      // If authenticated, try to load from Supabase
      if (this.isAuthenticated && supabaseClient.isAuthenticated()) {
        const response = await supabaseClient.getProject();
        
        if (response.success && response.project) {
          this.project = response.project;
          // Cache locally for offline access
          await chrome.storage.local.set({ project: this.project });
          return this.project;
        }
      }
      
      // Fallback to local storage (offline mode or not authenticated)
      const result = await chrome.storage.local.get(['project']);
      this.project = result.project;
      return this.project;
    } catch (error) {
      console.error('[State] Failed to load project:', error);
      // Fallback to local storage on error
      const result = await chrome.storage.local.get(['project']);
      this.project = result.project;
      return this.project;
    }
  },
  
  async saveProject() {
    try {
      // Always save locally first (offline-first)
      await chrome.storage.local.set({ project: this.project });
      
      // If authenticated, sync to Supabase
      if (this.isAuthenticated && supabaseClient.isAuthenticated()) {
        const response = await supabaseClient.saveProject(this.project);
        
        if (response.success) {
          // Update local project with server ID
          this.project.id = response.project.id;
          await chrome.storage.local.set({ project: this.project });
        } else {
          console.warn('[State] Failed to sync project to Supabase:', response.error);
          // Continue - local save succeeded
        }
      }
      
      return true;
    } catch (error) {
      console.error('[State] Failed to save project:', error);
      showToast('Failed to save project', 'error');
      return false;
    }
  },
  
  async loadAuth() {
    try {
      // Initialize Supabase client if not already done
      if (!supabaseClient.isInitialized) {
        await supabaseClient.init();
      }
      
      // Check Supabase auth state
      this.isAuthenticated = supabaseClient.isAuthenticated();
      this.user = supabaseClient.getUser();
      
      // If not authenticated via Supabase, check local storage for backward compatibility
      if (!this.isAuthenticated) {
        const result = await chrome.storage.local.get(['user']);
        this.user = result.user;
        // Note: isAuthenticated remains false since we need Supabase session
      }
      
      return this.isAuthenticated;
    } catch (error) {
      console.error('[State] Failed to load auth:', error);
      return false;
    }
  },
  
  async loadWorkspaces() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_WORKSPACES' });
      if (response.success) {
        this.workspaces = response.workspaces;
      }
      return this.workspaces;
    } catch (error) {
      console.error('[State] Failed to load workspaces:', error);
      return [];
    }
  },
  
  async loadSyncStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
      if (response.success) {
        this.syncStatus = response.status;
      }
      return this.syncStatus;
    } catch (error) {
      console.error('[State] Failed to load sync status:', error);
      return null;
    }
  },
  
  isPageInProject(pageInfo) {
    if (!pageInfo || !this.project || !this.project.links) return false;
    return this.project.links.some(link => link.url === pageInfo.url);
  }
};

// ==============================================
// INIT
// ==============================================

document.addEventListener('DOMContentLoaded', init);

// Cleanup on popup close
window.addEventListener('unload', cleanup);

function cleanup() {
  if (window.loadingInterval) {
    clearInterval(window.loadingInterval);
  }
  if (window.syncStatusInterval) {
    clearInterval(window.syncStatusInterval);
  }
}

/**
 * Start polling for sync status updates
 */
let syncStatusInterval;

function startSyncStatusPolling() {
  // Clear existing interval
  if (syncStatusInterval) {
    clearInterval(syncStatusInterval);
  }
  
  // Poll every 5 seconds
  syncStatusInterval = setInterval(async () => {
    try {
      if (State.isAuthenticated) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
        if (response.success && response.status) {
          State.syncStatus = response.status;
          
          // Update sync status UI if it exists
          const existingSyncStatus = document.getElementById('syncStatus');
          if (existingSyncStatus) {
            showSyncStatus(response.status);
          }
        }
      }
    } catch (error) {
      console.error('[UpdateAI Popup] Sync status polling error:', error);
    }
  }, 5000);
  
  // Store interval globally for cleanup
  window.syncStatusInterval = syncStatusInterval;
}

/**
 * Listen for storage changes to update UI
 */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    // Update captures display if changed
    if (changes.captures) {
      const capturesPreview = document.getElementById('captures-preview');
      if (capturesPreview) {
        loadCaptures();
      }
    }
    
    // Update sync status if changed
    if (changes.syncQueue || changes.lastSyncSuccess) {
      if (State.isAuthenticated) {
        State.loadSyncStatus().then(status => {
          if (status) {
            showSyncStatus(status);
          }
        });
      }
    }
    
    // Update project if changed
    if (changes.project) {
      State.project = changes.project.newValue;
      // Refresh view if on project view
      const projectView = document.querySelector('.project-view');
      if (projectView) {
        showProjectView();
      }
    }
  }
});

async function init() {
  showLoadingState();
  
  try {
    // Initialize Supabase client and load auth state
    await State.loadAuth();
    
    console.log('[UpdateAI Popup] Auth status:', State.isAuthenticated);
    if (State.user) {
      console.log('[UpdateAI Popup] User:', State.user.email);
    }
    
    // Get current page info from background worker
    const response = await chrome.runtime.sendMessage({ 
      type: 'GET_CURRENT_PAGE' 
    });
    State.currentPageInfo = response?.pageInfo;
    
    console.log('[UpdateAI Popup] Current page:', State.currentPageInfo);
    
    // If authenticated, load workspaces and sync status
    if (State.isAuthenticated) {
      await Promise.all([
        State.loadWorkspaces(),
        State.loadSyncStatus()
      ]);
    }
    
    // Load project (from Supabase if authenticated, local storage otherwise)
    await State.loadProject();
    
    console.log('[UpdateAI Popup] Project:', State.project);
    
    // Migrate old data format if needed
    await migrateDataIfNeeded();
    
    // Decide what to show
    if (!State.project) {
      showFirstTimeSetup();
    } else if (State.currentPageInfo && !State.isPageInProject(State.currentPageInfo)) {
      showAddToProjectPrompt();
    } else {
      showProjectView();
    }
    
    // Show auth UI components
    if (State.isAuthenticated && State.user) {
      showUserProfile(State.user, handleLogout);
      if (State.syncStatus) {
        showSyncStatus(State.syncStatus);
      }
    } else {
      // Show sign-in prompt for unauthenticated users
      showSignInPromptInline();
    }
    
    // Start periodic sync status updates (every 5 seconds if authenticated)
    if (State.isAuthenticated) {
      startSyncStatusPolling();
    }
    
  } catch (error) {
    console.error('[UpdateAI Popup] Init error:', error);
    showErrorState();
  }
}

// ==============================================
// DATA MIGRATION
// ==============================================

async function migrateDataIfNeeded() {
  if (!State.project || !State.project.links) return;
  
  // Check if links are old format (plain strings)
  if (typeof State.project.links[0] === 'string') {
    console.log('[UpdateAI Popup] Migrating old data format...');
    
    State.project.links = State.project.links.map(url => ({
      title: sanitizeText(new URL(url).hostname),
      url: sanitizeText(url),
      platform: 'unknown',
      icon: '🔗',
      addedAt: Date.now()
    }));
    
    await State.saveProject();
    console.log('[UpdateAI Popup] Migration complete');
  }
}

// ==============================================
// SECURITY HELPERS
// ==============================================

function sanitizeText(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function validateURL(urlString) {
  if (!urlString) {
    return { valid: false, error: 'Please enter a URL' };
  }
  
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { valid: false, error: 'Please enter a valid URL' };
  }
  
  // Only allow safe protocols
  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return { 
      valid: false, 
      error: 'Only http:// and https:// URLs are allowed' 
    };
  }
  
  return { valid: true, url };
}

function validateAPIKey(key) {
  if (!key) {
    return { valid: false, error: 'Please enter your OpenAI API key' };
  }
  
  // Basic format check (OpenAI keys start with sk-)
  if (!key.startsWith('sk-')) {
    return { 
      valid: false, 
      error: 'Invalid API key format (should start with sk-)' 
    };
  }
  
  return { valid: true };
}

// ==============================================
// VIEW HELPERS
// ==============================================

function attachListeners(listeners) {
  listeners.forEach(({ id, event, handler, selector }) => {
    if (selector) {
      // For delegated events (e.g., dynamic buttons with data-index)
      document.querySelectorAll(selector).forEach((el) => {
        const index = parseInt(el.dataset.index);
        el.addEventListener(event, () => handler(index));
      });
    } else if (id) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener(event, handler);
      }
    }
  });
}

// ==============================================
// VIEWS
// ==============================================

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
      <button class="btn btn-secondary" id="retryBtn">Retry</button>
    </div>
  `;
  
  attachListeners([
    { id: 'retryBtn', event: 'click', handler: () => location.reload() }
  ]);
}

function showFirstTimeSetup() {
  const root = document.getElementById('root');
  const suggestedName = State.currentPageInfo?.title || '';
  
  root.innerHTML = `
    <div class="header">
      <h1>🎉 Welcome to UpdateAI!</h1>
      <p style="font-size: 14px; color: #6b7280; margin-top: 8px;">
        Generate updates in 2 minutes
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
        <div style="font-size: 12px; color: #1e40af;">
          💡 <strong>Tip:</strong> We'll add this to your project automatically!
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
      
      <button class="btn btn-primary" id="createProjectBtn">
        Start Tracking
      </button>
    </div>
  `;
  
  // Focus input after render
  setTimeout(() => {
    const input = document.getElementById('projectName');
    if (input) {
      input.focus();
      if (suggestedName) {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }, TIMINGS.FOCUS_DELAY);
  
  attachListeners([
    { id: 'createProjectBtn', event: 'click', handler: createProject }
  ]);
  
  // Enter key to submit
  document.getElementById('projectName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      createProject();
    }
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
      <button class="btn btn-primary" id="addCurrentPageBtn">
        ✓ Add to Project
      </button>
    </div>
    
    <button class="btn btn-secondary" id="viewProjectBtn">
      View My Project
    </button>
  `;
  
  attachListeners([
    { id: 'addCurrentPageBtn', event: 'click', handler: addCurrentPage },
    { id: 'viewProjectBtn', event: 'click', handler: showProjectView }
  ]);
}

function showProjectView() {
  const root = document.getElementById('root');
  
  // Group links by category with safe defaults
  const categorized = {
    progress: [],
    decision: [],
    blocker: [],
    next_step: [],
    uncategorized: []
  };
  
  (State.project.links || []).forEach((link, index) => {
    const category = link.category || 'uncategorized';
    if (categorized[category]) {
      categorized[category].push({ ...link, originalIndex: index });
    } else {
      categorized.uncategorized.push({ ...link, originalIndex: index });
    }
  });
  
  // Count total categorized vs uncategorized
  const totalCategorized = categorized.progress.length + 
                          categorized.decision.length + 
                          categorized.blocker.length + 
                          categorized.next_step.length;
  const totalUncategorized = categorized.uncategorized.length;
  
  root.innerHTML = `
    <div class="header">
      <h1>📋 ${sanitizeText(State.project.name)}</h1>
      <p style="font-size: 13px; color: #6b7280;">
        ${State.project.links?.length || 0} links tracked
      </p>
      ${totalUncategorized > 0 ? `
        <div style="margin-top: 8px; padding: 8px 12px; background: #fef3c7; border-radius: 6px; font-size: 12px; color: #92400e;">
          💡 ${totalUncategorized} link${totalUncategorized > 1 ? 's' : ''} need${totalUncategorized === 1 ? 's' : ''} categorizing for better summaries
        </div>
      ` : ''}
    </div>
    
    ${!State.project.links || State.project.links.length === 0 ? `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <p>No links added yet</p>
        <p style="font-size: 13px; color: #9ca3af; margin-top: -12px;">
          Visit a page to start tracking
        </p>
      </div>
    ` : `
      <div class="card" style="margin-bottom: 16px;">
        ${renderCategorySection('✅ Progress', categorized.progress)}
        ${renderCategorySection('💡 Decisions', categorized.decision)}
        ${renderCategorySection('⚠️ Blockers', categorized.blocker)}
        ${renderCategorySection('➡️ Next Steps', categorized.next_step)}
        ${renderCategorySection('📎 Uncategorized', categorized.uncategorized)}
      </div>
    `}
    
    <button class="btn btn-primary" id="generateSummaryBtn" ${(!State.project.links || State.project.links.length === 0) ? 'disabled' : ''}>
      ✨ Generate Summary
    </button>
    
    <button class="btn btn-secondary" id="resetProjectBtn" style="margin-top: 8px;">
      🔄 Start New Project
    </button>
  `;
  
  attachListeners([
    { id: 'generateSummaryBtn', event: 'click', handler: generateSummary },
    { id: 'resetProjectBtn', event: 'click', handler: resetProject },
    { selector: '[data-action="add-note"]', event: 'click', handler: showAddNoteModal },
    { selector: '[data-action="categorize"]', event: 'click', handler: showCategorizeModal },
    { selector: '[data-action="remove"]', event: 'click', handler: removeLink }
  ]);
  
  // Note removal buttons
  document.querySelectorAll('[data-action="remove-note"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const linkIndex = parseInt(btn.dataset.linkIndex);
      const noteIndex = parseInt(btn.dataset.noteIndex);
      removeNote(linkIndex, noteIndex);
    });
  });
}

function renderCategorySection(title, links) {
  if (links.length === 0) return '';
  
  return `
    <div style="margin-bottom: 24px;">
      <h3 style="font-size: 13px; font-weight: 700; color: #374151; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
        ${title}
      </h3>
      ${links.map(link => `
        <div class="link" style="margin-bottom: 12px; border: 1px solid #e5e7eb;">
          <div style="display: flex; align-items: flex-start; gap: 10px; margin-bottom: ${link.notes && link.notes.length > 0 ? '12px' : '8px'};">
            <span style="font-size: 20px; flex-shrink: 0;">${link.icon}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 500; font-size: 13px; color: #111827; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${sanitizeText(link.title)}
              </div>
              <div style="font-size: 11px; color: #9ca3af;">
                Added ${formatDate(link.addedAt)}
                ${link.lastUpdated ? ` • Updated ${formatDate(link.lastUpdated)}` : ''}
              </div>
            </div>
          </div>
          
          ${link.notes && link.notes.length > 0 ? `
            <div class="link-notes">
              ${link.notes.map((note, noteIndex) => `
                <div class="link-note-item">
                  <div class="link-note-content">
                    <div class="link-note-text">${sanitizeText(note.text)}</div>
                    <div class="link-note-time">${formatDate(note.addedAt)}</div>
                  </div>
                  <button 
                    class="link-note-remove" 
                    data-action="remove-note" 
                    data-link-index="${link.originalIndex}"
                    data-note-index="${noteIndex}"
                    title="Remove note"
                  >×</button>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="link-actions">
            <button class="btn btn-small btn-secondary" data-index="${link.originalIndex}" data-action="add-note">
              + Add Note
            </button>
            <button class="btn btn-small btn-secondary" data-index="${link.originalIndex}" data-action="categorize">
              ${link.category ? '↻ Recategorize' : '🏷️ Categorize'}
            </button>
            <button class="btn btn-small btn-secondary" data-index="${link.originalIndex}" data-action="remove">
              Remove
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
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

function showSummaryView(summary) {
  const root = document.getElementById('root');
  
  root.innerHTML = `
    <div class="header">
      <h1>✨ Your Summary</h1>
      <p>Generated just now</p>
    </div>
    
    <div class="summary">${sanitizeText(summary)}</div>
    
    <button class="btn btn-primary" id="copySummaryBtn">
      📋 Copy to Clipboard
    </button>
    
    <button class="btn btn-secondary" id="backToProjectBtn" style="margin-top: 8px;">
      ← Back to Project
    </button>
  `;
  
  attachListeners([
    { id: 'copySummaryBtn', event: 'click', handler: () => copySummary(summary) },
    { id: 'backToProjectBtn', event: 'click', handler: showProjectView }
  ]);
}

// ==============================================
// ACTIONS
// ==============================================

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
  
  // Check if already in project
  if (State.isPageInProject(State.currentPageInfo)) {
    showToast('⚠️ Page already in project', 'warning');
    return;
  }
  
  if (!State.project.links) {
    State.project.links = [];
  }
  
  State.project.links.push({
    title: sanitizeText(State.currentPageInfo.title),
    url: sanitizeText(State.currentPageInfo.url),
    platform: State.currentPageInfo.platform,
    icon: State.currentPageInfo.icon,
    addedAt: Date.now()
  });
  
  const saved = await State.saveProject();
  if (!saved) return;
  
  // Clear badge
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
  if (!confirm('Start a new project? This will clear your current project.')) {
    return;
  }
  
  // If authenticated, delete from Supabase
  if (State.isAuthenticated && State.project?.id) {
    const response = await supabaseClient.deleteProject(State.project.id);
    if (!response.success) {
      console.warn('[UpdateAI] Failed to delete project from Supabase:', response.error);
    }
  }
  
  // Clear local storage
  State.project = null;
  await chrome.storage.local.remove(['project']);
  
  showToast('✓ Project reset');
  showFirstTimeSetup();
}

async function generateSummary() {
  if (!State.project.links || State.project.links.length === 0) {
    showToast('⚠️ Add some links first', 'warning');
    return;
  }
  
  State.isGenerating = true;
  
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">
        Generating your summary...
      </p>
      <p style="color: #9ca3af; font-size: 12px;" id="loadingMessage">
        Analyzing your links
      </p>
    </div>
  `;
  
  const messages = [
    'Analyzing your links',
    'Understanding context',
    'Crafting your summary',
    'Almost done'
  ];
  
  let messageIndex = 0;
  window.loadingInterval = setInterval(() => {
    messageIndex = (messageIndex + 1) % messages.length;
    const msgEl = document.getElementById('loadingMessage');
    if (msgEl) {
      msgEl.textContent = messages[messageIndex];
    }
  }, TIMINGS.MESSAGE_CYCLE);
  
  try {
    // Categorize links for better summary structure
    const categorized = {
      progress: [],
      decision: [],
      blocker: [],
      next_step: [],
      uncategorized: []
    };
    
    State.project.links.forEach(link => {
      const category = link.category || 'uncategorized';
      if (categorized[category]) {
        categorized[category].push(link);
      } else {
        categorized.uncategorized.push(link);
      }
    });
    
    let summary = `PROJECT UPDATE: ${State.project.name}\n\n`;
    
    // Progress section
    if (categorized.progress.length > 0) {
      summary += '✅ PROGRESS MADE\n';
      categorized.progress.forEach(link => {
        summary += `• ${link.title}\n`;
        if (link.notes && link.notes.length > 0) {
          link.notes.forEach(note => {
            summary += `  - ${note.text}\n`;
          });
        }
      });
      summary += '\n';
    }
    
    // Decisions section
    if (categorized.decision.length > 0) {
      summary += '💡 KEY DECISIONS\n';
      categorized.decision.forEach(link => {
        summary += `• ${link.title}\n`;
        if (link.notes && link.notes.length > 0) {
          link.notes.forEach(note => {
            summary += `  - ${note.text}\n`;
          });
        }
      });
      summary += '\n';
    }
    
    // Blockers section
    if (categorized.blocker.length > 0) {
      summary += '⚠️ BLOCKERS & CHALLENGES\n';
      categorized.blocker.forEach(link => {
        summary += `• ${link.title}\n`;
        if (link.notes && link.notes.length > 0) {
          link.notes.forEach(note => {
            summary += `  - ${note.text}\n`;
          });
        }
      });
      summary += '\n';
    }
    
    // Next steps section
    if (categorized.next_step.length > 0) {
      summary += '➡️ NEXT STEPS\n';
      categorized.next_step.forEach(link => {
        summary += `• ${link.title}\n`;
        if (link.notes && link.notes.length > 0) {
          link.notes.forEach(note => {
            summary += `  - ${note.text}\n`;
          });
        }
      });
      summary += '\n';
    }
    
    // Uncategorized section
    if (categorized.uncategorized.length > 0) {
      summary += '📎 ADDITIONAL CONTEXT\n';
      categorized.uncategorized.forEach(link => {
        summary += `• ${link.title}\n`;
        if (link.notes && link.notes.length > 0) {
          link.notes.forEach(note => {
            summary += `  - ${note.text}\n`;
          });
        }
      });
    }
    
    // Add a helpful tip if there are uncategorized items
    if (categorized.uncategorized.length > 0) {
      summary += '\n💡 Tip: Categorize your links for more structured summaries!';
    }
    
    State.isGenerating = false;
    clearInterval(window.loadingInterval);
    
    showSummaryView(summary);
    
  } catch (error) {
    console.error('[UpdateAI] Summary generation error:', error);
    State.isGenerating = false;
    clearInterval(window.loadingInterval);
    
    showToast('⚠️ Failed to generate summary', 'error');
    showProjectView();
  }
}

async function copySummary(summary) {
  try {
    await navigator.clipboard.writeText(summary);
    showToast('✓ Copied to clipboard!');
  } catch (error) {
    console.error('[UpdateAI] Copy failed:', error);
    showToast('⚠️ Failed to copy', 'error');
  }
}

// ==============================================
// TOAST NOTIFICATIONS
// ==============================================

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
    transition: opacity ${TIMINGS.TOAST_FADE}ms;
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
    setTimeout(() => toast.remove(), TIMINGS.TOAST_FADE);
  }, TIMINGS.TOAST_DURATION);
}
// ============================================
// MODAL: Add Note
// ============================================

function showAddNoteModal(linkIndex) {
  const link = State.project.links[linkIndex];
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'addNoteModal';
  
  // Create modal content
  modal.innerHTML = `
    <div class="modal-content">
      <h2 class="modal-header">Add Note</h2>
      
      <div class="modal-section">
        <div class="modal-link-info">
          <span class="modal-link-icon">${link.icon}</span>
          <div class="modal-link-title">
            ${sanitizeText(link.title)}
          </div>
        </div>
      </div>
      
      <div style="margin-bottom: 16px;">
        <label class="modal-label">
          What happened?
        </label>
        <textarea 
          id="noteInput" 
          class="modal-textarea"
          placeholder="e.g., Completed payment integration, Added checkout flow section, Decided to use Material UI..."
        ></textarea>
        <div class="modal-hint">
          💡 Tip: Write what you'd want to remember on Friday
        </div>
      </div>
      
      <div class="modal-buttons">
        <button class="btn btn-primary" id="saveNoteBtn">
          Save Note
        </button>
        <button class="btn btn-secondary" id="cancelNoteBtn">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Focus textarea after render
  setTimeout(() => {
    const textarea = document.getElementById('noteInput');
    if (textarea) textarea.focus();
  }, 100);
  
  // Save button
  document.getElementById('saveNoteBtn').addEventListener('click', async () => {
    const noteText = document.getElementById('noteInput').value.trim();
    
    if (!noteText) {
      alert('Please enter a note');
      return;
    }
    
    // Add note to link
    if (!State.project.links[linkIndex].notes) {
      State.project.links[linkIndex].notes = [];
    }
    
    State.project.links[linkIndex].notes.push({
      text: noteText,
      addedAt: Date.now()
    });
    
    State.project.links[linkIndex].lastUpdated = Date.now();
    
    const saved = await State.saveProject();
    if (!saved) return;
    
    modal.remove();
    showProjectView();
    showToast('✓ Note added!');
  });
  
  // Cancel button
  document.getElementById('cancelNoteBtn').addEventListener('click', () => {
    modal.remove();
  });
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Keyboard shortcuts
  const textarea = document.getElementById('noteInput');
  textarea.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter to save
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      document.getElementById('saveNoteBtn').click();
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      modal.remove();
    }
  });
}

// ============================================
// ACTION: Remove Note
// ============================================

async function removeNote(linkIndex, noteIndex) {
  if (!confirm('Remove this note?')) return;
  
  State.project.links[linkIndex].notes.splice(noteIndex, 1);
  State.project.links[linkIndex].lastUpdated = Date.now();
  
  const saved = await State.saveProject();
  if (!saved) return;
  
  showProjectView();
  showToast('✓ Note removed');
}
// ============================================
// MODAL: Categorize Link
// ============================================

function showCategorizeModal(linkIndex) {
  const link = State.project.links[linkIndex];
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'categorizeModal';
  
  // Create modal content
  modal.innerHTML = `
    <div class="modal-content">
      <h2 class="modal-header">Categorize for Summary</h2>
      
      <div class="modal-section">
        <div class="modal-link-info">
          <span class="modal-link-icon">${link.icon}</span>
          <div class="modal-link-title">
            ${sanitizeText(link.title)}
          </div>
        </div>
        ${link.notes && link.notes.length > 0 ? `
          <div class="modal-notes-list">
            ${link.notes.map(n => `• ${sanitizeText(n.text)}`).join('<br>')}
          </div>
        ` : ''}
      </div>
      
      <div style="margin-bottom: 16px;">
        <label class="modal-label">
          What type of update is this?
        </label>
        
        <div class="category-options">
          <label class="category-option ${link.category === 'progress' ? 'selected' : ''}" data-category="progress">
            <input type="radio" name="category" value="progress" ${link.category === 'progress' ? 'checked' : ''}>
            <div class="category-option-content">
              <div class="category-option-title">✅ Progress</div>
              <div class="category-option-description">Completed work or achievements</div>
            </div>
          </label>
          
          <label class="category-option ${link.category === 'decision' ? 'selected' : ''}" data-category="decision">
            <input type="radio" name="category" value="decision" ${link.category === 'decision' ? 'checked' : ''}>
            <div class="category-option-content">
              <div class="category-option-title">💡 Decision</div>
              <div class="category-option-description">Important choice or direction</div>
            </div>
          </label>
          
          <label class="category-option ${link.category === 'blocker' ? 'selected' : ''}" data-category="blocker">
            <input type="radio" name="category" value="blocker" ${link.category === 'blocker' ? 'checked' : ''}>
            <div class="category-option-content">
              <div class="category-option-title">⚠️ Blocker</div>
              <div class="category-option-description">Issue or delay preventing progress</div>
            </div>
          </label>
          
          <label class="category-option ${link.category === 'next_step' ? 'selected' : ''}" data-category="next_step">
            <input type="radio" name="category" value="next_step" ${link.category === 'next_step' ? 'checked' : ''}>
            <div class="category-option-content">
              <div class="category-option-title">➡️ Next Step</div>
              <div class="category-option-description">Upcoming work or priority</div>
            </div>
          </label>
        </div>
      </div>
      
      <div class="modal-buttons">
        <button class="btn btn-primary" id="saveCategoryBtn">
          Save
        </button>
        <button class="btn btn-secondary" id="cancelCategoryBtn">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add click handlers for category options
  modal.querySelectorAll('.category-option').forEach(option => {
    option.addEventListener('click', () => {
      // Remove selected class from all
      modal.querySelectorAll('.category-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      // Add to clicked
      option.classList.add('selected');
      // Check radio
      const radio = option.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });
  
  // Save button
  document.getElementById('saveCategoryBtn').addEventListener('click', async () => {
    const selected = modal.querySelector('input[name="category"]:checked');
    
    if (!selected) {
      alert('Please select a category');
      return;
    }
    
    State.project.links[linkIndex].category = selected.value;
    State.project.links[linkIndex].lastUpdated = Date.now();
    
    const saved = await State.saveProject();
    if (!saved) return;
    
    modal.remove();
    showProjectView();
    showToast('✓ Categorized!');
  });
  
  // Cancel button
  document.getElementById('cancelCategoryBtn').addEventListener('click', () => {
    modal.remove();
  });
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Escape to cancel
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', escapeHandler);
    }
  });
}

// ============================================================================
// UPDATEAI WORKSPACE INTEGRATION
// ============================================================================

async function loadCaptures() {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    
    const previewContainer = document.getElementById('captures-preview');
    if (!previewContainer) return;
    
    if (captures.length === 0) {
        previewContainer.innerHTML = `
            <div style="text-align: center; padding: 20px; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                No captures yet.<br>
                <span style="font-size: 11px;">Highlight text on Jira, Docs, or Slack to capture.</span>
            </div>
        `;
        return;
    }
    
    previewContainer.innerHTML = captures.map(capture => {
        let icon = '📄';
        let bgColor = '#f9fafb';
        let borderColor = '#e5e7eb';
        
        if (capture.type === 'jira') { 
            icon = '📋'; 
            bgColor = '#eff6ff'; 
            borderColor = '#dbeafe';
        }
        if (capture.type === 'slack') { 
            icon = '💬'; 
            bgColor = '#faf5ff'; 
            borderColor = '#f3e8ff';
        }
        if (capture.type === 'google-docs') { 
            icon = '📝'; 
            bgColor = '#fef2f2'; 
            borderColor = '#fee2e2';
        }
        
        const date = new Date(capture.timestamp);
        const timeAgo = getTimeAgo(date);
        
        return `
            <div style="background: ${bgColor}; padding: 10px; border-radius: 8px; margin-bottom: 8px; border: 1px solid ${borderColor}; transition: all 0.2s; cursor: default;">
                <div style="display: flex; align-items: start; gap: 10px;">
                    <span style="font-size: 18px; flex-shrink: 0;">${icon}</span>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 12px; font-weight: 600; color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px;">
                            ${capture.source}
                        </div>
                        <div style="font-size: 10px; color: #6b7280;">${timeAgo}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

document.getElementById('openWorkspace')?.addEventListener('click', async () => {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    
    if (captures.length === 0) {
        alert('No captures yet! Highlight text on Jira, Docs, or Slack to capture context.');
        return;
    }
    
    const workspace = {
        id: Date.now().toString(),
        name: "New Workspace",
        status: "draft",
        template: {
            what: "",
            requirements: [],
            design: "",
            constraints: [],
            edgeCases: []
        },
        captures: captures,
        collaborators: [
            { name: "Samyak", initials: "SM", role: "PM", color: "#6366f1" }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    const encoded = btoa(encodeURIComponent(JSON.stringify(workspace)));
    const baseUrl = 'file:///Users/samyak/UpdateAI/app.html';
    const workspaceUrl = `${baseUrl}#${encoded}`;
    
    chrome.tabs.create({ url: workspaceUrl });
});

document.getElementById('clearCaptures')?.addEventListener('click', async () => {
    if (confirm('Clear all captured context?')) {
        await chrome.storage.local.set({ captures: [] });
        chrome.action.setBadgeText({ text: '' });
        loadCaptures();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    loadCaptures();
});

// ============================================================================
// AUTHENTICATION & WORKSPACE INTEGRATION
// ============================================================================

/**
 * Handle logout
 */
async function handleLogout() {
  if (!confirm('Sign out of UpdateAI? Your local data will remain.')) {
    return;
  }
  
  try {
    await chrome.runtime.sendMessage({ type: 'LOGOUT' });
    showToast('✓ Signed out');
    
    // Reload popup
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (error) {
    console.error('[UpdateAI] Logout error:', error);
    showToast('Failed to sign out', 'error');
  }
}

/**
 * Show workspace selector modal
 */
function showWorkspaceSelector(captureId) {
  if (!State.isAuthenticated) {
    showToast('Please sign in to use workspaces', 'warning');
    setTimeout(() => showLoginScreen(), 500);
    return;
  }
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'workspaceModal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2 class="modal-header">Add to Workspace</h2>
      
      <div style="margin-bottom: 16px;">
        <label class="modal-label">Select workspace</label>
        
        ${State.workspaces.length === 0 ? `
          <div style="text-align: center; padding: 20px; color: #6b7280; font-size: 13px;">
            No workspaces yet
          </div>
        ` : `
          <div class="workspace-list">
            ${State.workspaces.map(ws => `
              <label class="workspace-option" data-workspace-id="${ws.id}">
                <input type="radio" name="workspace" value="${ws.id}">
                <div class="workspace-option-content">
                  <div class="workspace-option-title">${sanitizeText(ws.name)}</div>
                  <div class="workspace-option-meta">
                    ${ws.captureCount || 0} captures • ${ws.collaborators?.length || 0} members
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
        `}
      </div>
      
      <div class="modal-buttons">
        <button class="btn btn-primary" id="addToWorkspaceBtn" ${State.workspaces.length === 0 ? 'disabled' : ''}>
          Add to Workspace
        </button>
        <button class="btn btn-secondary" id="createNewWorkspaceBtn">
          Create New
        </button>
        <button class="btn btn-secondary" id="cancelWorkspaceBtn">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add workspace selection handlers
  modal.querySelectorAll('.workspace-option').forEach(option => {
    option.addEventListener('click', () => {
      modal.querySelectorAll('.workspace-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      option.classList.add('selected');
      const radio = option.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });
  
  // Add to workspace button
  document.getElementById('addToWorkspaceBtn')?.addEventListener('click', async () => {
    const selected = modal.querySelector('input[name="workspace"]:checked');
    if (!selected) {
      alert('Please select a workspace');
      return;
    }
    
    const btn = document.getElementById('addToWorkspaceBtn');
    btn.textContent = 'Adding...';
    btn.disabled = true;
    
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'ADD_TO_WORKSPACE',
        workspaceId: selected.value,
        captureId
      });
      
      if (response.success) {
        modal.remove();
        showToast('✓ Added to workspace!');
      } else {
        alert(response.error || 'Failed to add to workspace');
        btn.textContent = 'Add to Workspace';
        btn.disabled = false;
      }
    } catch (error) {
      console.error('[UpdateAI] Add to workspace error:', error);
      alert('Failed to add to workspace');
      btn.textContent = 'Add to Workspace';
      btn.disabled = false;
    }
  });
  
  // Create new workspace button
  document.getElementById('createNewWorkspaceBtn')?.addEventListener('click', () => {
    modal.remove();
    showCreateWorkspaceModal(captureId);
  });
  
  // Cancel button
  document.getElementById('cancelWorkspaceBtn')?.addEventListener('click', () => {
    modal.remove();
  });
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

/**
 * Show create workspace modal
 */
function showCreateWorkspaceModal(captureId) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'createWorkspaceModal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2 class="modal-header">Create Workspace</h2>
      
      <div class="form-group">
        <label for="workspaceName">Workspace Name</label>
        <input 
          type="text" 
          id="workspaceName" 
          placeholder="e.g., Q1 Product Launch"
        />
      </div>
      
      <div class="form-group">
        <label for="workspaceDescription">Description (optional)</label>
        <textarea 
          id="workspaceDescription" 
          placeholder="What's this workspace for?"
          rows="3"
        ></textarea>
      </div>
      
      <div class="modal-buttons">
        <button class="btn btn-primary" id="createWorkspaceBtn">
          Create & Open
        </button>
        <button class="btn btn-secondary" id="cancelCreateBtn">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Focus name input
  setTimeout(() => {
    document.getElementById('workspaceName')?.focus();
  }, 100);
  
  // Create button
  document.getElementById('createWorkspaceBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('workspaceName')?.value.trim();
    const description = document.getElementById('workspaceDescription')?.value.trim();
    
    if (!name) {
      alert('Please enter a workspace name');
      return;
    }
    
    const btn = document.getElementById('createWorkspaceBtn');
    btn.textContent = 'Creating...';
    btn.disabled = true;
    
    try {
      // Get captures to include
      const result = await chrome.storage.local.get(['captures']);
      const captures = result.captures || [];
      
      const workspaceData = {
        name,
        description,
        captures: captureId ? [captureId] : [],
        createdAt: Date.now()
      };
      
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_WORKSPACE',
        data: workspaceData
      });
      
      if (response.success) {
        modal.remove();
        showToast('✓ Workspace created!');
        
        // Open workspace in new tab
        openWorkspace(response.workspace);
      } else {
        alert(response.error || 'Failed to create workspace');
        btn.textContent = 'Create & Open';
        btn.disabled = false;
      }
    } catch (error) {
      console.error('[UpdateAI] Create workspace error:', error);
      alert('Failed to create workspace');
      btn.textContent = 'Create & Open';
      btn.disabled = false;
    }
  });
  
  // Cancel button
  document.getElementById('cancelCreateBtn')?.addEventListener('click', () => {
    modal.remove();
  });
  
  // Close on background click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Enter to create
  document.getElementById('workspaceName')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('createWorkspaceBtn')?.click();
    }
  });
}

/**
 * Open workspace in new tab
 */
async function openWorkspace(workspace) {
  try {
    // Get auth token to pass to workspace
    const result = await chrome.storage.local.get(['authToken']);
    
    const workspaceUrl = workspace.url || 
      `https://workspace.updateai.app/${workspace.id}?token=${result.authToken}`;
    
    chrome.tabs.create({ url: workspaceUrl });
  } catch (error) {
    console.error('[UpdateAI] Open workspace error:', error);
    showToast('Failed to open workspace', 'error');
  }
}

/**
 * Enhanced open workspace button (original functionality)
 */
const originalOpenWorkspace = document.getElementById('openWorkspace');
if (originalOpenWorkspace) {
  originalOpenWorkspace.addEventListener('click', async () => {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    
    if (captures.length === 0) {
      alert('No captures yet! Highlight text on Jira, Docs, or Slack to capture context.');
      return;
    }
    
    // If authenticated, create workspace via API
    if (State.isAuthenticated) {
      showCreateWorkspaceModal();
    } else {
      // Fallback to local workspace
      const workspace = {
        id: Date.now().toString(),
        name: "New Workspace",
        status: "draft",
        template: {
          what: "",
          requirements: [],
          design: "",
          constraints: [],
          edgeCases: []
        },
        captures: captures,
        collaborators: [
          { name: "You", initials: "ME", role: "Owner", color: "#6366f1" }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      const encoded = btoa(encodeURIComponent(JSON.stringify(workspace)));
      const baseUrl = 'file:///Users/samyak/UpdateAI/app.html';
      const workspaceUrl = `${baseUrl}#${encoded}`;
      
      chrome.tabs.create({ url: workspaceUrl });
    }
  });
}

/**
 * Show sign in prompt (legacy - kept for compatibility)
 */
function showSignInPrompt() {
  showSignInPromptInline();
}

/**
 * Show inline sign-in prompt
 */
function showSignInPromptInline() {
  // Don't show if already visible
  if (document.getElementById('signInPromptInline')) {
    return;
  }
  
  const prompt = document.createElement('div');
  prompt.id = 'signInPromptInline';
  prompt.style.cssText = `
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 16px;
    cursor: pointer;
    transition: transform 0.2s;
  `;
  
  prompt.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 6px; font-size: 15px;">
      🌟 Sign in to sync everywhere
    </div>
    <div style="font-size: 13px; opacity: 0.95;">
      Access your captures across all devices • Collaborate with your team
    </div>
  `;
  
  prompt.addEventListener('mouseover', () => {
    prompt.style.transform = 'scale(1.02)';
  });
  
  prompt.addEventListener('mouseout', () => {
    prompt.style.transform = 'scale(1)';
  });
  
  prompt.addEventListener('click', () => {
    showLoginScreen();
  });
  
  const root = document.getElementById('root');
  const firstCard = root.querySelector('.card') || root.querySelector('.header')?.nextElementSibling;
  if (firstCard) {
    root.insertBefore(prompt, firstCard);
  } else {
    root.insertBefore(prompt, root.firstChild);
  }
}

// ============================================================================
// EXPORT TO AI FUNCTIONALITY
// ============================================================================

/**
 * Export button handler
 */
document.getElementById('exportPrompt')?.addEventListener('click', async () => {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    
    if (captures.length === 0 && !State.project) {
        alert('No content to export! Capture some context or add project links first.');
        return;
    }
    
    // Show export modal
    if (typeof showExportModal === 'function') {
        showExportModal();
    } else {
        console.error('Export modal not available');
        // Fallback: simple copy to clipboard
        const simplePrompt = await generateSimplePrompt();
        try {
            await navigator.clipboard.writeText(simplePrompt);
            showToast('✓ Prompt copied to clipboard!');
        } catch (error) {
            showToast('⚠️ Failed to copy', 'error');
        }
    }
});

/**
 * Simple prompt generator (fallback when export modal isn't available)
 */
async function generateSimplePrompt() {
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    const { project = null } = await chrome.storage.local.get(['project']);
    const { workspace = null } = await chrome.storage.local.get(['workspace']);
    
    let prompt = '# Task Context\n\n';
    
    if (workspace && workspace.template.what) {
        prompt += `## Objective\n${workspace.template.what}\n\n`;
    }
    
    if (workspace && workspace.template.requirements && workspace.template.requirements.length > 0) {
        prompt += '## Requirements\n';
        workspace.template.requirements.forEach((req, i) => {
            prompt += `${i + 1}. ${req}\n`;
        });
        prompt += '\n';
    }
    
    if (captures.length > 0) {
        prompt += `## Captured Context (${captures.length} items)\n\n`;
        captures.forEach((capture, i) => {
            prompt += `### ${capture.source}\n`;
            prompt += `Source: ${capture.type}\n`;
            prompt += `Content:\n\`\`\`\n${capture.content}\n\`\`\`\n\n`;
        });
    }
    
    if (project && project.links && project.links.length > 0) {
        prompt += '## Project Links\n\n';
        project.links.forEach(link => {
            prompt += `- ${link.title}\n`;
            if (link.notes && link.notes.length > 0) {
                link.notes.forEach(note => {
                    prompt += `  - ${note.text}\n`;
                });
            }
        });
    }
    
    return prompt;
}

/**
 * Update export button state based on content availability
 */
async function updateExportButtonState() {
    const exportBtn = document.getElementById('exportPrompt');
    if (!exportBtn) return;
    
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    const hasProject = State.project && State.project.links && State.project.links.length > 0;
    
    if (captures.length === 0 && !hasProject) {
        exportBtn.disabled = true;
        exportBtn.title = 'Capture some context first';
    } else {
        exportBtn.disabled = false;
        exportBtn.title = 'Export your context to AI models';
    }
}

// Update export button when captures change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.captures || changes.project)) {
        updateExportButtonState();
    }
});

// Initialize export button state
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        updateExportButtonState();
    }, 500);
});

console.log('UpdateAI: Popup integration loaded');
