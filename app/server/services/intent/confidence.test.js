const { test } = require('node:test');
const assert = require('node:assert');

const { scoreInvariantConfidence, isAutoConfirmEligible, AUTO_CONFIRM_THRESHOLD } = require('./confidence');

test('detector-backed invariants score 1.0', () => {
  assert.strictEqual(scoreInvariantConfidence({ links: [], detectorBacked: true }), 1.0);
});

test('single healthy anchor scores high', () => {
  const score = scoreInvariantConfidence({
    links: [{ file_path: 'a.js', symbol: 'fn', link_status: 'healthy' }],
    satisfied: true,
  });
  assert.ok(score >= AUTO_CONFIRM_THRESHOLD);
});

test('broken satisfied lowers confidence', () => {
  const score = scoreInvariantConfidence({
    links: [{ file_path: 'a.js', symbol: 'fn', link_status: 'healthy' }],
    satisfied: false,
  });
  assert.ok(score < AUTO_CONFIRM_THRESHOLD);
  assert.ok(!isAutoConfirmEligible(score));
});
