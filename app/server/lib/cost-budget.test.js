const { test } = require('node:test');
const assert = require('node:assert');

const {
  buildTakeoffCostPlan,
  projectScanCost,
  FIRST_SCAN_INVARIANT_CAP,
} = require('./cost-budget');

test('projectScanCost grows with files and jobs', () => {
  const small = projectScanCost({ ingestedFileCount: 20, jobCount: 8 });
  const large = projectScanCost({ ingestedFileCount: 200, jobCount: 20 });
  assert.ok(large.total > small.total);
  assert.ok(small.breakdown.read === 0.05);
});

test('full mode under soft ceiling keeps AI suggestions and Claude gap-link', () => {
  const plan = buildTakeoffCostPlan({ ingestedFileCount: 30, jobCount: 8, softCeilingUsd: 1 });
  assert.strictEqual(plan.mode, 'full');
  assert.strictEqual(plan.skipAiSuggestions, false);
  assert.strictEqual(plan.useClaudeGapLink, true);
  assert.strictEqual(plan.maxInvariantJobs, FIRST_SCAN_INVARIANT_CAP);
  assert.strictEqual(plan.invariantModel, null);
  assert.ok(plan.context.tokenBudget <= 11000);
  assert.ok(plan.context.combinedMaxTokens <= 12000);
});

test('degrade mode above soft ceiling skips suggestions, uses Haiku invariants, keeps Read untouched', () => {
  const plan = buildTakeoffCostPlan({ ingestedFileCount: 400, jobCount: 24, softCeilingUsd: 1 });
  assert.strictEqual(plan.mode, 'degrade');
  assert.strictEqual(plan.skipAiSuggestions, true);
  assert.strictEqual(plan.useClaudeGapLink, false);
  assert.strictEqual(plan.invariantModel, 'haiku');
  assert.strictEqual(plan.maxInvariantJobs, FIRST_SCAN_INVARIANT_CAP);
  assert.ok(plan.context.tokenBudget < 11000);
  // Read is never represented as a cut flag — absence is the contract.
  assert.strictEqual('skipRead' in plan, false);
});
