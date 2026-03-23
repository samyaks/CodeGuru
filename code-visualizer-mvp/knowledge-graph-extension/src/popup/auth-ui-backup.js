// src/popup/auth-ui.js
// Authentication UI components

/**
 * Show login screen
 */
export function showLoginScreen() {
  const root = document.getElementById('root');
  
  root.innerHTML = `
    <div class="auth-container">
      <div class="auth-header">
        <div style="font-size: 48px; margin-bottom: 16px;">🚀</div>
        <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 8px;">
          Welcome to UpdateAI
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin-bottom: 24px;">
          Sign in to sync your captures across devices
        </p>
      </div>
      
      <div class="card">
        <div class="form-group">
          <label for="emailInput">Email Address</label>
          <input 
            type="email" 
            id="emailInput" 
            placeholder="you@company.com"
            autocomplete="email"
          />
        </div>
        
        <button class="btn btn-primary" id="sendMagicLinkBtn">
          ✨ Send Magic Link
        </button>
        
        <div id="authMessage" class="auth-message" style="display: none;"></div>
      </div>
      
      <div style="text-align: center; margin-top: 16px; font-size: 13px; color: #9ca3af;">
        <p>No password needed! We'll send you a magic link.</p>
      </div>
      
      <div style="text-align: center; margin-top: 24px;">
        <button class="btn btn-secondary" id="continueOfflineBtn">
          Continue Offline
        </button>
      </div>
    </div>
  `;
  
  // Focus email input
  setTimeout(() => {
    document.getElementById('emailInput')?.focus();
  }, 100);
  
  // Send magic link button
  document.getElementById('sendMagicLinkBtn')?.addEventListener('click', handleSendMagicLink);
  
  // Continue offline button
  document.getElementById('continueOfflineBtn')?.addEventListener('click', () => {
    window.location.reload();
  });
  
  // Enter key to submit
  document.getElementById('emailInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSendMagicLink();
    }
  });
}

/**
 * Show waiting for magic link screen
 */
export function showMagicLinkSent(email) {
  const root = document.getElementById('root');
  
  root.innerHTML = `
    <div class="auth-container">
      <div class="auth-header">
        <div style="font-size: 48px; margin-bottom: 16px;">📧</div>
        <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 8px;">
          Check Your Email
        </h1>
        <p style="font-size: 14px; color: #6b7280; margin-bottom: 24px;">
          We sent a magic link to<br><strong>${sanitizeText(email)}</strong>
        </p>
      </div>
      
      <div class="card" style="background: #f0fdf4; border: 2px solid #10b981;">
        <div style="text-align: center; padding: 16px;">
          <div style="font-size: 14px; color: #166534; margin-bottom: 12px;">
            <strong>Click the link in your email to sign in</strong>
          </div>
          <div style="font-size: 12px; color: #166534;">
            The link will open your browser and automatically sign you in.
          </div>
        </div>
      </div>
      
      <div style="text-align: center; margin-top: 24px;">
        <button class="btn btn-secondary" id="backToLoginBtn">
          ← Try Different Email
        </button>
      </div>
      
      <div style="text-align: center; margin-top: 16px; font-size: 12px; color: #9ca3af;">
        <p>Didn't receive it? Check your spam folder or try again.</p>
      </div>
    </div>
  `;
  
  document.getElementById('backToLoginBtn')?.addEventListener('click', showLoginScreen);
  
  // Poll for auth token (in case user clicks link)
  startAuthPolling();
}

/**
 * Show user profile with logout option
 */
export function showUserProfile(user, onLogout) {
  const profileHtml = `
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 16px;">
      <div style="width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 16px;">
        ${getInitials(user.name || user.email)}
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; font-size: 14px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${sanitizeText(user.name || user.email)}
        </div>
        <div style="font-size: 12px; color: #6b7280;">
          ${sanitizeText(user.email)}
        </div>
      </div>
      <button id="logoutBtn" class="btn btn-small btn-secondary" style="flex-shrink: 0;">
        Logout
      </button>
    </div>
  `;
  
  // Insert at top of root
  const root = document.getElementById('root');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = profileHtml;
  root.insertBefore(tempDiv.firstElementChild, root.firstChild);
  
  document.getElementById('logoutBtn')?.addEventListener('click', onLogout);
}

