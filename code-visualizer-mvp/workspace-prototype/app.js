// UpdateAI Collaborative Workspace Prototype
// Simulates real-time collaboration for demo purposes

// ============================================
// State Management
// ============================================

const state = {
  contextFiles: [],
  yourPrompt: '',
  friendPrompt: '',
  collaborators: [
    { id: 1, name: 'You', initial: 'Y', color: '#ef4444' },
    { id: 2, name: 'Alex', initial: 'A', color: '#3b82f6' }
  ],
  isGenerating: false,
  friendTypingTimeout: null
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupEventListeners();
});

function initializeApp() {
  // Add sample context files
  addSampleContextFiles();
  
  // Update character counts
  updateCharCounts();
  
  // Show welcome toast
  showToast('✨ Workspace ready! Start typing to collaborate.', 'success');
}

function setupEventListeners() {
  // Your prompt input
  const promptInputYours = document.getElementById('promptInputYours');
  promptInputYours.addEventListener('input', handleYourPromptInput);
  
  // Friend's prompt input
  const promptInputFriend = document.getElementById('promptInputFriend');
  promptInputFriend.addEventListener('input', handleFriendPromptInput);
  
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', handleTabClick);
  });
  
  // Generate button
  document.getElementById('generateBtn').addEventListener('click', generateOutputs);
  
  // Add context file button
  document.getElementById('addContextFile').addEventListener('click', () => {
    openModal('contextFileModal');
  });
  
  // Import context button
  document.getElementById('importContext').addEventListener('click', () => {
    showToast('📥 Import from browser extension...', 'info');
  });
  
  // Output tabs
  document.querySelectorAll('.output-tab').forEach(tab => {
    tab.addEventListener('click', handleOutputTabClick);
  });
  
  // Close output panel
  document.getElementById('closeOutput').addEventListener('click', () => {
    document.getElementById('outputPanel').classList.remove('visible');
  });
  
  // Collapse/expand sidebar
  document.getElementById('collapseSidebar').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
}

// ============================================
// Context File Management
// ============================================

function addSampleContextFiles() {
  const samples = [
    {
      name: 'Jira Requirements',
      content: 'PROJ-124: Implement Stripe payment integration\n\nRequirements:\n- Support 3D Secure for EU customers\n- Webhook handling for payment events\n- Error handling and retry logic\n- Test mode support',
      icon: '📋'
    },
    {
      name: 'Slack Discussion',
      content: '#eng-payments conversation:\n\nAlex: "We should use the PaymentIntents API instead of Charges API to future-proof it."\n\nYou: "Agreed. Also need to handle webhook signatures properly."',
      icon: '💬'
    },
    {
      name: 'API Documentation',
      content: 'Stripe PaymentIntents API v2024-12-18\n\nKey endpoints:\n- POST /v1/payment_intents\n- GET /v1/payment_intents/:id\n- POST /v1/webhooks',
      icon: '📄'
    }
  ];
  
  samples.forEach(file => {
    const fileObj = {
      id: Date.now() + Math.random(),
      ...file,
      addedAt: Date.now()
    };
    state.contextFiles.push(fileObj);
  });
  
  renderContextFiles();
}

