// Invariants-on-demand for The Read.
//
// Old projects analyzed before the intent pipeline existed have no
// invariants, so their reads are ungrounded. Before regenerating a read we
// generate job invariants from persisted state — but only when the project
// has none, has a product map with jobs, and has stored file contents to
// ground on. Best-effort by contract: this never throws.

const { intentStatements, productMap, analysisFiles } = require('../../lib/db');
const { extractStructureAnchors } = require('../structure-extractor');

// Same guard the analyzer uses (safeStructureAnchors): a parser failure must
// never block generation — an empty anchor list is always acceptable.
function safeStructureAnchors(fileContents, fileTree) {
  try {
    return extractStructureAnchors(fileContents, fileTree);
  } catch (err) {
    console.error('[ensure-invariants] extractStructureAnchors failed:', err?.message || err);
    return [];
  }
}

/**
 * Generate job invariants on demand when a project has none.
 * No-ops (generated:false) when: invariants already exist, or no product map,
 * or no stored file contents to ground on.
 *
 * On success (and on the no-contents path where the model was built) the
 * result also carries `model`: the rehydrated minimal codebaseModel
 * ({ fileContents, structureAnchors, fileTree }) so callers can thread it
 * into runRead without re-fetching.
 *
 * @param {string} projectId
 * @returns {Promise<{ generated: boolean, count: number, reason: string, model?: object }>}
 */
async function ensureInvariants(projectId) {
  try {
    // Any non-archived statement (job OR global scope) counts as "exists".
    const existing = await intentStatements.findByProjectId(projectId, { archived: false });
    if (Array.isArray(existing) && existing.length > 0) {
      return { generated: false, count: 0, reason: 'invariants already exist' };
    }

    const map = await productMap.getMapByProject(projectId);
    if (!map || !Array.isArray(map.jobs) || map.jobs.length === 0) {
      return { generated: false, count: 0, reason: 'no product map with jobs' };
    }

    // Full-tier content only — skeletons aren't real code and would poison
    // anchor extraction. (analysis id == project id)
    const fileContents = await analysisFiles.getContentsMap(projectId, { includeSkeletons: false });
    if (!fileContents || Object.keys(fileContents).length === 0) {
      return { generated: false, count: 0, reason: 'no stored file contents to ground on' };
    }

    const fileTree = Object.keys(fileContents);
    const model = {
      fileContents,
      structureAnchors: safeStructureAnchors(fileContents, fileTree),
      fileTree,
    };

    // Lazy require: generate-invariants pulls in the Anthropic client stack,
    // which the no-op gates above never need.
    const { runJobInvariantGeneration } = require('../intent/generate-invariants');
    const result = await runJobInvariantGeneration(projectId, model, {});

    const count = result.persisted || 0;
    return {
      generated: !!result.generated,
      count,
      reason: result.generated
        ? `generated ${count} invariant${count === 1 ? '' : 's'} across ${result.jobs} job${result.jobs === 1 ? '' : 's'}`
        : (result.reason || 'generation produced no invariants'),
      model,
    };
  } catch (err) {
    return { generated: false, count: 0, reason: err.message };
  }
}

module.exports = { ensureInvariants };
