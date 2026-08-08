// "The Read" orchestrator.
//
// Loads everything the read needs from the DB (product map, invariants,
// readiness, gaps, security findings), asks synthesize-read.js for the three
// claims, persists them (settled — human-corrected — claims are never
// touched), then derives the "next thing to build" from the settled view and
// persists it on project_reads.
//
// Called non-blocking from takeoff's pipeline tail — every stage is
// individually non-fatal, mirroring services/intent/pipeline.js.

const {
  deployments,
  productMap,
  intentStatements,
  statementJobs,
  suggestions,
  projectReads,
  readClaims,
} = require('../../lib/db');

const TOP_INVARIANTS = 10;

// synthesize-read.js, next-thing.js, code-slice.js and pick-core-job.js are
// required lazily INSIDE the functions below (not at module top-level) so
// this module — and everything that requires it (routes, takeoff pipeline) —
// still loads while those files are being built in a parallel workstream.
function loadSynthesizeRead() {
  return require('./synthesize-read').synthesizeRead;
}

function loadDeriveNextThing() {
  return require('./next-thing').deriveNextThing;
}

function loadBuildCodeSlice() {
  return require('./code-slice').buildCodeSlice;
}

function loadPickCoreJob() {
  return require('./pick-core-job').pickCoreJob;
}

// Everything both synthesis stages read from the DB, fetched once.
//
// withCodeSlice: the source slice only feeds claim synthesis, so
// rederiveNext (which reuses these inputs purely for next-thing derivation)
// leaves it off and skips that load entirely.
async function loadReadInputs(projectId, { codebaseModel = null, withCodeSlice = false } = {}) {
  const project = await deployments.findById(projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  let map = null;
  try {
    map = await productMap.getMapByProject(projectId);
  } catch (err) {
    console.error(`[read] product map load for ${projectId} failed (continuing without map): ${err.message}`);
  }

  // Top job-scoped invariants by confidence — the strongest grounded signals
  // about what the app actually does. Raw statement rows carry no job ids
  // (associations live in statement_jobs), so we attach `job_ids` here —
  // pick-core-job.js prefers explicit ids over its title-matching fallback.
  let invariants = [];
  try {
    const rows = await intentStatements.findByProjectId(projectId, { archived: false });
    let jobIdsByStatement = new Map();
    try {
      const links = await statementJobs.findLinksForProject(projectId);
      jobIdsByStatement = links.reduce((acc, l) => {
        if (!acc.has(l.statement_id)) acc.set(l.statement_id, []);
        acc.get(l.statement_id).push(l.job_id);
        return acc;
      }, new Map());
    } catch (err) {
      console.error(`[read] statement-job link load for ${projectId} failed (falling back to title matching): ${err.message}`);
    }
    invariants = rows
      .filter((r) => r.scope === 'job')
      .map((r) => ({ ...r, job_ids: jobIdsByStatement.get(r.id) || [] }))
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, TOP_INVARIANTS);
  } catch (err) {
    console.error(`[read] invariant load for ${projectId} failed (continuing without invariants): ${err.message}`);
  }

  let securityFindings = [];
  try {
    securityFindings = await suggestions.findV2SecurityGapsByProjectId(projectId);
  } catch (err) {
    console.error(`[read] security findings load for ${projectId} failed (continuing without them): ${err.message}`);
  }

  // Human-settled claims — synthesis treats them as ground truth (and
  // upsertDraft refuses to overwrite them regardless).
  let settledClaims = [];
  try {
    const claimRows = await readClaims.findByProjectId(projectId);
    settledClaims = claimRows
      .filter((r) => r.status === 'settled')
      .map((r) => ({ slot: r.slot, text: r.text }));
  } catch (err) {
    console.error(`[read] settled claim load for ${projectId} failed (continuing without them): ${err.message}`);
  }

  // Deterministic core-job pick for the core_job claim.
  let coreJobCandidate = null;
  try {
    const pickCoreJob = loadPickCoreJob();
    coreJobCandidate = pickCoreJob({ map, invariants }) || null;
  } catch (err) {
    console.error(`[read] core-job pick for ${projectId} failed (continuing without it): ${err.message}`);
  }

  // Source-code slice that grounds the synthesis prompt in real files.
  let codeSlice = null;
  if (withCodeSlice) {
    try {
      const buildCodeSlice = loadBuildCodeSlice();
      codeSlice = await buildCodeSlice(projectId, { codebaseModel });
    } catch (err) {
      console.error(`[read] code slice for ${projectId} failed (continuing without it): ${err.message}`);
    }
  }

  const analysisData = project.analysis_data || {};
  const fileTree = analysisData.fileTree;

  return {
    projectId,
    map,
    invariants,
    featuresSummary: project.features_summary || null,
    repoDescription: project.description || null,
    fileCount: Array.isArray(fileTree) ? fileTree.length : null,
    stack: project.stack_info || null,
    readiness: {
      score: project.readiness_score ?? null,
      categories: project.readiness_categories || null,
    },
    gaps: Array.isArray(analysisData.gaps) ? analysisData.gaps : [],
    securityFindings,
    codeSlice,
    settledClaims,
    coreJobCandidate,
  };
}

