// Intent substrate pipeline orchestrator.
//
// Wave 0 scaffolding: a single entry point that takeoff.js calls once at the
// tail of runPipeline. Later phases fill in the stages WITHOUT editing
// takeoff.js again:
//   - Phase 3: bootstrap candidate intent statements from structure anchors.
//   - Phase 5: reconcile intent_code_links against re-extracted anchors.
//   - Phase 6: two-tier satisfaction re-check + gaps-as-views refresh.
//
// Called non-blocking from takeoff's runPipeline tail, so every stage must be
// individually non-fatal: a failure logs and the pipeline resolves.

const { bootstrapIntent } = require('./bootstrap');
const { runGrouping } = require('./grouping');
const { runLinkReconciliation } = require('./reconcile-runner');
const { runSatisfactionRecheck } = require('./satisfaction');

/**
 * Run the intent substrate stages for a project after analysis.
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - the model returned by analyzeRepo/analyzeFromFiles,
 *   carrying `structureAnchors` (Phase 2) and the in-memory `fileContents` map.
 * @returns {Promise<{ ran: boolean, bootstrap?: object, grouping?: object, reconcile?: object, satisfaction?: object }>}
 */
async function runIntentPipeline(projectId, codebaseModel) {
  // Stage 1: bootstrap candidate intent statements from structure anchors.
  let bootstrap = null;
  try {
    bootstrap = await bootstrapIntent(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] bootstrap failed for ${projectId} (non-fatal): ${err.message}`);
  }

  // Stage 1b: assign coarse, product-level group labels so the Context tab
  // shows a handful of meaningful areas instead of dozens of file-named ones.
  let grouping = null;
  try {
    grouping = await runGrouping(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] grouping failed for ${projectId} (non-fatal): ${err.message}`);
  }

  // Stage 2: reconcile existing links against the fresh anchors (self-heal
  // moves, flag renames/deletions). Persists link health for the triage view.
  let reconcile = null;
  try {
    reconcile = await runLinkReconciliation(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] link reconciliation failed for ${projectId} (non-fatal): ${err.message}`);
  }

  // Stage 3: two-tier satisfaction re-check for confirmed statements (free hash
  // compare first; bounded LLM only where linked code changed).
  let satisfaction = null;
  try {
    satisfaction = await runSatisfactionRecheck(projectId);
  } catch (err) {
    console.error(`[intent.pipeline] satisfaction recheck failed for ${projectId} (non-fatal): ${err.message}`);
  }

  return { ran: true, bootstrap, grouping, reconcile, satisfaction };
}

module.exports = { runIntentPipeline };
