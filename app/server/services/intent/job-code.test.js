const { test } = require('node:test');
const assert = require('node:assert');

const { resolveJobFiles, titleFallbackFiles } = require('./job-code');

test('resolveJobFiles uses needs edges and fallback', () => {
  const job = { id: 'j1', title: 'Authentication login flow' };
  const map = {
    entities: [{ id: 'e1', file_path: 'server/auth.js' }],
    edges: [{ from_id: 'j1', to_id: 'e1', type: 'needs' }],
  };
  const allPaths = ['server/auth.js', 'app/client/main.tsx'];
  const { files, usedFallback } = resolveJobFiles(job, map, allPaths);
  assert.ok(files.includes('server/auth.js'));
  assert.strictEqual(usedFallback, false);
});

test('titleFallbackFiles matches path tokens', () => {
  const extra = titleFallbackFiles('Dashboard analytics', ['app/pages/Dashboard.tsx'], new Set());
  assert.ok(extra.some((f) => f.includes('Dashboard')));
});
