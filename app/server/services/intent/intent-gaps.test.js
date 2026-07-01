const test = require('node:test');
const assert = require('node:assert');

const { synthesizeIntentGaps } = require('./intent-gaps');

const healthy = { file_path: 'a.js', symbol: 'login', link_status: 'healthy' };
const broken = { file_path: 'a.js', symbol: 'login', link_status: 'broken' };

test('confirmed + satisfied + healthy -> no gap', () => {
  const gaps = synthesizeIntentGaps([
    { id: 's1', status: 'confirmed', kind: 'behavior', text: 'ok', satisfied: true, links: [healthy] },
  ]);
  assert.deepStrictEqual(gaps, []);
});

test('confirmed + unsatisfied -> unsatisfied gap with camelCase links', () => {
  const gaps = synthesizeIntentGaps([
    {
      id: 's1', status: 'confirmed', kind: 'behavior',
      text: 'Login issues a session token', satisfied: false,
      feature_area: 'auth', last_checked_at: '2026-01-01T00:00:00Z',
      links: [healthy],
    },
  ]);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].id, 'intent-s1');
  assert.strictEqual(gaps[0].statementId, 's1');
  assert.strictEqual(gaps[0].reason, 'unsatisfied');
  assert.strictEqual(gaps[0].featureArea, 'auth');
  assert.strictEqual(gaps[0].lastCheckedAt, '2026-01-01T00:00:00Z');
  assert.deepStrictEqual(gaps[0].links, [
    { filePath: 'a.js', symbol: 'login', linkStatus: 'healthy', suggestedSymbol: null },
  ]);
});

test('confirmed + broken link (but satisfied) -> broken_link gap', () => {
  const gaps = synthesizeIntentGaps([
    { id: 's1', status: 'confirmed', kind: 'constraint', text: 'x', satisfied: true, links: [broken] },
  ]);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].reason, 'broken_link');
});

test('unsatisfied takes precedence over broken_link', () => {
  const gaps = synthesizeIntentGaps([
    { id: 's1', status: 'confirmed', kind: 'behavior', text: 'x', satisfied: false, links: [broken] },
  ]);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].reason, 'unsatisfied');
});

test('non-confirmed statements are ignored even if unsatisfied', () => {
  const gaps = synthesizeIntentGaps([
    { id: 's1', status: 'candidate', kind: 'behavior', text: 'x', satisfied: false, links: [healthy] },
    { id: 's2', status: 'rejected', kind: 'behavior', text: 'y', satisfied: false, links: [broken] },
  ]);
  assert.deepStrictEqual(gaps, []);
});

test('null/empty input is safe', () => {
  assert.deepStrictEqual(synthesizeIntentGaps(null), []);
  assert.deepStrictEqual(synthesizeIntentGaps(undefined), []);
  assert.deepStrictEqual(synthesizeIntentGaps([]), []);
});