function renderContextFiles() {
  const container = document.getElementById('contextFilesList');
  
  if (state.contextFiles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary); font-size: 13px;">
        No context files yet.<br>Click + to add one.
      </div>
    `;
    return;
  }
  
  container.innerHTML = state.contextFiles.map((file, index) => `
    <div class="context-file ${index === 0 ? 'active' : ''}" data-id="${file.id}">
      <div class="context-file-header">
        <span class="context-file-name">${file.icon} ${file.name}</span>
        <button class="btn-icon-small" onclick="removeContextFile('${file.id}')">×</button>
      </div>
      <div class="context-file-preview">${file.content.substring(0, 60)}...</div>
    </div>
  `).join('');
  
  // Add click handlers
  document.querySelectorAll('.context-file').forEach(el => {
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('btn-icon-small')) {
        document.querySelectorAll('.context-file').forEach(f => f.classList.remove('active'));
        el.classList.add('active');
      }
    });
  });
}

function addContextFile() {
  const name = document.getElementById('contextFileName').value.trim();
  const content = document.getElementById('contextFileContent').value.trim();
  
  if (!name || !content) {
    showToast('⚠️ Please fill in both fields', 'error');
    return;
  }
  
  const file = {
    id: Date.now() + Math.random(),
    name,
    content,
    icon: '📄',
    addedAt: Date.now()
  };
  
  state.contextFiles.push(file);
  renderContextFiles();
  closeModal('contextFileModal');
  
  // Clear form
  document.getElementById('contextFileName').value = '';
  document.getElementById('contextFileContent').value = '';
  
  showToast(`✓ Added "${name}"`, 'success');
}

function removeContextFile(id) {
  state.contextFiles = state.contextFiles.filter(f => f.id !== parseFloat(id));
  renderContextFiles();
  showToast('✓ Context file removed', 'success');
}

// ============================================
// Prompt Editor
// ============================================

function handleYourPromptInput(e) {
  state.yourPrompt = e.target.value;
  updateCharCounts();
  
  // Trigger friend to start typing after you've written something
  if (state.yourPrompt.length > 30 && state.friendPrompt.length === 0) {
    simulateFriendTyping();
  }
}

function handleFriendPromptInput(e) {
  state.friendPrompt = e.target.value;
  updateCharCounts();
}

function updateCharCounts() {
  // Update your prompt count
  const yourCount = state.yourPrompt.length;
  document.getElementById('charCountYours').textContent = `${yourCount} chars`;
  
  // Update friend's prompt count
  const friendCount = state.friendPrompt.length;
  document.getElementById('charCountFriend').textContent = `${friendCount} chars`;
  
  // Update main header count (total)
  const totalCount = yourCount + friendCount;
  document.getElementById('charCount').textContent = `${totalCount} character${totalCount !== 1 ? 's' : ''} total`;
}

function handleTabClick(e) {
  const tab = e.target.dataset.tab;
  
  // Update tab styles
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  
  // Show/hide panels
  const promptEditor = document.getElementById('promptEditor');
  const contextPanel = document.getElementById('contextPanel');
  
  if (tab === 'prompt') {
    promptEditor.classList.remove('hidden');
    contextPanel.classList.add('hidden');
  } else {
    promptEditor.classList.add('hidden');
    contextPanel.classList.remove('hidden');
  }
}

// ============================================
// Collaborative Typing Simulation
// ============================================

function simulateFriendTyping() {
  // Clear any existing timeout
  if (state.friendTypingTimeout) {
    clearTimeout(state.friendTypingTimeout);
  }
  
  // Don't simulate if friend already has content
  if (state.friendPrompt.length > 0) {
    return;
  }
  
  // Show toast that friend is typing
  showToast(`💬 Alex is typing...`, 'info');
  
  // Simulate friend typing after a delay
  state.friendTypingTimeout = setTimeout(() => {
    const friendSuggestions = [
      "Add comprehensive error handling:\n- Retry logic with exponential backoff\n- Proper error logging\n- User-friendly error messages\n\nSecurity considerations:\n- Input validation\n- Rate limiting\n- Authentication checks",
      
      "Important edge cases to handle:\n- Network timeouts\n- Concurrent requests\n- Invalid input data\n- Database connection failures\n\nPerformance requirements:\n- Response time < 200ms\n- Handle 1000 req/sec\n- Graceful degradation",
      
      "Additional requirements:\n- Comprehensive logging\n- Monitoring and alerts\n- Unit test coverage > 80%\n- API documentation\n- Rollback plan"
    ];
    
    // Pick a random suggestion
    const suggestion = friendSuggestions[Math.floor(Math.random() * friendSuggestions.length)];
    
    // Type it character by character for effect
    typeText(suggestion, document.getElementById('promptInputFriend'));
    
  }, 2000);
}

function typeText(text, element, index = 0) {
  if (index < text.length) {
    element.value = text.substring(0, index + 1);
    state.friendPrompt = element.value;
    updateCharCounts();
    
    // Random typing speed (30-100ms per character)
    const delay = Math.random() * 70 + 30;
    setTimeout(() => typeText(text, element, index + 1), delay);
  } else {
    // Finished typing
    showToast(`✓ Alex added suggestions`, 'success');
  }
}

// ============================================
// Generate Outputs
// ============================================

async function generateOutputs() {
  if (state.isGenerating) return;
  
  // Check if at least one prompt has content
  const yourPromptLength = state.yourPrompt.trim().length;
  const friendPromptLength = state.friendPrompt.trim().length;
  
  if (yourPromptLength === 0 && friendPromptLength === 0) {
    showToast('⚠️ Please write at least one prompt', 'error');
    return;
  }
  
  if (yourPromptLength < 20 && friendPromptLength < 20) {
    showToast('⚠️ Please write more detailed prompts (20+ characters)', 'error');
    return;
  }
  
  state.isGenerating = true;
  
  // Show output panel
  document.getElementById('outputPanel').classList.add('visible');
  
  // Show loading state
  document.getElementById('outputYours').innerHTML = '<div class="loading">🤖 Generating your version...</div>';
  document.getElementById('outputFriend').innerHTML = '<div class="loading">🤖 Generating Alex\'s version...</div>';
  document.getElementById('outputCombined').innerHTML = '<div class="loading">🤖 Generating combined version...</div>';
  
  try {
    // Simulate API call delay
    await sleep(1500);
    
    // Generate three versions
    const yourVersion = generateYourVersion();
    document.getElementById('outputYours').textContent = yourVersion;
    
    await sleep(1000);
    
    const friendVersion = generateFriendVersion();
    document.getElementById('outputFriend').textContent = friendVersion;
    
    await sleep(1000);
    
    const combinedVersion = generateCombinedVersion(yourVersion, friendVersion);
    document.getElementById('outputCombined').textContent = combinedVersion;
    
    showToast('✅ Generated 3 versions successfully!', 'success');
    
  } catch (error) {
    showToast('❌ Generation failed. Please try again.', 'error');
    console.error(error);
  } finally {
    state.isGenerating = false;
  }
}

function generateYourVersion() {
  // Generate based primarily on YOUR prompt
  const yourPrompt = state.yourPrompt || "Build a payment integration";
  const contextInfo = state.contextFiles.map(f => `${f.name}: ${f.content.substring(0, 100)}...`).join('\n');
  
  return `# Your Version

## Based on Your Requirements

**Your Prompt:**
"${yourPrompt.substring(0, 200)}${yourPrompt.length > 200 ? '...' : ''}"

## Implementation

### 1. Setup
\`\`\`javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
\`\`\`

### 2. Core Endpoint
\`\`\`javascript
app.post('/api/payment-intents', async (req, res) => {
  try {
    const { amount, currency } = req.body;
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic'
        }
      }
    });
    
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
\`\`\`

### 3. Webhook Handler
\`\`\`javascript
app.post('/api/webhooks', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
    }
    
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(\`Webhook Error: \${err.message}\`);
  }
});
\`\`\`

### Context Files Referenced:
${contextInfo || 'No context files'}`;
}

