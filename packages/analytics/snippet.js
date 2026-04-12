(function() {
  'use strict';

  var FLUSH_INTERVAL = 5000;
  var MAX_BATCH = 50;
  var ENDPOINT = '/api/collect';

  // With defer/async, document.currentScript is null when this runs; walk scripts
  // with data-project to find our tag (last match wins, same as typical loader order).
  var scriptTag = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].getAttribute('data-project')) return scripts[i];
    }
    return null;
  })();

  var projectId = scriptTag ? scriptTag.getAttribute('data-project') : null;
  if (!projectId) {
    console.warn('[Takeoff] Missing data-project attribute on script tag');
    return;
  }

  var queue = [];
  var sessionId = (function() {
    var key = '_tf_sid';
    var existing = null;
    try { existing = sessionStorage.getItem(key); } catch (e) {}
    if (existing) return existing;
    var id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    try { sessionStorage.setItem(key, id); } catch (e) {}
    return id;
  })();

  function getDevice() {
    var w = window.screen ? window.screen.width : window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function enqueue(event, props) {
    var entry = {
      event: event,
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      device: getDevice(),
      sessionId: sessionId,
      metadata: props || null,
      timestamp: new Date().toISOString()
    };
    queue.push(entry);
    if (queue.length >= MAX_BATCH) flush();
  }

  function flush() {
    if (!queue.length) return;
    var batch = queue.splice(0, MAX_BATCH);
    var payload = JSON.stringify({ projectId: projectId, events: batch });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', ENDPOINT, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(payload);
    }
  }

  function trackPageview() {
    enqueue('pageview', null);
  }

  // SPA support: pushState + popstate only (not replaceState — frameworks use it for
  // query/hash/scroll updates that should not count as new pageviews).
  var origPushState = history.pushState;

  history.pushState = function() {
    origPushState.apply(this, arguments);
    trackPageview();
  };

  window.addEventListener('popstate', trackPageview);

  // Flush on visibility change and before unload
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush();
  });

  window.addEventListener('beforeunload', flush);

  // Periodic flush
  setInterval(flush, FLUSH_INTERVAL);

  // Public API
  window.takeoff = window.takeoff || {};
  window.takeoff.track = function(event, props) {
    if (typeof event !== 'string' || !event) {
      console.warn('[Takeoff] track() requires a string event name');
      return;
    }
    enqueue(event, props || null);
  };
  window.takeoff.flush = flush;

  // Initial pageview
  trackPageview();
})();
