/**
 * Intent satisfaction re-check — pipeline stage 3 (Phase 6).
 *
 * A confirmed statement carries a `code_hash` baseline (frozen at confirm time
 * over its linked files). On each analysis we re-check whether the code still
 * satisfies the statement using a cheap two-tier strategy:
 *
 *   Tier 1 (free): re-hash the current linked-file contents. If the hash is
 *     unchanged, the code the statement points at hasn't moved — leave
 *     `satisfied` as-is and just bump `last_checked_at`. NO LLM call.
 *   Tier 2 (bounded LLM, only when the hash changed): ask a small model whether
 *     the current linked source still upholds the statement, and record the
 *     verdict + the new baseline hash.
 *
 * This keeps steady-state re-analyses free of LLM cost and only spends tokens
 * where code that a confirmed intent depends on actually changed.
 *
 * Boundaries: reads confirmed statements + persisted file contents, writes only
 * satisfaction fields through the intentStatements repository.
 */

const crypto = require('crypto');
const { HAIKU_MODEL, anthropic, truncate } = require('../../lib/constants');
const { createMessageTracked } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { intentStatements, analysisFiles } = require('../../lib/db');

const SATISFACTION_SOURCE_BUDGET = 8000;
const PER_FILE_SOURCE_CAP = 4000;

/**
 * sha256 over the CURRENT contents of a statement's linked files. Dedupes by
 * file_path and hashes each file once in sorted order, matching the confirm-time
 * baseline in routes/v2/intent.js (which re-uses this function). Returns null
 * when no linked content is available (nothing to check against).
 */
function hashLinkedFiles(contents, links) {
  const paths = [
    ...new Set(
      (Array.isArray(links) ? links : [])
        .map((l) => l && l.file_path)
        .filter((p) => typeof p === 'string' && p.length > 0)
    ),
  ].sort();
  if (paths.length === 0) return null;

  const hash = crypto.createHash('sha256');
  let hashedAny = false;
  for (const p of paths) {
    const content = contents ? contents[p] : undefined;
    if (typeof content !== 'string') continue;
    hash.update(p);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
    hashedAny = true;
  }
  return hashedAny ? hash.digest('hex') : null;
}

// Assemble a bounded source block for the linked files, honoring per-file and
// total budgets. Skips paths with no captured content.
function buildLinkedSource(contents, links) {
  const paths = [
    ...new Set(
      (Array.isArray(links) ? links : [])
        .map((l) => l && l.file_path)
        .filter((p) => typeof p === 'string' && p.length > 0)
    ),
  ].sort();

  const parts = [];
  let used = 0;
  for (const p of paths) {
    if (used >= SATISFACTION_SOURCE_BUDGET) break;
    const content = contents ? contents[p] : undefined;
    if (typeof content !== 'string' || !content) continue;
    const cap = Math.min(PER_FILE_SOURCE_CAP, SATISFACTION_SOURCE_BUDGET - used);
    const snippet = truncate(content, cap);
    parts.push(`--- ${p} ---\n${snippet}`);
    used += snippet.length;
  }
  return parts.join('\n\n');
}

const SYSTEM_PROMPT = `You verify whether a codebase still upholds a specific intent statement.
You are given ONE confirmed intent statement (a testable behavior, constraint,
or non-goal) and the current source of the files it is linked to.

Decide whether the linked code still satisfies the statement.
- "satisfied": true  — the code still implements/upholds the statement.
- "satisfied": false — the code changed such that the statement no longer holds
  (the behavior was removed, the constraint is now violated, etc).

When unsure, lean toward "satisfied": true — only report false when the code
clearly contradicts or no longer implements the statement.

Respond with ONLY a JSON object (no prose, no markdown fences):
{ "satisfied": true | false, "reason": "one short sentence" }`;

/**
 * Ask the model whether the current linked source still satisfies the statement.
 * Returns { satisfied: boolean, reason: string }. Throws on API/parse failure so
 * the caller can leave the statement's prior verdict untouched.
 */
async function checkStatementSatisfied(projectId, statement, contents) {
  const source = buildLinkedSource(contents, statement.links);
  const userContent = [
    `Intent statement (kind: ${statement.kind}):`,
    statement.text,
    '',
    'Current source of the linked files:',
    source || '(no source available)',
  ].join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.satisfaction',
    params: {
      model: HAIKU_MODEL,
      max_tokens: 300,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });

  const rawText = response.content?.[0]?.text || '';
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!parsed || typeof parsed.satisfied !== 'boolean') {
    throw new Error('model response missing boolean `satisfied`');
  }
  return { satisfied: parsed.satisfied, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
}

/**
 * Re-check satisfaction for every confirmed statement in a project.
 *
 * @param {string} projectId
 * @param {object} [opts]
 * @param {object} [opts.contents] - path->content map. Defaults to the project's
 *   persisted analysis_files (same basis as the confirm-time baseline).
 * @param {function} [opts.llmCheck] - override for the LLM verdict (tests inject
 *   a stub); defaults to checkStatementSatisfied.
 * @returns {Promise<{ confirmed:number, unchanged:number, rechecked:number, drifted:number, llmCalls:number }>}
 */
async function runSatisfactionRecheck(projectId, opts = {}) {
  const confirmed = await intentStatements.findConfirmedByProjectId(projectId);
  const stats = { confirmed: confirmed.length, unchanged: 0, rechecked: 0, drifted: 0, llmCalls: 0 };
  if (confirmed.length === 0) return stats;

  const contents = opts.contents || (await analysisFiles.getContentsMap(projectId));
  const llmCheck = opts.llmCheck || checkStatementSatisfied;
  const now = () => new Date().toISOString();

  for (const s of confirmed) {
    const links = Array.isArray(s.links) ? s.links : [];
    const freshHash = hashLinkedFiles(contents, links);

    // Nothing linked / no captured content: can't verify. Keep prior verdict,
    // just record that we looked.
    if (freshHash === null) {
      await intentStatements.setSatisfaction(s.id, projectId, {
        codeHash: s.code_hash ?? null,
        satisfied: s.satisfied,
        lastCheckedAt: now(),
      });
      continue;
    }

    // Tier 1: hash unchanged -> the linked code didn't move. No LLM.
    if (freshHash === s.code_hash) {
      stats.unchanged += 1;
      await intentStatements.setSatisfaction(s.id, projectId, {
        codeHash: freshHash,
        // A confirmed statement whose code is unchanged is satisfied by
        // definition; normalize a null baseline to true.
        satisfied: s.satisfied == null ? true : s.satisfied,
        lastCheckedAt: now(),
      });
      continue;
    }

    // Tier 2: code changed -> spend one bounded LLM call for a verdict.
    let verdict;
    try {
      verdict = await llmCheck(projectId, s, contents);
      stats.llmCalls += 1;
    } catch (err) {
      console.error(`[intent.satisfaction] recheck failed for ${s.id} (non-fatal): ${err.message}`);
      // Leave the prior verdict and baseline untouched so a transient failure
      // doesn't flip a statement into a false gap.
      continue;
    }

    stats.rechecked += 1;
    if (!verdict.satisfied) stats.drifted += 1;
    await intentStatements.setSatisfaction(s.id, projectId, {
      codeHash: freshHash,
      satisfied: verdict.satisfied,
      lastCheckedAt: now(),
    });
  }

  return stats;
}

module.exports = { hashLinkedFiles, buildLinkedSource, checkStatementSatisfied, runSatisfactionRecheck };