/**
 * Show sync status indicator with enhanced details
 */
export function showSyncStatus(status) {
  const existingStatus = document.getElementById('syncStatus');
  if (existingStatus) {
    existingStatus.remove();
  }
  
  let icon, text, color, bgColor, detailsText = '';
  
  if (!status.isAuthenticated) {
    icon = '🔓';
    text = 'Not signed in';
    color = '#6b7280';
    bgColor = '#f3f4f6';
    detailsText = 'Sign in to sync across devices';
  } else if (!status.isOnline) {
    icon = '📴';
    const offlineDuration = status.lastOfflineTime ? Date.now() - status.lastOfflineTime : 0;
    const minutes = Math.floor(offlineDuration / 60000);
    text = minutes > 0 ? `Offline (${minutes}m)` : 'Offline';
    color = '#6b7280';
    bgColor = '#f3f4f6';
    if (status.pending > 0) {
      detailsText = `${status.pending} change${status.pending > 1 ? 's' : ''} pending`;
    } else {
      detailsText = 'Changes will sync when back online';
    }
  } else if (status.isSyncing) {
    icon = '🔄';
    text = 'Syncing...';
    color = '#3b82f6';
    bgColor = '#eff6ff';
    if (status.pending > 0) {
      detailsText = `${status.pending} item${status.pending > 1 ? 's' : ''} remaining`;
    }
  } else if (status.conflicts && status.conflicts > 0) {
    icon = '⚠️';
    text = `${status.conflicts} conflict${status.conflicts > 1 ? 's' : ''}`;
    color = '#ef4444';
    bgColor = '#fee2e2';
    detailsText = 'Manual resolution needed';
  } else if (status.pending > 0) {
    icon = '⏳';
    text = `${status.pending} pending`;
    color = '#f59e0b';
    bgColor = '#fef3c7';
    if (status.nextRetryTime) {
      const retryIn = Math.max(0, Math.ceil((status.nextRetryTime - Date.now()) / 1000));
      detailsText = retryIn > 0 ? `Retrying in ${retryIn}s` : 'Retrying now...';
    } else {
      detailsText = 'Waiting to sync';
    }
  } else if (status.lastSyncSuccess) {
    icon = '✓';
    const lastSync = Date.now() - status.lastSyncSuccess;
    const minutes = Math.floor(lastSync / 60000);
    text = minutes > 0 ? `Synced ${minutes}m ago` : 'Just synced';
    color = '#10b981';
    bgColor = '#f0fdf4';
    detailsText = `${status.total} item${status.total !== 1 ? 's' : ''} synced`;
  } else {
    icon = '✓';
    text = 'All synced';
    color = '#10b981';
    bgColor = '#f0fdf4';
    detailsText = status.total > 0 ? `${status.total} item${status.total !== 1 ? 's' : ''}` : 'No items yet';
  }
  
  const statusHtml = `
    <div id="syncStatus" style="display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: ${bgColor}; border-radius: 6px; margin-bottom: 16px; border: 1px solid ${color}20;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">${icon}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 600; color: ${color};">
            ${text}
          </div>
          ${detailsText ? `
            <div style="font-size: 11px; color: ${color}; opacity: 0.8; margin-top: 2px;">
              ${detailsText}
            </div>
          ` : ''}
        </div>
        ${status.isAuthenticated && (status.pending > 0 || status.conflicts > 0) ? `
          <button id="syncNowBtn" class="btn btn-small btn-secondary" style="padding: 4px 10px; font-size: 11px; flex-shrink: 0;">
            ${status.conflicts > 0 ? 'Resolve' : 'Sync Now'}
          </button>
        ` : ''}
      </div>
      ${status.isAuthenticated && status.status ? `
        <div style="font-size: 10px; color: ${color}; opacity: 0.6; margin-top: 4px; padding-top: 4px; border-top: 1px solid ${color}20;">
          Status: ${formatStatusString(status.status)} • Total: ${status.total} • Synced: ${status.synced} • Local: ${status.localOnly}
        </div>
      ` : ''}
    </div>
  `;
  
  const root = document.getElementById('root');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = statusHtml;
  
  // Insert after user profile or at top
  const userProfile = root.querySelector('[id^="logout"]')?.closest('div');
  if (userProfile) {
    userProfile.parentNode.insertBefore(tempDiv.firstElementChild, userProfile.nextSibling);
  } else {
    root.insertBefore(tempDiv.firstElementChild, root.firstChild);
  }
  
  // Add sync now button handler
  document.getElementById('syncNowBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('syncNowBtn');
    const originalText = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    
    try {
      if (status.conflicts > 0) {
        // Show conflicts modal
        await showConflictsModal();
      } else {
        // Force sync
        await chrome.runtime.sendMessage({ type: 'FORCE_SYNC' });
        
        // Refresh status after 2 seconds
        setTimeout(async () => {
          const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
          if (response.success) {
            showSyncStatus(response.status);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Sync action error:', error);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
}

/**
 * Format status string for display
 */
function formatStatusString(status) {
  const statusMap = {
    'synced': 'All Synced',
    'syncing': 'Syncing',
    'offline': 'Offline',
    'has_conflicts': 'Has Conflicts',
    'not_authenticated': 'Not Signed In'
  };
  return statusMap[status] || status;
}

/**
 * Show conflicts resolution modal
 */
async function showConflictsModal() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_CONFLICTS' });
    
    if (!response.success || !response.conflicts || response.conflicts.length === 0) {
      alert('No conflicts found');
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'conflictsModal';
    
    modal.innerHTML = `
      <div class="modal-content">
        <h2 class="modal-header">Resolve Sync Conflicts</h2>
        
        <div style="margin-bottom: 16px; padding: 12px; background: #fef3c7; border-radius: 6px; font-size: 13px; color: #92400e;">
          ⚠️ ${response.conflicts.length} conflict${response.conflicts.length > 1 ? 's' : ''} detected. Choose which version to keep for each item.
        </div>
        
        <div style="max-height: 400px; overflow-y: auto; margin-bottom: 16px;">
          ${response.conflicts.map((conflict, index) => `
            <div class="conflict-item" data-index="${index}" style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 12px;">
              <div style="font-weight: 600; font-size: 14px; color: #111827; margin-bottom: 8px;">
                Conflict #${index + 1}
              </div>
              <div style="font-size: 12px; color: #6b7280; margin-bottom: 12px;">
                ${conflict.resolution === 'last_write_wins_local' ? 'Local version is newer' : 'Server version is newer'}
              </div>
              <div class="conflict-actions" style="display: flex; gap: 8px;">
                <button class="btn btn-small btn-primary resolve-conflict" data-index="${index}" data-resolution="use_local">
                  Use Local
                </button>
                <button class="btn btn-small btn-secondary resolve-conflict" data-index="${index}" data-resolution="use_server">
                  Use Server
                </button>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="modal-buttons">
          <button class="btn btn-secondary" id="closeConflictsBtn">
            Close
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle resolve buttons
    modal.querySelectorAll('.resolve-conflict').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.index);
        const resolution = btn.dataset.resolution;
        
        btn.textContent = 'Resolving...';
        btn.disabled = true;
        
        try {
          const resolveResponse = await chrome.runtime.sendMessage({
            type: 'RESOLVE_CONFLICT',
            conflictId: index,
            resolution
          });
          
          if (resolveResponse.success) {
            // Remove conflict from UI
            const conflictItem = modal.querySelector(`[data-index="${index}"]`);
            if (conflictItem) {
              conflictItem.remove();
            }
            
            // Close modal if all resolved
            const remainingConflicts = modal.querySelectorAll('.conflict-item');
            if (remainingConflicts.length === 0) {
              modal.remove();
              
              // Refresh sync status
              const statusResponse = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' });
              if (statusResponse.success) {
                showSyncStatus(statusResponse.status);
              }
            }
          } else {
            alert('Failed to resolve conflict: ' + resolveResponse.error);
            btn.textContent = resolution === 'use_local' ? 'Use Local' : 'Use Server';
            btn.disabled = false;
          }
        } catch (error) {
          console.error('Resolve conflict error:', error);
          alert('Error resolving conflict');
          btn.textContent = resolution === 'use_local' ? 'Use Local' : 'Use Server';
          btn.disabled = false;
        }
      });
    });
    
    // Close button
    document.getElementById('closeConflictsBtn')?.addEventListener('click', () => {
      modal.remove();
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  } catch (error) {
    console.error('Show conflicts modal error:', error);
    alert('Error loading conflicts');
  }
}

/**
 * Handle send magic link
 */
async function handleSendMagicLink() {
  const emailInput = document.getElementById('emailInput');
  const email = emailInput?.value.trim();
  
  if (!email) {
    showAuthMessage('Please enter your email', 'error');
    emailInput?.focus();
    return;
  }
  
  if (!isValidEmail(email)) {
    showAuthMessage('Please enter a valid email', 'error');
    emailInput?.focus();
    return;
  }
  
  const btn = document.getElementById('sendMagicLinkBtn');
  const originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;
  
  try {
    // Send request to service worker to handle Supabase magic link
    const response = await chrome.runtime.sendMessage({
      type: 'REQUEST_MAGIC_LINK',
      email
    });
    
    if (response.success) {
      // Store email for verification
      await chrome.storage.local.set({ pendingAuthEmail: email });
      showMagicLinkSent(email);
    } else {
      showAuthMessage(response.error || 'Failed to send magic link', 'error');
      btn.textContent = originalText;
      btn.disabled = false;
    }
  } catch (error) {
    console.error('[Auth] Magic link error:', error);
    showAuthMessage('Something went wrong. Please try again.', 'error');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/**
 * Show auth message
 */
function showAuthMessage(message, type = 'info') {
  const messageEl = document.getElementById('authMessage');
  if (!messageEl) return;
  
  const colors = {
    info: { bg: '#eff6ff', text: '#1e40af', border: '#3b82f6' },
    error: { bg: '#fef2f2', text: '#991b1b', border: '#ef4444' },
    success: { bg: '#f0fdf4', text: '#166534', border: '#10b981' }
  };
  
  const color = colors[type] || colors.info;
  
  messageEl.style.cssText = `
    display: block;
    margin-top: 12px;
    padding: 12px;
    background: ${color.bg};
    border: 1px solid ${color.border};
    border-radius: 6px;
    color: ${color.text};
    font-size: 13px;
    text-align: center;
  `;
  
  messageEl.textContent = message;
}

/**
 * Poll for auth token (when user clicks magic link)
 */
let authPollingInterval;

function startAuthPolling() {
  // Clear existing interval
  if (authPollingInterval) {
    clearInterval(authPollingInterval);
  }
  
  // Poll every 2 seconds for 5 minutes
  let attempts = 0;
  authPollingInterval = setInterval(async () => {
    attempts++;
    
    if (attempts > 150) { // 5 minutes
      clearInterval(authPollingInterval);
      return;
    }
    
    // Check if user is now authenticated via Supabase
    const result = await chrome.storage.local.get(['supabase.auth.token', 'user']);
    
    if (result['supabase.auth.token'] && result.user) {
      clearInterval(authPollingInterval);
      // Reload popup to show authenticated state
      window.location.reload();
    }
  }, 2000);
}

/**
 * Handle magic link callback (when user clicks link in email)
 * This is called when the extension detects a magic link token in the URL
 */
export async function handleMagicLinkCallback(token, email) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'VERIFY_MAGIC_LINK',
      token,
      email
    });
    
    if (response.success) {
      return { success: true };
    } else {
      return { success: false, error: response.error };
    }
  } catch (error) {
    console.error('[Auth] Magic link callback error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Get initials from name or email
 */
function getInitials(nameOrEmail) {
  if (!nameOrEmail) return '?';
  
  const parts = nameOrEmail.split(/[\s@]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  
  return nameOrEmail.substring(0, 2).toUpperCase();
}

/**
 * Sanitize text for display
 */
function sanitizeText(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * CSS styles for auth UI
 */
export const authStyles = `
  .auth-container {
    padding: 20px 0;
  }
  
  .auth-header {
    text-align: center;
    margin-bottom: 24px;
  }
  
  .auth-message {
    margin-top: 12px;
  }
`;
