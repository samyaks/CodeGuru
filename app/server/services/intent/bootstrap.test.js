const test = require('node:test');
const assert = require('node:assert');

// --- Mock external deps BEFORE requiring the module under test. ---
// We stub the DB repo (capture inserts, avoid a real connection) and the
// tracked Claude call (return canned JSON, never hit the network).

const dbPath = require.resolve('../../lib/db');
const trackedPath = require.resolve('../../lib/anthropic-tracked');

const captured = { batches: [], deletedAreas: [] };
let existingStatements = [];
let claudeResponders = {}; // featureArea -> () => rawText

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    intentStatements: {
      async findByProjectId() {
        return existingStatements;
      },
      async deleteCandidatesByArea(_projectId, featureArea) {
        captured.deletedAreas.push(featureArea);
      },
      async createBatch(items) {
        captured.batches.push(items);
      },
    },
  },
};

require.cache[trackedPath] = {
  id: trackedPath,
  filename: trackedPath,
  loaded: true,
  exports: {
    async createMessageTracked({ params }) {
      const userContent = params.messages[0].content;
      const areaMatch = /Feature area: (.+)/.exec(userContent);
      const area = areaMatch ? areaMatch[1] : '';
      const responder = claudeResponders[area];
      const text = responder ? responder() : '[]';
      return { content: [{ type: 'text', text }] };
    },
  },
};

const { bootstrapIntent } = require('./bootstrap');

function reset() {
  captured.batches = [];
  captured.deletedAreas = [];
  existingStatements = [];
  claudeResponders = {};
}

test('returns early with no anchors and never calls Claude', async () => {
  reset();
  const res = await bootstrapIntent('p1', { structureAnchors: [] });
  assert.deepStrictEqual(res, { areas: 0, created: 0, failedAreas: [] });
  assert.strictEqual(captured.batches.length, 0);
  assert.strictEqual(captured.deletedAreas.length, 0);
});

test('persists valid statements and drops ones citing unknown anchors', async () => {
  reset();
  const anchors = [
    { file_path: 'app/checkout.js', symbol: 'POST /checkout', kind: 'route', feature_area: 'checkout' },
  ];
  claudeResponders.checkout = () =>
    JSON.stringify([
      {
        text: 'Checkout requires a successful payment authorization',
        kind: 'behavior',
        links: [{ file_path: 'app/checkout.js', symbol: 'POST /checkout' }],
      },
      {
        // cites an anchor not in the input set -> dropped
        text: 'Something about a made up file',
        kind: 'behavior',
        links: [{ file_path: 'app/nope.js', symbol: 'ghost' }],
      },
      {
        // no links -> dropped
        text: 'Vague no-link statement',
        kind: 'constraint',
        links: [],
      },
    ]);

  const res = await bootstrapIntent('p1', {
    structureAnchors: anchors,
    fileContents: { 'app/checkout.js': 'function checkout() {}' },
  });

  assert.strictEqual(res.areas, 1);
  assert.strictEqual(res.created, 1);
  assert.deepStrictEqual(res.failedAreas, []);
  assert.deepStrictEqual(captured.deletedAreas, ['checkout']);
  assert.strictEqual(captured.batches.length, 1);
  const row = captured.batches[0][0];
  assert.strictEqual(row.status, 'candidate');
  assert.strictEqual(row.source, 'inferred');
  assert.strictEqual(row.feature_area, 'checkout');
  assert.deepStrictEqual(row.links, [
    { file_path: 'app/checkout.js', symbol: 'POST /checkout', link_status: 'healthy' },
  ]);
});

test('suppresses candidates matching a previously rejected statement', async () => {
  reset();
  existingStatements = [
    {
      status: 'rejected',
      kind: 'behavior',
      feature_area: 'checkout',
      text: 'anything',
      links: [{ file_path: 'app/checkout.js', symbol: 'POST /checkout' }],
    },
  ];
  const anchors = [
    { file_path: 'app/checkout.js', symbol: 'POST /checkout', kind: 'route', feature_area: 'checkout' },
  ];
  claudeResponders.checkout = () =>
    JSON.stringify([
      {
        text: 'Re-proposing the rejected surface',
        kind: 'behavior',
        links: [{ file_path: 'app/checkout.js', symbol: 'POST /checkout' }],
      },
    ]);

  const res = await bootstrapIntent('p1', {
    structureAnchors: anchors,
    fileContents: { 'app/checkout.js': 'x' },
  });

  assert.strictEqual(res.created, 0);
  assert.deepStrictEqual(captured.deletedAreas, ['checkout']);
  assert.strictEqual(captured.batches.length, 0);
});

test('one failing area does not block the others', async () => {
  reset();
  const anchors = [
    { file_path: 'app/auth.js', symbol: 'login', kind: 'function', feature_area: 'auth' },
    { file_path: 'app/checkout.js', symbol: 'POST /checkout', kind: 'route', feature_area: 'checkout' },
  ];
  claudeResponders.auth = () => 'not valid json {{{';
  claudeResponders.checkout = () =>
    JSON.stringify([
      {
        text: 'Checkout creates an order',
        kind: 'behavior',
        links: [{ file_path: 'app/checkout.js', symbol: 'POST /checkout' }],
      },
    ]);

  const res = await bootstrapIntent('p1', {
    structureAnchors: anchors,
    fileContents: {},
  });

  assert.strictEqual(res.areas, 2);
  assert.strictEqual(res.created, 1);
  assert.deepStrictEqual(res.failedAreas, ['auth']);
});
