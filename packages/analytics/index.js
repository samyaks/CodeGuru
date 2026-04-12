/**
 * @codeguru/analytics — NPM module for programmatic use.
 *
 * In a browser context this injects the snippet.js script tag.
 * It also re-exports the track/flush helpers for convenience.
 */

let initialized = false;

function init(projectId, options) {
  if (typeof window === 'undefined') {
    console.warn('[Takeoff Analytics] init() is a browser-only API');
    return;
  }

  if (initialized) return;
  initialized = true;

  options = options || {};

  if (window.takeoff && typeof window.takeoff.track === 'function') {
    return;
  }

  const src = options.src || '/t.js';
  const script = document.createElement('script');
  script.src = src;
  script.setAttribute('data-project', projectId);
  script.async = true;
  document.head.appendChild(script);
}

function track(event, props) {
  if (typeof window === 'undefined') return;
  if (window.takeoff && typeof window.takeoff.track === 'function') {
    window.takeoff.track(event, props);
  } else {
    console.warn('[Takeoff Analytics] Call init() before track()');
  }
}

function flush() {
  if (typeof window === 'undefined') return;
  if (window.takeoff && typeof window.takeoff.flush === 'function') {
    window.takeoff.flush();
  }
}

module.exports = { init, track, flush };
