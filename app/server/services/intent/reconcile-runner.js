/**
 * Intent link reconciliation runner — pipeline stage 2 (Phase 5 wiring).
 *
 * Glue between the pure reconcileLinks transform (reconcile-links.js) and the
 * DB: load a project's non-rejected statements, reclassify their links against
 * the freshly re-extracted structure anchors, and persist only the statements
 * whose links actually changed. Link health then lives on the statement rows,
 * so the triage route reads persisted state rather than re-running analysis.
 *
 * Rejected statements are skipped — they're not part of the live spec and we
 * don't want to churn their links.
 */

const { reconcileLinks } = require('./reconcile-links');
const { intentStatements } = require('../../lib/db');

// Stable-ish comparison of a links array so we only write when something moved.
function linksSignature(links) {
  return JSON.stringify(
    (Array.isArray(links) ? links : []).map((l) => [
      l.file_path,
      l.symbol ?? null,
      l.link_status,
      l.suggested_symbol ?? null,
    ])
  );
}

/**
 * @param {string} projectId
 * @param {object} codebaseModel - carries `structureAnchors` (Phase 2).
 * @returns {Promise<{ statements:number, updated:number, triage:number }>}
 */
async function runLinkReconciliation(projectId, codebaseModel) {
  const anchors = (codebaseModel && Array.isArray(codebaseModel.structureAnchors))
    ? codebaseModel.structureAnchors
    : [];

  const all = await intentStatements.findByProjectId(projectId);
  const active = all.filter((s) => s.status !== 'rejected');
  const stats = { statements: active.length, updated: 0, triage: 0 };
  if (active.length === 0) return stats;

  const { statements: reconciled, triage } = reconcileLinks({ anchors, statements: active });
  stats.triage = triage.length;

  const bySig = new Map(active.map((s) => [s.id, linksSignature(s.links)]));
  for (const s of reconciled) {
    if (linksSignature(s.links) === bySig.get(s.id)) continue; // no change
    try {
      await intentStatements.update(s.id, projectId, { links: s.links });
      stats.updated += 1;
    } catch (err) {
      console.error(`[intent.reconcile] persist failed for ${s.id} (non-fatal): ${err.message}`);
    }
  }

  return stats;
}

module.exports = { runLinkReconciliation };
