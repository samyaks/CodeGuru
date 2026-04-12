# @codeguru/analytics

Lightweight analytics snippet for apps built with Takeoff. Tracks page views and custom events with zero dependencies.

## Script tag (recommended)

Add this to your HTML — the snippet is served by your Takeoff backend at `/t.js`:

```html
<script src="/t.js" data-project="YOUR_PROJECT_ID" defer></script>
```

This will automatically:
- Track page views on load and SPA navigation (`pushState` / `popState`)
- Batch events and flush every 5 seconds (or on tab hide / page unload)
- Generate a random session ID stored in `sessionStorage`

### Custom events

```js
window.takeoff.track('signup', { plan: 'pro' });
```

## NPM module

```bash
npm install @codeguru/analytics
```

```js
const { init, track } = require('@codeguru/analytics');

// Call once on app startup (browser only)
init('YOUR_PROJECT_ID');

// Track custom events
track('button_click', { label: 'hero-cta' });
```

`init()` injects the `/t.js` script tag for you. Pass `{ src: '/custom-path.js' }` as the second argument to override the script URL.
