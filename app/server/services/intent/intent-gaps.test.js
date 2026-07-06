const { test } = require('node:test');
const assert = require('node:assert');

const { synthesizeIntentGaps, synthesizeFindings } = require('./intent-gaps');

test('synthesizeIntentGaps flags confirmed unsatisfied', () => {
  const gaps = synthesizeIntentGaps([
    { id: '1', text: 'Drift', kind: 'behavior', status: 'confirmed', satisfied: false, links: [] },
  ]);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].reason, 'unsatisfied');
});

test('synthesizeFindings surfaces broken candidate and confirmed', () => {
  const rows = [
    { id: '1', text: 'A', kind: 'behavior', status: 'candidate', scope: 'job', satisfied: false, links: [] },
    { id: '2', text: 'B', kind: 'behavior', status: 'confirmed', scope: 'job', satisfied: true, links: [] },
  ];
  const findings = synthesizeFindings(rows);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].statementId, '1');
});
