// Intent substrate pipeline orchestrator.
//
// Job/invariant model (v2):
//   1. Reconcile which jobs need regeneration (hash-gated on re-analysis).
//   2. Job-conditioned invariant generation (findings-first, analysis-time).
//   3. Global guarantees sweep (security/infra cross-cutting).
//   4. Link reconciliation against fresh anchors.
//   5. Satisfaction re-check for confirmed statements.
//
// Called non-blocking from takeoff's runPipeline tail — every stage is
// individually non-fatal.

const { reconcileIntentOnReanalysis } = require('./reconcile-analysis');
const { runJobInvariantGeneration } = require('./generate-invariants');
const { runGlobalGuarantees } = require('./global-guarantees');
const { runLinkReconciliation } = require('./reconcile-runner');
const { runSatisfactionRecheck } = require('./satisfaction');

/**
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - analyzer output with structureAnchors + fileContents
 */
async function runIntentPipeline(projectId, codebaseModel) {
  let reconciliation = null;
  try {
    reconciliation = await reconcileIntentOnReanalysis(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] reconciliation failed for ${projectId} (non-fatal): ${err.message}`);
  }

  let generation = null;
  const skipGen = reconciliation && reconciliation.unchanged;
  if (!skipGen) {
    try {
      generation = await runJobInvariantGeneration(projectId, codebaseModel, {
        jobIds: reconciliation && reconciliation.jobsToRegenerate,
      });
    } catch (err) {
      console.error(`[intent.pipeline] job invariant generation failed for ${projectId} (non-fatal): ${err.message}`);
    }
  } else {
    generation = { skipped: true, reason: 'unchanged' };
  }

  let globals = null;
  try {
    globals = await runGlobalGuarantees(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] global guarantees failed for ${projectId} (non-fatal): ${err.message}`);
  }

  let reconcile = null;
  try {
    reconcile = await runLinkReconciliation(projectId, codebaseModel);
  } catch (err) {
    console.error(`[intent.pipeline] link reconciliation failed for ${projectId} (non-fatal): ${err.message}`);
  }

  let satisfaction = null;
  try {
    satisfaction = await runSatisfactionRecheck(projectId);
  } catch (err) {
    console.error(`[intent.pipeline] satisfaction recheck failed for ${projectId} (non-fatal): ${err.message}`);
  }

  return {
    ran: true,
    reconciliation,
    generation,
    globals,
    reconcile,
    satisfaction,
  };
}

module.exports = { runIntentPipeline };
