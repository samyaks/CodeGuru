const { test } = require('node:test');
const assert = require('node:assert');

const { parseInvariants, normalizeText, mergeKey, selectJobsForFirstScan } = require('./generate-invariants');

test('parseInvariants validates anchors and satisfied flag', () => {
  const anchors = [{ file_path: 'a.js', symbol: 'fn', kind: 'function' }];
  const raw = JSON.stringify([
    { text: 'Must auth', kind: 'behavior', satisfied: false, links: [{ file_path: 'a.js', symbol: 'fn' }] },
    { text: 'Bad link', links: [{ file_path: 'missing.js', symbol: 'x' }] },
  ]);
  const out = parseInvariants(raw, anchors);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].satisfied, false);
});

test('mergeKey normalizes kind and primary link', () => {
  assert.strictEqual(mergeKey('behavior', { file_path: 'a.js', symbol: 'fn' }), 'behavior::a.js::fn');
  assert.strictEqual(normalizeText('  Hello world. '), 'hello world');
});

test('selectJobsForFirstScan prefers higher weight then priority', () => {
  const jobs = [
    { id: 'a', title: 'A', weight: 1, priority: 'low' },
    { id: 'b', title: 'B', weight: 3, priority: 'medium' },
    { id: 'c', title: 'C', weight: 3, priority: 'high' },
    { id: 'd', title: 'D', weight: 2, priority: 'high' },
  ];
  const picked = selectJobsForFirstScan(jobs, 2).map((j) => j.id);
  assert.deepStrictEqual(picked, ['c', 'b']);
});