function generateFriendVersion() {
  // Generate based primarily on FRIEND'S prompt
  const friendPrompt = state.friendPrompt || "Add error handling and edge cases";
  
  return `# Alex's Version

## Enhanced Implementation

**Alex's Prompt:**
"${friendPrompt.substring(0, 200)}${friendPrompt.length > 200 ? '...' : ''}"

## Implementation with Additional Safeguards

Based on Alex's focus areas:

### 1. Enhanced Setup with Retry Logic
\`\`\`javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  maxNetworkRetries: 3,
  timeout: 10000
});
\`\`\`

### 2. Payment Intent with Idempotency
\`\`\`javascript
app.post('/api/payment-intents', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  
  try {
    const { amount, currency, metadata } = req.body;
    
    // Validation
    if (!amount || amount < 50) {
      return res.status(400).json({ 
        error: 'Amount must be at least 50 cents' 
      });
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency || 'usd',
      metadata: {
        ...metadata,
        environment: process.env.NODE_ENV
      },
      automatic_payment_methods: { enabled: true },
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
          setup_future_usage: 'off_session'
        }
      }
    }, {
      idempotencyKey // Prevent duplicate charges
    });
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id
    });
  } catch (error) {
    // Structured error logging
    logger.error('Payment intent creation failed', {
      error: error.message,
      code: error.code,
      type: error.type
    });
    
    res.status(500).json({ 
      error: 'Payment processing failed',
      code: error.code 
    });
  }
});
\`\`\`

### 3. Robust Webhook Processing
\`\`\`javascript
app.post('/api/webhooks', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Webhook signature verification failed', {
      error: err.message
    });
    return res.status(400).send(\`Webhook Error: \${err.message}\`);
  }
  
  // Process async to return 200 quickly
  processWebhookAsync(event);
  res.json({ received: true });
});

async function processWebhookAsync(event) {
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
      case 'payment_intent.requires_action':
        await handle3DSecure(event.data.object);
        break;
    }
  } catch (error) {
    logger.error('Webhook processing failed', {
      eventType: event.type,
      eventId: event.id,
      error: error.message
    });
  }
}
\`\`\`

Key improvements:
- Idempotency for safe retries
- Better error handling
- Webhook signature verification
- Async processing for webhooks
- Structured logging`;
}

