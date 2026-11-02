/**
 * Intent loop V1 — verify a slice against pushes (owner: Agent D).
 *
 * Order on every push to slice.branch:
 *   1. checkProtectedPaths — pure glob intersection, no LLM. Advisory warning.
 *   2. per feature criterion: rule pre-check → Claude classification over the
 *      combined patch → met | unmet | unknown + one-line evidence.
 *   3. regression criteria: met if none of the feature's files changed,
 *      unknown (with the touched files as evidence) if they did. Never LLM.
 * Never flips met → unmet without an owner override.
 *
 * Contract: docs/specs/intent-driven-building.md → Agent D.
 */

const { NotImplementedError } = require('../../lib/slice-types');

/**
 * Files in the push that match slice.protected_paths. Ignores .intent/** and
 * the synced rules file. Pure.
 * @param {{ slice: import('../../lib/slice-types').Slice, commits: Array<{ added?: string[], modified?: string[], removed?: string[] }> }} args
 * @returns {string[]}
 */
function checkProtectedPaths(args) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-verifier.checkProtectedPaths');
}

/**
 * @param {{ slice: import('../../lib/slice-types').Slice, project: Object, commits: Array<Object> }} args
 * @returns {Promise<{ criteria: import('../../lib/slice-types').AcceptanceCriterion[], allMet: boolean, guardrailTouched: string[] }>}
 */
async function verifySliceAgainstCommits(args) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-verifier.verifySliceAgainstCommits');
}

/**
 * Webhook hook. Called by services/v2/shipped-runner.processPush after the
 * existing gap work, wrapped so a failure here never breaks gap processing.
 * No-op when the project has no open slice or the push is to another branch.
 * @param {{ project: Object, commits: Array<Object>, branch: string }} args
 * @returns {Promise<void>}
 */
async function onPush(args) { // eslint-disable-line no-unused-vars
  // Stub is a deliberate no-op (not a throw) so the webhook path stays green
  // until Agent D lands.
}

module.exports = { checkProtectedPaths, verifySliceAgainstCommits, onPush };
