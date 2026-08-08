const { test } = require('node:test');
const assert = require('node:assert');

// Mock the DB repo before requiring the module so no real connection is made.
const dbPath = require.resolve('../../lib/db');

let listByAnalysisImpl = async () => [];
const calls = { listByAnalysis: [] };

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    analysisFiles: {
      async listByAnalysis(analysisId, opts) {
        calls.listByAnalysis.push({ analysisId, opts });
        return listByAnalysisImpl(analysisId, opts);
      },
    },
  },
};

const { buildCodeSlice } = require('./code-slice');

const MARKER = '\n… [truncated]';

function fullRow(path, { score = null, inbound = null, content = '' } = {}) {
  return { path, tier: 'full', score, inbound_degree: inbound, content, skeleton: null };
}

function skeletonRow(path, { score = null, inbound = null, skeleton = '' } = {}) {
  return { path, tier: 'skeleton', score, inbound_degree: inbound, content: null, skeleton };
}

function treeRow(path, { score = null } = {}) {
  return { path, tier: 'tree', score, inbound_degree: null, content: null, skeleton: null };
}

test('rejects when projectId is missing', async () => {
  await assert.rejects(() => buildCodeSlice(), /projectId/);
  await assert.rejects(() => buildCodeSlice(null), /projectId/);
});

test('db happy path: fulls first by score, then skeletons; knownPaths spans all tiers', async () => {
  listByAnalysisImpl = async () => [
    fullRow('src/app.js', { score: 10, content: 'const app = 1;' }),
    fullRow('src/db.js', { score: 8, content: 'const db = 2;' }),
    skeletonRow('src/util.js', { score: 5, skeleton: 'function util()' }),
    treeRow('assets/logo.png', { score: 1 }),
    treeRow('README.md'),
  ];

  const slice = await buildCodeSlice('proj-1');

  assert.strictEqual(slice.source, 'db');
  assert.strictEqual(slice.truncated, false);
  assert.deepStrictEqual(
    slice.files.map((f) => [f.path, f.kind]),
    [['src/app.js', 'full'], ['src/db.js', 'full'], ['src/util.js', 'skeleton']]
  );
  assert.strictEqual(slice.files[0].text, 'const app = 1;');
  assert.strictEqual(slice.files[0].score, 10);
  assert.deepStrictEqual(
    [...slice.knownPaths].sort(),
    ['README.md', 'assets/logo.png', 'src/app.js', 'src/db.js', 'src/util.js']
  );
});

test('inbound_degree breaks score ties among full files', async () => {
  listByAnalysisImpl = async () => [
    fullRow('a.js', { score: 5, inbound: 1, content: 'a' }),
    fullRow('b.js', { score: 5, inbound: 9, content: 'b' }),
  ];

  const slice = await buildCodeSlice('proj-1');
  assert.deepStrictEqual(slice.files.map((f) => f.path), ['b.js', 'a.js']);
  assert.strictEqual(slice.files[0].inboundDegree, 9);
});

test('full rows without content and rows with empty content are skipped', async () => {
  listByAnalysisImpl = async () => [
    fullRow('empty.js', { score: 9, content: '' }),
    { path: 'null.js', tier: 'full', score: 8, inbound_degree: null, content: null },
    fullRow('real.js', { score: 1, content: 'x = 1' }),
  ];

  const slice = await buildCodeSlice('proj-1');
  assert.deepStrictEqual(slice.files.map((f) => f.path), ['real.js']);
  // ...but their paths still count as known.
  assert.ok(slice.knownPaths.includes('empty.js'));
  assert.ok(slice.knownPaths.includes('null.js'));
});

test('a giant full file is capped at ~4000 chars with a truncation marker', async () => {
  listByAnalysisImpl = async () => [
    fullRow('big.js', { score: 10, content: 'x'.repeat(10000) }),
  ];

  const slice = await buildCodeSlice('proj-1');
  assert.strictEqual(slice.files.length, 1);
  assert.strictEqual(slice.files[0].text.length, 4000 + MARKER.length);
  assert.ok(slice.files[0].text.endsWith(MARKER));
  assert.strictEqual(slice.truncated, true);
});