function generateCombinedVersion(yourVersion, friendVersion) {
  // Combine best of both prompts
  const yourPrompt = state.yourPrompt || "";
  const friendPrompt = state.friendPrompt || "";
  
  return `# Combined Version - Production-Ready

## Merged Requirements

**Your Focus:**
${yourPrompt.substring(0, 150)}${yourPrompt.length > 150 ? '...' : ''}

**Alex's Focus:**
${friendPrompt.substring(0, 150)}${friendPrompt.length > 150 ? '...' : ''}

## Best Practices from Both Perspectives

### 1. Production-Grade Setup
\`\`\`javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18',
  maxNetworkRetries: 3,
  timeout: 10000,
  telemetry: false // Disable in production
});

// Logger setup
const logger = require('./logger');
\`\`\`

### 2. Create Payment Intent (Combining Both Approaches)
\`\`\`javascript
app.post('/api/payment-intents', async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || 
    \`\${req.body.orderId}-\${Date.now()}\`;
  
  try {
    const { amount, currency = 'usd', metadata = {} } = req.body;
    
    // Input validation (from Alex's version)
    if (!amount || amount < 50) {
      return res.status(400).json({ 
        error: 'Invalid amount',
        message: 'Amount must be at least 50 cents' 
      });
    }
    
    // Create payment intent with 3D Secure (from your version)
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      metadata: {
        ...metadata,
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      },
      automatic_payment_methods: { enabled: true },
      // EU compliance
      payment_method_options: {
        card: {
          request_three_d_secure: 'automatic',
          setup_future_usage: 'off_session'
        }
      }
    }, {
      idempotencyKey // Prevent duplicate charges
    });
    
    // Log for audit trail
    logger.info('Payment intent created', {
      id: paymentIntent.id,
      amount,
      currency,
      status: paymentIntent.status
    });
    
    res.json({ 
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
      status: paymentIntent.status
    });
    
  } catch (error) {
    // Structured error logging (from Alex's version)
    logger.error('Payment intent creation failed', {
      error: error.message,
      code: error.code,
      type: error.type,
      idempotencyKey
    });
    
    res.status(500).json({ 
      error: 'Payment processing failed',
      code: error.code,
      message: process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'Please try again'
    });
  }
});
\`\`\`

### 3. Production Webhook Handler
\`\`\`javascript
app.post('/api/webhooks', 
  express.raw({type: 'application/json'}), 
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
      // Verify webhook signature (critical for security)
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      logger.error('Webhook signature verification failed', {
        error: err.message,
        ip: req.ip
      });
      return res.status(400).send(\`Webhook Error: \${err.message}\`);
    }
    
    // Return 200 immediately (Alex's approach)
    res.json({ received: true });
    
    // Process async with error handling
    processWebhookAsync(event).catch(error => {
      logger.error('Webhook processing failed', {
        eventType: event.type,
        eventId: event.id,
        error: error.message
      });
    });
});

async function processWebhookAsync(event) {
  // Idempotency check
  const processed = await checkIfProcessed(event.id);
  if (processed) {
    logger.info('Webhook already processed', { eventId: event.id });
    return;
  }
  
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
        
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
        
      case 'payment_intent.requires_action':
        await handle3DSecure(event.data.object);
        break;
        
      default:
        logger.debug('Unhandled webhook event', { 
          type: event.type 
        });
    }
    
    // Mark as processed
    await markAsProcessed(event.id);
    
  } catch (error) {
    logger.error('Webhook processing error', {
      eventType: event.type,
      eventId: event.id,
      error: error.message,
      stack: error.stack
    });
    throw error; // For retry mechanism
  }
}
\`\`\`

## Combined Benefits:

✅ **From Your Version:**
- Clean, simple implementation
- Proper 3D Secure support
- Good context integration
- Clear structure

✅ **From Alex's Version:**
- Idempotency keys
- Better error handling
- Async webhook processing
- Structured logging

✅ **Additional Combined Features:**
- Production-ready configuration
- Comprehensive validation
- Audit trails
- Webhook deduplication
- Environment-specific behavior

## Testing Checklist:
- [ ] Test successful payments
- [ ] Test declined cards
- [ ] Test 3D Secure flow
- [ ] Test webhook signature validation
- [ ] Test idempotency (duplicate requests)
- [ ] Test error handling
- [ ] Load test webhook endpoint

This combined version is production-ready and incorporates best practices from both perspectives!`;
}

