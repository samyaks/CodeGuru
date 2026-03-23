# Highlight Capture Debugging & Testing Guide

## ⚠️ Issue: Highlight capture button not appearing

This guide will help you diagnose and fix the text highlight capture functionality.

---

## 🔍 What Should Happen (Expected Behavior)

### On Supported Sites (Jira, Google Docs, Slack):
1. User highlights text (20+ characters)
2. After releasing mouse button
3. A purple gradient button appears in center of screen
4. Button says "✨ Add to UpdateAI"
5. User clicks button
6. Button changes to green "✓ Added!"
7. Button disappears after 1.5 seconds
8. Capture saved to storage

---

## 🧪 Step-by-Step Debugging Test Plan

### STEP 1: Verify Content Scripts Are Loading

**Test: Check if content scripts are injected**

1. Load extension in Chrome (`chrome://extensions/`)
2. Navigate to a test page:
   - **Google Docs:** https://docs.google.com/document/
   - **Jira:** https://yourcompany.atlassian.net/browse/PROJ-123
   - **Slack:** https://yourworkspace.slack.com/archives/C123
3. Open DevTools (F12) → Console tab
4. Look for these log messages:

**Expected Console Output:**
```javascript
[UpdateAI] Detected: google_docs Test Document
UpdateAI: Google Docs capture ready
```
OR
```javascript
[UpdateAI] Detected Jira: PROJ-123: Issue title
UpdateAI: Jira capture ready
```
OR
```javascript
[UpdateAI] Detected Slack: #general
UpdateAI: Slack capture ready
```

**✅ PASS:** You see these messages  
**❌ FAIL:** No messages → Content script not loading → Go to STEP 1A

---

### STEP 1A: Fix Content Script Not Loading

**Possible Causes:**
1. Extension not properly loaded
2. Manifest.json has errors
3. File paths incorrect
4. URL doesn't match content_scripts patterns

**Debug Steps:**

1. **Check Extension Status:**
   ```
   chrome://extensions/
   → Find UpdateAI
   → Check for errors (red text)
   → Click "Errors" if any
   ```

2. **Verify File Structure:**
   ```bash
   ls -la src/content/
   # Should show:
   # - google-detector.js
   # - jira-detector.js
   # - slack-detector.js
   ```

3. **Check Manifest Content Scripts:**
   ```json
   "content_scripts": [
     {
       "matches": [
         "https://docs.google.com/document/*",
         "https://docs.google.com/spreadsheets/*",
         "https://docs.google.com/presentation/*"
       ],
       "js": ["src/content/google-detector.js"],
       "run_at": "document_idle"
     }
   ]
   ```

4. **Test URL Matching:**
   - Open: https://docs.google.com/document/d/1234/edit
   - Check if URL matches pattern `https://docs.google.com/document/*`
   - ✅ Match → Should load
   - ❌ No match → URL pattern is wrong

5. **Reload Extension:**
   ```
   chrome://extensions/
   → Click "Reload" button on UpdateAI
   → Refresh test page
   → Check console again
   ```

**If still not working:**
```javascript
// Manually inject script to test
// In DevTools console on test page:
fetch(chrome.runtime.getURL('src/content/google-detector.js'))
  .then(r => r.text())
  .then(code => eval(code))
  .catch(e => console.error('Failed to load:', e));
```

---

### STEP 2: Test Text Selection Detection

**Test: Verify mouseup event listener works**

1. Navigate to supported page (ensure STEP 1 passes)
2. Open DevTools → Console
3. Type this code:

```javascript
// Test if selection works
document.addEventListener('mouseup', (e) => {
  const selection = window.getSelection().toString().trim();
  console.log('Selection length:', selection.length);
  console.log('Selection text:', selection.substring(0, 50));
});
```

4. Highlight some text on the page (20+ characters)
5. Release mouse button

**Expected Console Output:**
```
Selection length: 42
Selection text: This is the text I highlighted for testing
```

**✅ PASS:** You see selection logged → Go to STEP 3  
**❌ FAIL:** Nothing logged → Selection not detected → Go to STEP 2A

---

### STEP 2A: Fix Selection Detection

**Issue:** Text selection not being captured

**Possible Causes:**
1. Page uses Shadow DOM or iframe
2. Page prevents text selection
3. Content script runs before page loads
4. Event listener not attached

**Debug Steps:**

1. **Check if page allows selection:**
   ```javascript
   // In console:
   console.log('Can select:', !document.body.style.userSelect || document.body.style.userSelect !== 'none');
   ```

