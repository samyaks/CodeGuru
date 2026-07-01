const test = require('node:test');
const assert = require('node:assert');

// Mock the DB repo; reconcile-links itself is pure and runs for real.
const dbPath = require.resolve('../../lib/db');

let statements = [];
const captured = { updates: [] };

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    intentStatements: {
      async findByProjectId() {
        return statements;
      },
      async update(id, projectId, fields) {
        captured.updates.push({ id, ...fields });
        return { id };
      },
    },
  },
};

const { runLinkReconciliation } = require('./reconcile-runner');

function reset() {
  statements = [];
  captured.updates = [];
}

test('self-heals a moved symbol and persists only the changed statement', async () => {
  reset();
  statements = [
    {
      id: 's1', status: 'confirmed', text: 'a', feature_area: 'auth',
      links: [{ file_path: 'old/auth.js', symbol: 'login', link_status: 'healthy' }],
    },
    {
      id: 's2', status: 'confirmed', text: 'b', feature_area: 'auth',
      links: [{ file_path: 'stable.js', symbol: 'ping', link_status: 'healthy' }],
    },
  ];
  // login moved to new/auth.js; ping unchanged.
  const anchors = [
    { file_path: 'new/auth.js', symbol: 'login', kind: 'function', feature_area: 'auth' },
    { file_path: 'stable.js', symbol: 'ping', kind: 'function', feature_area: 'core' },
  ];

  const stats = await runLinkReconciliation('p1', { structureAnchors: anchors });
  assert.strictEqual(stats.statements, 2);
  assert.strictEqual(stats.updated, 1, 'only the moved statement is rewritten');
  assert.strictEqual(captured.updates.length, 1);
  assert.strictEqual(captured.updates[0].id, 's1');
  assert.strictEqual(captured.updates[0].links[0].file_path, 'new/auth.js');
  assert.strictEqual(captured.updates[0].links[0].link_status, 'healthy');
});

test('flags a vanished symbol as needs_relink / broken and counts triage', async () => {
  reset();
  statements = [
    {
      id: 's1', status: 'confirmed', text: 'a', feature_area: 'auth',
      links: [{ file_path: 'auth.js', symbol: 'loginUser', link_status: 'healthy' }],
    },
  ];
  // loginUser is gone; a similar loginUserById exists -> needs_relink suggestion.
  const anchors = [
    { file_path: 'auth.js', symbol: 'loginUserById', kind: 'function', feature_area: 'auth' },
  ];

  const stats = await runLinkReconciliation('p1', { structureAnchors: anchors });
  assert.strictEqual(stats.updated, 1);
  assert.strictEqual(stats.triage, 1);
  const link = captured.updates[0].links[0];
  assert.ok(link.link_status === 'needs_relink' || link.link_status === 'broken');
});

test('rejected statements are skipped entirely', async () => {
  reset();
  statements = [
    {
      id: 'r1', status: 'rejected', text: 'x', feature_area: 'auth',
      links: [{ file_path: 'gone.js', symbol: 'dead', link_status: 'healthy' }],
    },
  ];
  const stats = await runLinkReconciliation('p1', { structureAnchors: [] });
  assert.strictEqual(stats.statements, 0);
  assert.strictEqual(captured.updates.length, 0);
});

test('no anchors + no statements is a safe no-op', async () => {
  reset();
  const stats = await runLinkReconciliation('p1', {});
  assert.deepStrictEqual(stats, { statements: 0, updated: 0, triage: 0 });
});
