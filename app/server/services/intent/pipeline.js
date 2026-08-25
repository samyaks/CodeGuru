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

const { CLAUDE_MODEL, HAIKU_MODEL } = require('../../lib/constants');
const { FIRST_SCAN_INVARIANT_CAP } = require('../../lib/cost-budget');
const { reconcileIntentOnReanalysis } = require('./reconcile-analysis');
const { runJobInvariantGeneration } = require('./generate-invariants');
const { runGlobalGuarantees } = require('./global-guarantees');
const { runLinkReconciliation } = require('./reconcile-runner');
const { runSatisfactionRecheck } = require('./satisfaction');

/**
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - analyzer output with structureAnchors + fileContents
 * @param {{ maxInvariantJobs?: number, invariantModel?: 'haiku'|null }} [opts]
 */
async function runIntentPipeline(projectId, codebaseModel, opts = {}) {
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
      const model =
        opts.invariantModel === 'haiku' ? HAIKU_MODEL : (opts.model || CLAUDE_MODEL);
      const maxJobs = Number.isFinite(opts.maxInvariantJobs)
        ? opts.maxInvariantJobs
        : FIRST_SCAN_INVARIANT_CAP;
      // When reconcile returns an explicit jobsToRegenerate list, honor it and
      // do not re-apply the first-scan cap (partial re-analysis).
      const jobIds = reconciliation && reconciliation.jobsToRegenerate;
      generation = await runJobInvariantGeneration(projectId, codebaseModel, {
        jobIds,
        maxJobs: Array.isArray(jobIds) && jobIds.length > 0 ? undefined : maxJobs,
        model,
      });
      if (generation && Array.isArray(generation.deferredJobIds) && generation.deferredJobIds.length > 0) {
        console.log(JSON.stringify({
          event: 'intent_invariants_capped',
          projectId,
          generatedJobs: generation.jobs,
          deferredJobs: generation.deferredJobIds.length,
          model,
          timestamp: new Date().toISOString(),
        }));
      }
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
