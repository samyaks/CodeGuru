# UpdateAI Component Architecture

## 📦 Overview

The codebase is now organized into **reusable, framework-agnostic components** that can be used in:
- Chrome Extension
- Workspace Web App
- CLI Tools
- Mobile Apps (React Native)
- Desktop Apps (Electron)
- Any JavaScript project

---

## 🏗️ Architecture

```
src/
├── lib/                    # Core business logic (framework-agnostic)
│   ├── capture-manager.js  # Capture CRUD operations
│   └── project-manager.js  # Project CRUD operations
│
├── components/             # Reusable UI components (Vanilla JS)
│   ├── CaptureButton.js    # Floating capture button
│   └── CaptureList.js      # Capture list renderer
│
├── utils/                  # Shared utilities
│   └── index.js            # Helper functions
│
├── content/                # Extension-specific content scripts
│   ├── google-detector.js
│   ├── jira-detector.js
│   └── slack-detector.js
│
├── background/             # Extension-specific background
│   └── service-worker-simple.js
│
└── popup/                  # Extension-specific popup
    ├── popup.html
    └── popup.js
```

---

## 📚 Component Documentation

### 1. **CaptureManager** (`lib/capture-manager.js`)

**Purpose:** Manage all capture operations (CRUD)

**Storage Agnostic:** Works with any storage backend

**Usage:**

```javascript
// Chrome Extension
import { createCaptureManager } from './lib/capture-manager.js';
const manager = createCaptureManager('chrome');

// Web App
const manager = createCaptureManager('localStorage');

// Custom Storage
const manager = new CaptureManager({
  async get(key) { /* your implementation */ },
  async set(key, value) { /* your implementation */ }
});

// Operations
await manager.add(capture);
await manager.remove(captureId);
await manager.getAll();
await manager.search('query');
await manager.exportToJSON();
```

**Key Features:**
- ✅ Storage agnostic
- ✅ Validation built-in
- ✅ Search & filter
- ✅ Import/export
- ✅ Statistics

---

### 2. **ProjectManager** (`lib/project-manager.js`)

**Purpose:** Manage project operations

**Usage:**

```javascript
import { createProjectManager } from './lib/project-manager.js';
const manager = createProjectManager('chrome');

// Operations
await manager.create('My Project', initialLink);
await manager.addLink(link);
await manager.removeLink(url);
await manager.hasLink(url);
```

**Key Features:**
- ✅ Storage agnostic
- ✅ Link management
- ✅ Duplicate detection

---

### 3. **CaptureButton** (`components/CaptureButton.js`)

**Purpose:** Floating capture button that appears on text selection

**Framework:** Vanilla JS (works anywhere)

**Usage:**

```javascript
import { createCaptureButton, setupAutoCaptureButton } from './components/CaptureButton.js';

// Option 1: Manual button creation
const button = createCaptureButton(selectedText, {
  onCapture: async (text) => {
    await saveCapture(text);
  },
  position: 'center', // or 'mouse' or {x, y}
  autoHide: 5000
});
document.body.appendChild(button);

// Option 2: Automatic setup (recommended)
setupAutoCaptureButton({
  minLength: 20,
  onCapture: async (text) => {
    await saveCapture(text);
  }
});
```

**Key Features:**
- ✅ Customizable styling
- ✅ Multiple positioning modes
- ✅ Auto-hide timer
- ✅ Success/error states
- ✅ No dependencies

---

### 4. **CaptureList** (`components/CaptureList.js`)

**Purpose:** Render a list of captures

**Usage:**

```javascript
import { createCaptureList } from './components/CaptureList.js';

const list = createCaptureList(captures, {
  onRemove: (id) => { /* handle remove */ },
  onClick: (capture) => { /* handle click */ },
  showRemoveButton: true,
  maxHeight: '400px'
});

container.appendChild(list);
```

**Key Features:**
- ✅ Type-based icons & colors
- ✅ Click & remove handlers
- ✅ Empty state
- ✅ Responsive design

---

### 5. **Utils** (`utils/index.js`)

**Purpose:** Shared utility functions

**Functions:**
- `sanitizeText(str)` - XSS protection
- `formatTimeAgo(timestamp)` - Relative time
- `formatDate(timestamp)` - Human-friendly date
- `generateId()` - Unique IDs
- `debounce(func, wait)` - Debounce
- `throttle(func, limit)` - Throttle
- `showToast(message, type)` - Toast notifications
- `copyToClipboard(text)` - Clipboard API
- `downloadTextFile(text, filename)` - File download
- `groupBy(array, key)` - Array grouping