2. **Check for Shadow DOM:**
   ```javascript
   // In console:
   const shadow = document.querySelector('*').shadowRoot;
   console.log('Has shadow DOM:', !!shadow);
   ```

3. **Manually test selection API:**
   ```javascript
   // Highlight text manually, then run:
   const sel = window.getSelection();
   console.log('Selection exists:', !!sel);
   console.log('Selection text:', sel.toString());
   console.log('Range count:', sel.rangeCount);
   ```

4. **Check if content script loaded too early:**
   ```javascript
   // In content script, change:
   document.addEventListener('mouseup', () => {
   // To:
   window.addEventListener('load', () => {
     document.addEventListener('mouseup', () => {
   ```

---

### STEP 3: Test Button Creation

**Test: Verify button element is created and appended**

1. Ensure STEP 2 passes (selection detected)
2. Add debug logging to content script
3. Open DevTools → Console
4. Paste this BEFORE highlighting:

```javascript
// Override showCaptureButton to add logging
const originalShowCaptureButton = window.showCaptureButton || showCaptureButton;

window.showCaptureButton = function(selectedText) {
  console.log('🟢 showCaptureButton called');
  console.log('Selected text:', selectedText);
  
  const button = document.createElement('div');
  console.log('🟢 Button element created:', button);
  
  button.style.cssText = `
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
  
  button.textContent = '✨ Add to UpdateAI';
  
  console.log('🟢 Button styled and text set');
  console.log('Button styles:', button.style.cssText);
  
  document.body.appendChild(button);
  console.log('🟢 Button appended to body');
  console.log('Body children count:', document.body.children.length);
  
  // Check if button is visible
  const rect = button.getBoundingClientRect();
  console.log('Button position:', rect);
  console.log('Button visible:', rect.width > 0 && rect.height > 0);
};
```

5. Highlight text (20+ characters)

**Expected Console Output:**
```
🟢 showCaptureButton called
Selected text: This is my highlighted text...
🟢 Button element created: div
🟢 Button styled and text set
🟢 Button appended to body
Body children count: 47
Button position: DOMRect {x: 640, y: 360, width: 200, height: 48}
Button visible: true
```

**✅ PASS:** Button created and visible → Go to STEP 4  
**❌ FAIL:** Button not visible → Go to STEP 3A

---

### STEP 3A: Fix Button Not Appearing

**Possible Issues:**

#### Issue 1: Button created but not visible

**Check CSS conflicts:**
```javascript
// In console after highlighting:
const buttons = document.querySelectorAll('div');
const updateaiButton = Array.from(buttons).find(b => b.textContent.includes('UpdateAI'));

if (updateaiButton) {
  console.log('Button exists:', updateaiButton);
  console.log('Computed styles:', window.getComputedStyle(updateaiButton));
  console.log('Position:', updateaiButton.getBoundingClientRect());
  console.log('z-index:', updateaiButton.style.zIndex);
  console.log('Visibility:', window.getComputedStyle(updateaiButton).visibility);
  console.log('Display:', window.getComputedStyle(updateaiButton).display);
} else {
  console.error('Button not found in DOM!');
}
```

**Fix:** Increase z-index if needed:
```javascript
// Change z-index from 999999 to something higher
z-index: 2147483647; // Maximum possible value
```

#### Issue 2: Button removed immediately

**Check if button is being removed:**
```javascript
// Add to showCaptureButton function:
const observer = new MutationObserver((mutations) => {
  mutations.forEach(mutation => {
    mutation.removedNodes.forEach(node => {
      if (node === button) {
        console.error('⚠️ Button was removed from DOM!');
        console.trace(); // Show stack trace
      }
    });
  });
});

