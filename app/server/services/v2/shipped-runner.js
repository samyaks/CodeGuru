// v2 shipped-runner.
//
// Glue between webhook → matcher → verifier → shipped_items table.
// Called from app/server/routes/github-webhook.js for each push event.

const { suggestions, shippedItems } = require('../../lib/db');
const { toGap } = require('./gap-mapper');
const { matchCommitToGap, MIN_CONFIDENCE } = require('./gap-matcher');
const { verifyGap } = require('./gap-verifier');

function uniqueFiles(commit) {
  const set = new Set();
  for (const f of commit.added || []) set.add(f);
  for (const f of commit.modified || []) set.add(f);
  for (const f of commit.removed || []) set.add(f);
  return [...set];
}

/**
 * Process a single commit from a push payload. Looks for a matching gap, runs
 * the verifier, and records the result. Safe to call without await — failures
 * are logged but never rethrown.
 */
async function processCommit({ project, commit, branch }) {
  try {
    const projectId = project.id;
    if (!commit?.id) return;

    // Avoid double-processing the same commit per project
    const existing = await shippedItems.findByCommit(projectId, commit.id);
    if (existing) return;

    const files = uniqueFiles(commit);
    const enrichedCommit = {
      sha: commit.id,
      message: commit.message || '',
      files,
    };

    // Look for in-progress + untriaged gaps to match against
    const candidateRows = await suggestions.findV2GapsByProjectId(projectId);
    const openGaps = candidateRows
      .filter((r) => r.v2_status === 'in_progress' || r.v2_status === 'untriaged' || r.v2_status === 'shipped')
      .map(toGap);

    const match = matchCommitToGap(enrichedCommit, openGaps);

    // Below threshold → record an item with no gap link, leave verification pending
    if (!match || match.confidence < MIN_CONFIDENCE) {
      await shippedItems.create({
        project_id: projectId,
        gap_id: null,
        commit_sha: commit.id,
        commit_message: enrichedCommit.message,
        branch,
        files_changed: files,
        files_changed_count: files.length,
        verification: 'pending',
        verification_detail: 'No matching gap with sufficient confidence — leave open for manual review.',
        match_confidence: match?.confidence ?? null,
        match_strategy: match?.strategy ?? null,
      });
      return;
    }

    const matchedGap = openGaps.find((g) => g.id === match.gapId);
    if (!matchedGap) return;

    // Run the verifier — falls back to 'pending' on any error.
    let verdict = { verification: 'pending', detail: 'Verifier deferred.' };
    try {
      verdict = await verifyGap({ gap: matchedGap, commit: enrichedCommit });
    } catch (err) {
      console.error(`[v2/shipped-runner] verifyGap threw for ${matchedGap.id}:`, err.message);
    }

    await shippedItems.create({
      project_id: projectId,
      gap_id: matchedGap.id,
      commit_sha: commit.id,
      commit_message: enrichedCommit.message,
      branch,
      files_changed: files,
      files_changed_count: files.length,
      verification: verdict.verification,
      verification_detail: verdict.detail,
      partial_items: verdict.partialItems ?? null,
      match_confidence: match.confidence,
      match_strategy: match.strategy,
    });

    // Update the gap's verification + status to keep Gaps tab in sync.
    if (verdict.verification === 'verified') {
      await suggestions.setV2Status(matchedGap.id, projectId, 'shipped', {
        verification: 'verified',
        committedAt: matchedGap.committedAt || new Date().toISOString(),
      });
    } else if (verdict.verification === 'partial') {
      await suggestions.setV2Status(matchedGap.id, projectId, 'shipped', {
        verification: 'partial',
        committedAt: matchedGap.committedAt || new Date().toISOString(),
      });
    } else {
      await suggestions.setV2Status(matchedGap.id, projectId, 'shipped', {
        verification: 'pending',
        committedAt: matchedGap.committedAt || new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[v2/shipped-runner] processCommit failed:', err.message);
  }
}

/** Process an entire `push` payload. */
async function processPush({ project, payload }) {
  const branch = payload.ref ? payload.ref.replace('refs/heads/', '') : null;
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  for (const commit of commits) {
    // run sequentially so we don't stampede Anthropic on a 50-commit force push
    await processCommit({ project, commit, branch });
  }
}

module.exports = { processPush, processCommit };