test('skeletons are capped at ~1500 chars', async () => {
  listByAnalysisImpl = async () => [
    skeletonRow('outline.js', { score: 3, skeleton: 's'.repeat(3000) }),
  ];

  const slice = await buildCodeSlice('proj-1');
  assert.strictEqual(slice.files[0].kind, 'skeleton');
  assert.strictEqual(slice.files[0].text.length, 1500 + MARKER.length);
  assert.strictEqual(slice.truncated, true);
});

test('budget exhaustion truncates the file that crosses the line and drops the rest', async () => {
  listByAnalysisImpl = async () => [
    fullRow('one.js', { score: 3, content: '1'.repeat(3000) }),
    fullRow('two.js', { score: 2, content: '2'.repeat(3000) }),
    fullRow('three.js', { score: 1, content: '3'.repeat(3000) }),
  ];

  const slice = await buildCodeSlice('proj-1', { budgetChars: 5000 });

  assert.strictEqual(slice.truncated, true);
  assert.deepStrictEqual(slice.files.map((f) => f.path), ['one.js', 'two.js']);
  assert.strictEqual(slice.files[0].text.length, 3000);
  // second file is cut down to exactly the remaining 2000 chars, marker included
  assert.strictEqual(slice.files[1].text.length, 2000);
  assert.ok(slice.files[1].text.endsWith(MARKER));
  // dropped file is still a known path
  assert.ok(slice.knownPaths.includes('three.js'));
});

test('skeletons only enter after full files, within the same budget', async () => {
  listByAnalysisImpl = async () => [
    skeletonRow('skel.js', { score: 100, skeleton: 'outline' }),
    fullRow('main.js', { score: 1, content: 'code' }),
  ];

  const slice = await buildCodeSlice('proj-1');
  // even though the skeleton has a higher score, fulls come first
  assert.deepStrictEqual(slice.files.map((f) => f.kind), ['full', 'skeleton']);
});

test('db error falls back to codebaseModel', async () => {
  listByAnalysisImpl = async () => { throw new Error('connection refused'); };

  const slice = await buildCodeSlice('proj-1', {
    codebaseModel: {
      fileContents: { 'src/index.js': 'console.log(1)' },
      fileTree: ['src/index.js', 'src/other.js'],
    },
  });

  assert.strictEqual(slice.source, 'model');
  assert.deepStrictEqual(slice.files.map((f) => [f.path, f.kind]), [['src/index.js', 'full']]);
  assert.strictEqual(slice.files[0].score, null);
  assert.strictEqual(slice.files[0].inboundDegree, null);
  assert.deepStrictEqual([...slice.knownPaths].sort(), ['src/index.js', 'src/other.js']);
});

test('empty db rows fall back to codebaseModel; fileTree objects with .path work too', async () => {
  listByAnalysisImpl = async () => [];

  const slice = await buildCodeSlice('proj-1', {
    codebaseModel: {
      fileContents: {},
      fileTree: [{ path: 'a.js' }, { path: 'b.js' }, 'c.js'],
    },
  });

  assert.strictEqual(slice.source, 'model');
  assert.deepStrictEqual(slice.files, []);
  assert.deepStrictEqual([...slice.knownPaths].sort(), ['a.js', 'b.js', 'c.js']);
});

test('model fallback still honors per-file cap and budget', async () => {
  listByAnalysisImpl = async () => [];

  const slice = await buildCodeSlice('proj-1', {
    budgetChars: 4500,
    codebaseModel: {
      fileContents: {
        'big.js': 'x'.repeat(9000),
        'small.js': 'y'.repeat(1000),
      },
    },
  });

  assert.strictEqual(slice.source, 'model');
  assert.strictEqual(slice.truncated, true);
  assert.strictEqual(slice.files[0].text.length, 4000 + MARKER.length);
  // 4014 spent of 4500 → 486 left, enough (≥ min) for a truncated second file
  assert.strictEqual(slice.files[1].text.length, 4500 - (4000 + MARKER.length));
});

test('no db rows and no model returns the empty shape', async () => {
  listByAnalysisImpl = async () => [];

  const slice = await buildCodeSlice('proj-1');
  assert.deepStrictEqual(slice, { files: [], knownPaths: [], truncated: false, source: 'empty' });
});

test('a model with no contents and no tree is treated as empty', async () => {
  listByAnalysisImpl = async () => [];

  const slice = await buildCodeSlice('proj-1', { codebaseModel: {} });
  assert.strictEqual(slice.source, 'empty');
  assert.deepStrictEqual(slice.files, []);
});