// ============================================
// Output Management
// ============================================

function handleOutputTabClick(e) {
  const version = e.target.dataset.version;
  
  // Update tab styles
  document.querySelectorAll('.output-tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  
  // Show version
  document.querySelectorAll('.output-version').forEach(v => v.classList.remove('active'));
  document.querySelector(`.output-version[data-version="${version}"]`).classList.add('active');
}

function copyOutput(version) {
  const element = document.getElementById(`output${version.charAt(0).toUpperCase() + version.slice(1)}`);
  const text = element.textContent;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('✓ Copied to clipboard!', 'success');
  }).catch(() => {
    showToast('❌ Failed to copy', 'error');
  });
}

function exportOutput(version) {
  const element = document.getElementById(`output${version.charAt(0).toUpperCase() + version.slice(1)}`);
  const text = element.textContent;
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prompt-output-${version}-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('✓ Downloaded!', 'success');
}

// ============================================
// Sidebar Management
// ============================================

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const collapseBtn = document.getElementById('collapseSidebar');
  
  const isCollapsed = sidebar.classList.toggle('collapsed');
  
  if (isCollapsed) {
    // Sidebar is now collapsed
    sidebarToggle.classList.remove('hidden');
    collapseBtn.textContent = '▶';
    showToast('📁 Sidebar collapsed', 'info');
  } else {
    // Sidebar is now expanded
    sidebarToggle.classList.add('hidden');
    collapseBtn.textContent = '◀';
  }
}

// ============================================
// Modal Management
// ============================================

function openModal(modalId) {
  document.getElementById(modalId).classList.add('visible');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('visible');
}

// ============================================
// Toast Notifications
// ============================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ============================================
// Utilities
// ============================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// Keyboard Shortcuts
// ============================================

document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + Enter to generate
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    generateOutputs();
  }
  
  // Cmd/Ctrl + B to toggle sidebar
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault();
    toggleSidebar();
  }
  
  // Escape to close modal
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.visible').forEach(modal => {
      modal.classList.remove('visible');
    });
  }
});

console.log('🚀 UpdateAI Workspace loaded!');
