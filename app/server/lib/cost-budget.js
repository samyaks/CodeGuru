/**
 * Takeoff first-scan cost planning + soft ceiling.
 *
 * Soft ceiling (default $1 projected): degrade before reject; never touch Read.
 * Always applies first-scan invariant job cap (8) and shrunk context defaults.
 */

const SOFT_CEILING_USD = Number(process.env.TAKEOFF_SOFT_CEILING_USD) || 1.0;
const FIRST_SCAN_INVARIANT_CAP = Number(process.env.TAKEOFF_INVARIANT_JOB_CAP) || 8;

/** Baseline context knobs (always-on shrink vs historical 18k/20k/10). */
const CONTEXT_FULL = Object.freeze({
  tokenBudget: 11000,
  featureDirMax: 6,
  combinedMaxTokens: 12000,
  dirTokenBudget: 2500,
});

/** Further shrink when projected spend exceeds the soft ceiling. */
const CONTEXT_DEGRADE = Object.freeze({
  tokenBudget: 8000,
  featureDirMax: 4,
  combinedMaxTokens: 10000,
  dirTokenBudget: 2000,
});

const SUGGESTION_TOKEN_BUDGET_FULL = 12000;
const SUGGESTION_TOKEN_BUDGET_DEGRADE = 8000;

/**
 * Pre-flight USD estimate for a first scan. Calibrated from 30d rollups
 * (context ~$0.10–0.48, read ~$0.05, features ~$0.02, invariants ~$0.028/job).
 */
function projectScanCost({ ingestedFileCount = 0, jobCount = 12 } = {}) {
  const files = Math.max(0, Number(ingestedFileCount) || 0);
  const jobs = Math.max(0, Number(jobCount) || 0);

  const context = Math.min(0.5, 0.1 + files * 0.002);
  const features = 0.02;
  const read = 0.05;
  const suggestions = 0.025;
  const mapGap = 0.08;
  // Pre-cap estimate (what we'd spend without the job cap).
  const invariants = Math.min(jobs || 12, 24) * 0.028;

  const breakdown = { context, features, read, suggestions, mapGap, invariants };
  const total =
    breakdown.context +
    breakdown.features +
    breakdown.read +
    breakdown.suggestions +
    breakdown.mapGap +
    breakdown.invariants;

  return {
    total: Math.round(total * 10000) / 10000,
    breakdown,
  };
}

/**
 * Build the degrade / full plan for a Takeoff scan.
 * @returns {object} flags consumed by takeoff stages
 */
function buildTakeoffCostPlan({
  ingestedFileCount = 0,
  jobCount = 12,
  softCeilingUsd = SOFT_CEILING_USD,
} = {}) {
  const projection = projectScanCost({ ingestedFileCount, jobCount });
  const ceiling = Number(softCeilingUsd) > 0 ? Number(softCeilingUsd) : SOFT_CEILING_USD;
  const over = projection.total > ceiling;

  if (!over) {
    return {
      mode: 'full',
      softCeilingUsd: ceiling,
      projectedUsd: projection.total,
      breakdown: projection.breakdown,
      skipAiSuggestions: false,
      useClaudeGapLink: true,
      maxInvariantJobs: FIRST_SCAN_INVARIANT_CAP,
      invariantModel: null,
      context: { ...CONTEXT_FULL },
      suggestionTokenBudget: SUGGESTION_TOKEN_BUDGET_FULL,
    };
  }

  return {
    mode: 'degrade',
    softCeilingUsd: ceiling,
    projectedUsd: projection.total,
    breakdown: projection.breakdown,
    skipAiSuggestions: true,
    useClaudeGapLink: false,
    maxInvariantJobs: FIRST_SCAN_INVARIANT_CAP,
    // Haiku for per-job invariants under soft ceiling (Read stays Sonnet).
    invariantModel: 'haiku',
    context: { ...CONTEXT_DEGRADE },
    suggestionTokenBudget: SUGGESTION_TOKEN_BUDGET_DEGRADE,
  };
}

module.exports = {
  SOFT_CEILING_USD,
  FIRST_SCAN_INVARIANT_CAP,
  CONTEXT_FULL,
  CONTEXT_DEGRADE,
  projectScanCost,
  buildTakeoffCostPlan,
};