// The settled view of the claims: what the human corrected where they did,
// the machine draft everywhere else. This is what next-thing derivation
// conditions on.
function toSettledClaims(claimRows) {
  return claimRows.map((row) => ({
    slot: row.slot,
    text: row.text,
    source: row.source,
  }));
}

/**
 * Full read pipeline: synthesize claims -> persist (settled rows untouched)
 * -> derive next thing -> persist. Non-fatal at every step.
 *
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - analyzer output, handed to buildCodeSlice
 *   as an in-memory shortcut; the slice falls back to persisted analysis
 *   state when it's absent (regenerate without a fresh analysis)
 */
async function runRead(projectId, codebaseModel) {
  let inputs;
  try {
    inputs = await loadReadInputs(projectId, { codebaseModel, withCodeSlice: true });
  } catch (err) {
    console.error(`[read] input load for ${projectId} failed (aborting read): ${err.message}`);
    return { ran: false };
  }

  // Stage 1: synthesize + persist the three claims.
  let claimsPersisted = 0;
  try {
    const synthesizeRead = loadSynthesizeRead();
    const { claims } = await synthesizeRead(inputs, {});
    for (const claim of claims || []) {
      const row = await readClaims.upsertDraft(projectId, claim);
      if (row) claimsPersisted += 1; // null => slot is settled, left untouched
    }
  } catch (err) {
    console.error(`[read] claim synthesis for ${projectId} failed (non-fatal): ${err.message}`);
  }

  // Stage 2: derive the next thing from ALL current claims (settled ones
  // carry their human text).
  let next = null;
  try {
    const claimRows = await readClaims.findByProjectId(projectId);
    const deriveNextThing = loadDeriveNextThing();
    next = await deriveNextThing(inputs, toSettledClaims(claimRows), {});
  } catch (err) {
    console.error(`[read] next-thing derivation for ${projectId} failed (non-fatal): ${err.message}`);
  }

  // Stage 3: persist. If derivation failed, still make sure a project_reads
  // row exists (so GET stops 404ing once claims are drafted) — but don't
  // clobber a previous run's next-thing with nulls.
  try {
    if (next) {
      await projectReads.upsertForProject(projectId, {
        nextTitle: next.title,
        nextWhy: next.why,
        nextPrompt: next.prompt,
        nextCategory: next.category,
        draftedAt: new Date().toISOString(),
      });
    } else {
      const existing = await projectReads.findByProjectId(projectId);
      if (!existing) {
        await projectReads.upsertForProject(projectId, { draftedAt: new Date().toISOString() });
      }
    }
  } catch (err) {
    console.error(`[read] persist for ${projectId} failed (non-fatal): ${err.message}`);
  }

  return { ran: true, claimsPersisted, hasNext: !!next };
}

/**
 * Re-derive ONLY the next thing (after a claim correction). Reloads inputs +
 * current claims and updates project_reads.next_*. Errors propagate — the
 * PATCH route catches them and flags the response `nextStale` instead of
 * failing the settle.
 */
async function rederiveNext(projectId) {
  const inputs = await loadReadInputs(projectId);
  const claimRows = await readClaims.findByProjectId(projectId);
  const deriveNextThing = loadDeriveNextThing();
  const next = await deriveNextThing(inputs, toSettledClaims(claimRows), {});
  await projectReads.updateNext(projectId, {
    nextTitle: next.title,
    nextWhy: next.why,
    nextPrompt: next.prompt,
    nextCategory: next.category,
  });
  return next;
}

module.exports = { runRead, rederiveNext };
