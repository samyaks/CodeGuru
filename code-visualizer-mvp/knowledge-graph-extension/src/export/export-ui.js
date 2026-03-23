// Export UI Modal - handles the export interface

/**
 * Show export modal with options
 */
async function showExportModal() {
  // Import necessary classes (in real implementation, these would be bundled)
  // For now, we'll use dynamic imports
  
  const modal = document.createElement('div');
  modal.className = 'export-modal-overlay';
  modal.id = 'exportModal';
  
  // Get quality analysis first
  const analysis = await getQualityAnalysis();
  
  modal.innerHTML = `
    <div class="export-modal-content">
      <div class="export-modal-header">
        <h2>🚀 Export to AI</h2>
        <button class="export-modal-close" id="closeExportModal">&times;</button>
      </div>
      
      <!-- Quality Score Section -->
      <div class="export-quality-section">
        <div class="export-quality-header">
          <span class="export-quality-label">Prompt Quality</span>
          <span class="export-quality-score" style="color: ${getScoreColor(analysis.score)}">
            ${analysis.score.toFixed(1)}/10
          </span>
        </div>
        <div class="export-quality-bar">
          <div class="export-quality-fill" style="width: ${analysis.score * 10}%; background: ${getScoreColor(analysis.score)}"></div>
        </div>
        <div class="export-quality-label-text">${getScoreLabel(analysis.score)}</div>
        
        ${analysis.issues.length > 0 ? `
          <div class="export-quality-issues">
            <div class="export-quality-issues-header">⚠️ Issues to Fix:</div>
            ${analysis.issues.slice(0, 3).map(issue => `
              <div class="export-quality-issue ${issue.severity}">
                <div class="export-quality-issue-message">${issue.message}</div>
                ${issue.suggestion ? `<div class="export-quality-issue-suggestion">💡 ${issue.suggestion}</div>` : ''}
              </div>
            `).join('')}
            ${analysis.issues.length > 3 ? `
              <div class="export-quality-more">+ ${analysis.issues.length - 3} more issues</div>
            ` : ''}
          </div>
        ` : ''}
        
        ${analysis.strengths.length > 0 ? `
          <div class="export-quality-strengths">
            ${analysis.strengths.map(strength => `
              <div class="export-quality-strength">✓ ${strength}</div>
            `).join('')}
          </div>
        ` : ''}
      </div>
      
      <!-- AI Model Selection -->
      <div class="export-section">
        <label class="export-label">Choose AI Model</label>
        <div class="export-model-grid">
          <div class="export-model-card" data-model="claude-3.5-sonnet">
            <div class="export-model-icon">🤖</div>
            <div class="export-model-name">Claude 3.5 Sonnet</div>
            <div class="export-model-desc">Best for complex reasoning</div>
            <div class="export-model-badge">Recommended</div>
          </div>
          
          <div class="export-model-card" data-model="gpt-4">
            <div class="export-model-icon">💬</div>
            <div class="export-model-name">GPT-4</div>
            <div class="export-model-desc">Excellent all-rounder</div>
          </div>
          
          <div class="export-model-card" data-model="gemini-1.5-pro">
            <div class="export-model-icon">✨</div>
            <div class="export-model-name">Gemini 1.5 Pro</div>
            <div class="export-model-desc">Great for long context</div>
          </div>
          
          <div class="export-model-card" data-model="cursor-ai">
            <div class="export-model-icon">⚡</div>
            <div class="export-model-name">Cursor AI</div>
            <div class="export-model-desc">Optimized for Cursor</div>
          </div>
        </div>
      </div>
      
      <!-- Template Selection (Optional) -->
      <div class="export-section">
        <label class="export-label">Template (Optional)</label>
        <select class="export-select" id="templateSelect">
          <option value="">None - Use current workspace</option>
          <option value="feature-implementation">Feature Implementation</option>
          <option value="bug-fix">Bug Fix</option>
          <option value="api-integration">API Integration</option>
          <option value="code-refactor">Code Refactor</option>
          <option value="architecture-design">Architecture Design</option>
        </select>
      </div>
      
      <!-- Export Options -->
      <div class="export-section">
        <label class="export-label">Export Options</label>
        <div class="export-checkbox-group">
          <label class="export-checkbox">
            <input type="checkbox" id="includeMetadata" checked>
            <span>Include metadata & timestamps</span>
          </label>
        </div>
      </div>
      
      <!-- Action Buttons -->
      <div class="export-actions">
        <button class="export-btn export-btn-primary" id="exportCopyBtn" disabled>
          📋 Copy to Clipboard
        </button>
        <button class="export-btn export-btn-secondary" id="exportDownloadBtn" disabled>
          💾 Download as Markdown
        </button>
        <button class="export-btn export-btn-secondary" id="exportShareBtn" disabled>
          🔗 Generate Shareable Link
        </button>
        ${isInCursor() ? `
          <button class="export-btn export-btn-accent" id="exportCursorBtn" disabled>
            ⚡ Open in Cursor
          </button>
        ` : ''}
      </div>
      
      <!-- Preview Section -->
      <div class="export-section export-preview-section" style="display: none;" id="exportPreviewSection">
        <div class="export-preview-header">
          <span class="export-label">Preview</span>
          <button class="export-preview-toggle" id="togglePreview">Show</button>
        </div>
        <div class="export-preview" id="exportPreview" style="display: none;"></div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Initialize modal behavior
  initializeExportModal(analysis);
}

/**
 * Initialize export modal interactions
 */
function initializeExportModal(analysis) {
  let selectedModel = null;
  let generatedPrompt = null;
  
  // Model selection
  document.querySelectorAll('.export-model-card').forEach(card => {
    card.addEventListener('click', async () => {
      // Deselect all
      document.querySelectorAll('.export-model-card').forEach(c => c.classList.remove('selected'));
      
      // Select clicked
      card.classList.add('selected');
      selectedModel = card.dataset.model;
      
      // Enable export buttons
      document.querySelectorAll('.export-btn').forEach(btn => btn.disabled = false);
      
      // Generate preview
      await generatePromptPreview(selectedModel);
    });
  });
  
  // Close modal
  document.getElementById('closeExportModal').addEventListener('click', () => {
    document.getElementById('exportModal').remove();
  });
  
  // Close on background click
  document.getElementById('exportModal').addEventListener('click', (e) => {
    if (e.target.id === 'exportModal') {
      document.getElementById('exportModal').remove();
    }
  });
  
  // Copy to clipboard
  document.getElementById('exportCopyBtn').addEventListener('click', async () => {
    if (!selectedModel) return;
    
    const prompt = await generatePrompt(selectedModel);
    const success = await copyToClipboard(prompt);
    
    if (success) {
      showExportToast('✓ Copied to clipboard!');
      // Close modal after brief delay
      setTimeout(() => {
        document.getElementById('exportModal')?.remove();
      }, 1000);
    } else {
      showExportToast('Failed to copy', 'error');
    }
  });
  
  // Download as markdown
  document.getElementById('exportDownloadBtn').addEventListener('click', async () => {
    if (!selectedModel) return;
    
    const prompt = await generatePrompt(selectedModel);
    const success = await downloadAsMarkdown(prompt, `prompt-${selectedModel}-${Date.now()}.md`);
    
    if (success) {
      showExportToast('✓ Downloaded!');
    } else {
      showExportToast('Failed to download', 'error');
    }
  });
  
  // Generate shareable link
  document.getElementById('exportShareBtn').addEventListener('click', async () => {
    try {
      const link = await generateShareableLink();
      await copyToClipboard(link);
      showExportToast('✓ Shareable link copied!');
    } catch (error) {
      showExportToast('Failed to generate link', 'error');
    }
  });
  
  // Open in Cursor
  const cursorBtn = document.getElementById('exportCursorBtn');
  if (cursorBtn) {
    cursorBtn.addEventListener('click', async () => {
      if (!selectedModel) return;
      
      const prompt = await generatePrompt(selectedModel);
      const success = await openInCursor(prompt);
      
      if (success) {
        showExportToast('✓ Opened in Cursor!');
      } else {
        showExportToast('Failed to open Cursor', 'error');
      }
    });
  }
  
  // Preview toggle
  document.getElementById('togglePreview')?.addEventListener('click', () => {
    const preview = document.getElementById('exportPreview');
    const toggle = document.getElementById('togglePreview');
    
    if (preview.style.display === 'none') {
      preview.style.display = 'block';
      toggle.textContent = 'Hide';
    } else {
      preview.style.display = 'none';
      toggle.textContent = 'Show';
    }
  });
}

/**
 * Generate prompt for selected model
 */
async function generatePrompt(model) {
  // This would call the actual ExportManager in production
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const { project = null } = await chrome.storage.local.get(['project']);
  const { workspace = null } = await chrome.storage.local.get(['workspace']);
  
  const templateId = document.getElementById('templateSelect')?.value;
  const includeMetadata = document.getElementById('includeMetadata')?.checked;
  
  // In production, this would use the actual PromptFormatter
  // For now, return a mock prompt
  return `Generated prompt for ${model} model with ${captures.length} captures`;
}

/**
 * Generate prompt preview
 */
async function generatePromptPreview(model) {
  const previewSection = document.getElementById('exportPreviewSection');
  const preview = document.getElementById('exportPreview');
  
  if (!previewSection || !preview) return;
  
  previewSection.style.display = 'block';
  
  const prompt = await generatePrompt(model);
  
  // Show preview (first 500 chars)
  const previewText = prompt.length > 500 
    ? prompt.substring(0, 500) + '...' 
    : prompt;
  
  preview.innerHTML = `
    <pre style="white-space: pre-wrap; font-size: 12px; line-height: 1.5;">${escapeHtml(previewText)}</pre>
    <div style="margin-top: 8px; font-size: 11px; color: #6b7280;">
      Full prompt length: ${prompt.length} characters
    </div>
  `;
}

/**
 * Helper: Get quality analysis
 */
async function getQualityAnalysis() {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const { project = null } = await chrome.storage.local.get(['project']);
  const { workspace = null } = await chrome.storage.local.get(['workspace']);
  
  // Mock analysis for demo
  // In production, this would use PromptQualityAnalyzer
  return {
    score: 7.5,
    issues: [
      {
        severity: 'warning',
        category: 'completeness',
        message: 'No edge cases specified',
        suggestion: 'Add edge cases to improve output quality'
      }
    ],
    suggestions: ['Good prompt! Minor improvements could make it better'],
    strengths: ['Clear objective', '5 captures included']
  };
}

/**
 * Helper: Get score label
 */
function getScoreLabel(score) {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Fair';
  if (score >= 3) return 'Poor';
  return 'Needs Work';
}

/**
 * Helper: Get score color
 */
function getScoreColor(score) {
  if (score >= 9) return '#10b981';
  if (score >= 7) return '#3b82f6';
  if (score >= 5) return '#f59e0b';
  return '#ef4444';
}

/**
 * Helper: Copy to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    return false;
  }
}

/**
 * Helper: Download as markdown
 */
async function downloadAsMarkdown(content, filename) {
  try {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.error('Download failed:', error);
    return false;
  }
}

/**
 * Helper: Generate shareable link
 */
async function generateShareableLink() {
  const { captures = [] } = await chrome.storage.local.get(['captures']);
  const { project = null } = await chrome.storage.local.get(['project']);
  const { workspace = null } = await chrome.storage.local.get(['workspace']);
  
  const data = { workspace, project, captures, timestamp: Date.now() };
  const encoded = btoa(encodeURIComponent(JSON.stringify(data)));
  
  return `https://updateai.app/import#${encoded}`;
}

/**
 * Helper: Open in Cursor
 */
async function openInCursor(prompt) {
  try {
    // Copy to clipboard as fallback
    await copyToClipboard(prompt);
    
    // Try Cursor URL scheme
    const cursorUrl = `cursor://prompt?content=${encodeURIComponent(prompt)}`;
    window.open(cursorUrl, '_blank');
    
    return true;
  } catch (error) {
    console.error('Cursor open failed:', error);
    return false;
  }
}

/**
 * Helper: Check if in Cursor
 */
function isInCursor() {
  // Check if running in Cursor IDE
  return false; // Would implement proper detection
}

/**
 * Helper: Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Helper: Show toast notification
 */
function showExportToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = 'export-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'error' ? '#ef4444' : '#10b981'};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 100000;
    opacity: 0;
    transition: opacity 300ms;
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}
