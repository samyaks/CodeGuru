/**
 * Intent loop V1 — slice deriver (owner: Agent A).
 *
 * Turns a source (the Read's next thing, a gap, or what the owner typed) into
 * a DerivedSlice: objective, what already exists, guardrails, protected paths
 * and acceptance criteria. One Claude call via lib/anthropic-tracked; falls
 * back to a rule-based slice after two parse failures.
 *
 * Contract: docs/specs/intent-driven-building.md → Agent A.
 */

const { NotImplementedError } = require('../../lib/slice-types');

/**
 * @param {Object} inputs
 * @param {Object} inputs.project            deployments row
 * @param {Object|null} inputs.read          project_reads row + settled claims (as read.js builds it)
 * @param {Object|null} [inputs.gap]         gap row when source.kind === 'gap'
 * @param {string|null} [inputs.manualText]  owner's text when source.kind === 'manual'
 * @param {Object|null} inputs.stack         detected stack from the analysis
 * @param {Array} inputs.settledClaims
 * @param {Array} inputs.workingFeatures     map areas that are shipped/working, with their files
 * @param {Object} [opts]
 * @param {string} [opts.analysisId]         for anthropic-tracked cost attribution
 * @returns {Promise<import('../../lib/slice-types').DerivedSlice>}
 */
async function deriveSlice(inputs, opts = {}) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-deriver.deriveSlice');
}

module.exports = { deriveSlice };
