const { test } = require('node:test');
const assert = require('node:assert');

const { parseInvariants, normalizeText, mergeKey } = require('./generate-invariants');

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