observer.observe(document.body, { childList: true });
```

#### Issue 3: Selection length check failing

**Check minimum length:**
```javascript
// In content script, find this line:
if (selection.length > 20) {

// Add debug logging:
const selection = window.getSelection().toString().trim();
console.log('Selection length:', selection.length);
if (selection.length > 20) {
  console.log('✅ Selection length sufficient, showing button');
  showCaptureButton(selection);
} else {
  console.log('❌ Selection too short, need 20+ characters, got:', selection.length);
}
```

---

### STEP 4: Test Button Click

**Test: Verify click handler works**

1. Ensure STEP 3 passes (button appears)
2. Open DevTools → Console
3. Highlight text
4. When button appears, check if it's clickable:

```javascript
// In console:
const button = Array.from(document.querySelectorAll('div')).find(b => 
  b.textContent.includes('UpdateAI')
);

if (button) {
  console.log('Button found:', button);
  console.log('Has onclick:', !!button.onclick);
  console.log('Cursor style:', window.getComputedStyle(button).cursor);
  
  // Test click
  button.click();
  console.log('Button clicked');
} else {
  console.error('Button not found!');
}
```

5. Click the button manually

**Expected Behavior:**
- Button text changes to "✓ Added!"
- Button turns green
- Console shows message to background script
- Button disappears after 1.5 seconds

**Expected Console Output:**
```javascript
Button found: div
Has onclick: true
Cursor style: pointer
Button clicked
```

**✅ PASS:** Button responds to click → Go to STEP 5  
**❌ FAIL:** Click not working → Go to STEP 4A

---

### STEP 4A: Fix Button Click Not Working

**Possible Issues:**

#### Issue 1: Click event not firing

**Test click event:**
```javascript
// In showCaptureButton, change:
captureButton.onclick = () => {
// To:
captureButton.addEventListener('click', (e) => {
  console.log('🟢 Button clicked!', e);
  e.stopPropagation();
  e.preventDefault();
```

#### Issue 2: Page intercepts clicks

**Add click handler with higher priority:**
```javascript
// Use capture phase
captureButton.addEventListener('click', (e) => {
  console.log('Click captured');
  e.stopImmediatePropagation(); // Stop all other handlers
  // ... rest of code
}, true); // true = capture phase
```

#### Issue 3: Button gets removed before click

**Increase timeout:**
```javascript
// Change from 5000ms to 10000ms:
setTimeout(() => {
  if (captureButton) {
    captureButton.remove();
    captureButton = null;
  }
}, 10000); // 10 seconds instead of 5
```

---

### STEP 5: Test Message to Background

**Test: Verify capture data sent to service worker**

1. Ensure STEP 4 passes (button click works)
2. Open service worker console:
   - Go to `chrome://extensions/`
   - Find UpdateAI
   - Click "service worker" link
3. Look for ADD_CAPTURE message handler
4. Highlight text and click button

**Expected Service Worker Console Output:**
```javascript
[UpdateAI] Message received: ADD_CAPTURE
Capture data: {
  id: "1234567890abcde",
  type: "google-docs",
  source: "Test Document",
  title: "Google Doc (Selection)",
  content: "This is the highlighted text...",
  timestamp: 1706345678901,
  url: "https://docs.google.com/document/d/...",
  metadata: {}
}
```

**✅ PASS:** Message received in service worker → Go to STEP 6  
**❌ FAIL:** No message → Go to STEP 5A

---

### STEP 5A: Fix Message Not Reaching Service Worker

**Possible Issues:**

#### Issue 1: Runtime not available

**Check if extension context valid:**
```javascript
// In content script:
captureButton.onclick = () => {
  if (!chrome.runtime || !chrome.runtime.id) {
    console.error('⚠️ Extension context invalidated!');
    alert('Please reload the page');
    return;
  }
  
  console.log('Chrome runtime available:', chrome.runtime.id);
  
  // Rest of code...
};
```

#### Issue 2: Message failing silently

**Add error handling:**
```javascript
chrome.runtime.sendMessage({ type: 'ADD_CAPTURE', capture }, (response) => {
  if (chrome.runtime.lastError) {
    console.error('Message failed:', chrome.runtime.lastError);
  } else {
    console.log('Message sent successfully:', response);
  }
});
```

#### Issue 3: Service worker not listening

**Check service worker message handler:**
```javascript
// In src/background/service-worker.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Service Worker] Message received:', message.type);
  
  if (message.type === 'ADD_CAPTURE') {
    console.log('[Service Worker] Processing capture:', message.capture);
    // ... rest of handler
    sendResponse({ success: true }); // Important! Acknowledge receipt
    return true; // Keep message channel open
  }
});
```

---

### STEP 6: Test Storage

**Test: Verify capture saved to chrome.storage.local**

1. Ensure STEP 5 passes (message received)
2. Open DevTools → Application tab
3. Expand "Storage" → "Local Storage" → "chrome-extension://[id]"
4. Look for 'captures' key
5. OR in console:

```javascript
chrome.storage.local.get(['captures'], (result) => {
  console.log('Stored captures:', result.captures);
  console.log('Count:', result.captures?.length || 0);
});
```

**Expected Output:**
```javascript
Stored captures: [
  {
    id: "1234567890abcde",
    type: "google-docs",
    content: "Highlighted text...",
    timestamp: 1706345678901
  }
]
Count: 1
```

**✅ PASS:** Capture stored successfully  
**❌ FAIL:** Not stored → Check service worker ADD_CAPTURE handler

---

## 🎯 Quick Manual Test Checklist

Use this checklist for each test run:

### Test on Google Docs

- [ ] 1. Navigate to: https://docs.google.com/document/
- [ ] 2. Open DevTools console
- [ ] 3. Verify log: "UpdateAI: Google Docs capture ready"
- [ ] 4. Highlight 20+ characters of text
- [ ] 5. Release mouse button
- [ ] 6. Purple button appears in center of screen
- [ ] 7. Button says "✨ Add to UpdateAI"
- [ ] 8. Click button
- [ ] 9. Button changes to "✓ Added!" (green)
- [ ] 10. Button disappears after 1.5s
- [ ] 11. Check storage: capture exists
- [ ] 12. Open extension popup: capture appears in list

### Test on Jira

- [ ] 1. Navigate to: https://[company].atlassian.net/browse/[KEY]-123
- [ ] 2. Open DevTools console
- [ ] 3. Verify log: "UpdateAI: Jira capture ready"
- [ ] 4. Highlight 20+ characters (issue description or comment)
- [ ] 5. Release mouse button
- [ ] 6. Purple button appears
- [ ] 7. Click button
- [ ] 8. Button turns green "✓ Added!"
- [ ] 9. Capture stored with type: "jira"
- [ ] 10. Extension popup shows capture

### Test on Slack

- [ ] 1. Navigate to: https://[workspace].slack.com/archives/[CHANNEL]
- [ ] 2. Open DevTools console
- [ ] 3. Verify log: "UpdateAI: Slack capture ready"
- [ ] 4. Highlight 20+ characters from a message
- [ ] 5. Release mouse button
- [ ] 6. Purple button appears
- [ ] 7. Click button
- [ ] 8. Button turns green
- [ ] 9. Capture stored with type: "slack"
- [ ] 10. Extension popup shows capture

---

## 🐛 Common Issues & Fixes

### Issue: Button appears but immediately disappears

**Cause:** Another mouseup event fires and removes button  
**Fix:** Add small delay before listening for next mouseup

```javascript
document.addEventListener('mouseup', () => {
  // Delay removal check to prevent immediate re-trigger
  setTimeout(() => {
    if (captureButton) {
      captureButton.remove();
      captureButton = null;
    }
    
    const selection = window.getSelection().toString().trim();
    if (selection.length > 20) {
      showCaptureButton(selection);
    }
  }, 100); // 100ms delay
});
```

### Issue: Button appears behind page content

**Cause:** Page has elements with higher z-index  
**Fix:** Use maximum z-index value

```javascript
z-index: 2147483647; // Maximum 32-bit integer
```

### Issue: Text selection lost when button appears

**Cause:** Button creation clears selection  
**Fix:** Save selection before creating button

```javascript
document.addEventListener('mouseup', () => {
  const selection = window.getSelection().toString().trim();
  const range = window.getSelection().getRangeAt(0); // Save range
  
  if (selection.length > 20) {
    showCaptureButton(selection, range);
  }
});
```

### Issue: Button doesn't work on specific sites

**Cause:** Site has Content Security Policy (CSP) restrictions  
**Fix:** Use inline event listeners instead of string CSS

```javascript
// Instead of:
captureButton.style.cssText = '...';

// Use:
Object.assign(captureButton.style, {
  position: 'fixed',
  top: '50%',
  left: '50%',
  // ... etc
});
```

---

## 🧰 Debug Tools

### Tool 1: Content Script Status Checker

Paste in page console to check content script status:

```javascript
async function checkContentScriptStatus() {
  console.log('=== UpdateAI Content Script Status ===\n');
  
  // Check if content script loaded
  const scriptLoaded = window.__updateai_detected !== undefined;
  console.log('1. Content script loaded:', scriptLoaded ? '✅' : '❌');
  
  // Check selection API
  const hasSelection = !!window.getSelection;
  console.log('2. Selection API available:', hasSelection ? '✅' : '❌');
  
  // Check event listeners
  const listeners = getEventListeners(document);
  const hasMouseup = listeners.mouseup?.length > 0;
  console.log('3. Mouseup listener attached:', hasMouseup ? '✅' : '❌');
  
  // Check Chrome runtime
  const hasRuntime = !!chrome?.runtime?.id;
  console.log('4. Extension runtime available:', hasRuntime ? '✅' : '❌');
  
  // Test selection
  console.log('\n5. Testing selection...');
  console.log('   Select text now (you have 5 seconds)...');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const selection = window.getSelection().toString().trim();
  console.log('   Selected text length:', selection.length);
  console.log('   Minimum required: 20');
  console.log('   Will trigger button:', selection.length > 20 ? '✅' : '❌');
  
  if (selection.length > 20) {
    console.log('\n✅ All checks passed! Button should appear.');
  } else {
    console.log('\n⚠️ Select more text (20+ characters) to trigger button.');
  }
}

checkContentScriptStatus();
```

### Tool 2: Force Button Test

Force show button to test styling:

```javascript
function forceShowButton() {
  const button = document.createElement('div');
  button.style.cssText = `
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    z-index: 2147483647 !important;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    color: white !important;
    padding: 12px 20px !important;
    border-radius: 12px !important;
    cursor: pointer !important;
    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4) !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    font-size: 14px !important;
    font-weight: 600 !important;
  `;
  
  button.textContent = '✨ Add to UpdateAI (TEST)';
  button.onclick = () => {
    console.log('Button clicked!');
    alert('Button works!');
  };
  
  document.body.appendChild(button);
  console.log('Test button added. Should be visible now.');
  
  return button;
}

const testButton = forceShowButton();
```

### Tool 3: Message Flow Tester

Test end-to-end message flow:

```javascript
async function testMessageFlow() {
  console.log('=== Testing Message Flow ===\n');
  
  // 1. Create test capture
  const testCapture = {
    id: Date.now().toString(),
    type: 'test',
    source: 'Manual Test',
    title: 'Test Capture',
    content: 'This is a test capture to verify message flow',
    timestamp: Date.now(),
    url: window.location.href,
    metadata: {}
  };
  
  console.log('1. Created test capture:', testCapture);
  
  // 2. Send to background
  console.log('\n2. Sending message to background...');
  
  try {
    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'ADD_CAPTURE', capture: testCapture },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
    
    console.log('   ✅ Message sent successfully');
    console.log('   Response:', response);
    
    // 3. Check storage
    console.log('\n3. Checking storage...');
    const { captures = [] } = await chrome.storage.local.get(['captures']);
    
    const found = captures.find(c => c.id === testCapture.id);
    if (found) {
      console.log('   ✅ Capture saved to storage');
      console.log('   Total captures:', captures.length);
    } else {
      console.log('   ❌ Capture NOT found in storage');
      console.log('   Existing captures:', captures.length);
    }
    
    console.log('\n✅ Message flow test complete!');
    
  } catch (error) {
    console.error('❌ Message flow test failed:', error);
  }
}

testMessageFlow();
```

---

## 📋 Final Test Report Template

After running all tests, fill out this report:

```
=== UpdateAI Highlight Capture Test Report ===

Date: _____________
Tester: _____________
Extension Version: _____________

STEP 1: Content Script Loading
[ ] Google Docs   ✅ Loaded  ❌ Failed
[ ] Jira          ✅ Loaded  ❌ Failed
[ ] Slack         ✅ Loaded  ❌ Failed

STEP 2: Text Selection Detection
[ ] Selection captured   ✅ Pass  ❌ Fail
[ ] Length check (20+)   ✅ Pass  ❌ Fail

STEP 3: Button Creation
[ ] Button created       ✅ Pass  ❌ Fail
[ ] Button visible       ✅ Pass  ❌ Fail
[ ] Button styled        ✅ Pass  ❌ Fail

STEP 4: Button Interaction
[ ] Button clickable     ✅ Pass  ❌ Fail
[ ] Click handler works  ✅ Pass  ❌ Fail
[ ] Button changes color ✅ Pass  ❌ Fail
[ ] Button auto-removes  ✅ Pass  ❌ Fail

STEP 5: Message Passing
[ ] Message sent         ✅ Pass  ❌ Fail
[ ] Service worker rcv   ✅ Pass  ❌ Fail
[ ] No errors            ✅ Pass  ❌ Fail

STEP 6: Storage
[ ] Capture saved        ✅ Pass  ❌ Fail
[ ] Data correct         ✅ Pass  ❌ Fail
[ ] Popup shows capture  ✅ Pass  ❌ Fail

ISSUES FOUND:
1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

FIXES APPLIED:
1. _____________________________________________
2. _____________________________________________
3. _____________________________________________

OVERALL STATUS: ✅ PASS  ❌ FAIL  ⚠️ PARTIAL

NOTES:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## 🚀 Next Steps

1. **Run this debug plan systematically**
2. **Document any failures in test report**
3. **Apply fixes from relevant STEP A sections**
4. **Re-test after each fix**
5. **Once working, test on all three platforms**

**After highlight capture works:** Ready to build Workspace App! 🎉