**Usage:**

```javascript
import { sanitizeText, formatTimeAgo, showToast } from './utils/index.js';

const safe = sanitizeText(userInput);
const time = formatTimeAgo(Date.now() - 3600000); // "1h ago"
showToast('Success!', 'success');
```

---

## 🔌 Integration Examples

### Example 1: Chrome Extension (Current)

```javascript
// popup.js
import { createCaptureManager } from '../lib/capture-manager.js';
import { createCaptureList } from '../components/CaptureList.js';

const captureManager = createCaptureManager('chrome');

async function loadCaptures() {
  const captures = await captureManager.getAll();
  const list = createCaptureList(captures, {
    onRemove: async (id) => {
      await captureManager.remove(id);
      loadCaptures(); // Refresh
    }
  });
  document.getElementById('captures').appendChild(list);
}
```

### Example 2: React Web App

```jsx
// App.jsx
import { createCaptureManager } from '../lib/capture-manager';
import { useState, useEffect } from 'react';

function App() {
  const [captures, setCaptures] = useState([]);
  const manager = createCaptureManager('localStorage');

  useEffect(() => {
    loadCaptures();
  }, []);

  async function loadCaptures() {
    const data = await manager.getAll();
    setCaptures(data);
  }

  return (
    <div>
      {captures.map(c => (
        <CaptureCard key={c.id} capture={c} />
      ))}
    </div>
  );
}
```

### Example 3: Node.js CLI Tool

```javascript
// cli.js
import { CaptureManager } from '../lib/capture-manager.js';
import fs from 'fs/promises';

// Custom file-based storage
const fileStorage = {
  async get(key) {
    const data = await fs.readFile('data.json', 'utf-8');
    return JSON.parse(data)[key];
  },
  async set(key, value) {
    const data = await fs.readFile('data.json', 'utf-8').catch(() => '{}');
    const json = JSON.parse(data);
    json[key] = value;
    await fs.writeFile('data.json', JSON.stringify(json, null, 2));
  }
};

const manager = new CaptureManager(fileStorage);

// CLI commands
if (process.argv[2] === 'list') {
  const captures = await manager.getAll();
  console.log(captures);
}
```

---

## 🎨 Customization

### Custom Storage Backend

```javascript
import { CaptureManager } from './lib/capture-manager.js';

// IndexedDB storage
const idbStorage = {
  async get(key) {
    const db = await openDB();
    return await db.get('store', key);
  },
  async set(key, value) {
    const db = await openDB();
    await db.put('store', value, key);
  }
};

const manager = new CaptureManager(idbStorage);
```

### Custom Button Styles

```javascript
import { createCaptureButton } from './components/CaptureButton.js';

const button = createCaptureButton(text, {
  style: {
    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    borderRadius: '24px',
    fontSize: '16px'
  },
  text: '💾 Save This',
  successText: '✨ Saved!'
});
```

---

## ✅ Benefits

1. **Reusability:** Use components in multiple apps
2. **Testability:** Easy to unit test pure functions
3. **Maintainability:** Single source of truth
4. **Flexibility:** Swap storage backends easily
5. **No Framework Lock-in:** Works with React, Vue, Svelte, or Vanilla JS

---

## 🚀 Next Steps

### For Extension:
```javascript
// Update content scripts to use new components
import { setupAutoCaptureButton } from '../components/CaptureButton.js';
import { createCaptureManager } from '../lib/capture-manager.js';

setupAutoCaptureButton({
  onCapture: async (text) => {
    const manager = createCaptureManager('chrome');
    await manager.add({
      type: 'google-docs',
      content: text,
      // ...
    });
  }
});
```

### For Workspace App:
```javascript
// Use same managers with localStorage
import { createCaptureManager } from '@updateai/lib';
const manager = createCaptureManager('localStorage');
```

### For NPM Package:
```json
{
  "name": "@updateai/core",
  "version": "1.0.0",
  "exports": {
    "./lib/*": "./src/lib/*",
    "./components/*": "./src/components/*",
    "./utils": "./src/utils/index.js"
  }
}
```

---

## 📝 Migration Guide

See [MIGRATION.md](./MIGRATION.md) for step-by-step guide to migrate existing code to use components.

---

**Status:** ✅ Component architecture complete!  
**Ready for:** Extension refactor, Workspace App integration, NPM publishing
