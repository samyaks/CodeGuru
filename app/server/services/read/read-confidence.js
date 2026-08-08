/**
 * Grounding-based confidence for Read claims (not LLM self-score).
 *
 * Evidence entries are verified against the REAL analyzed file list
 * (buildCodeSlice().knownPaths) plus invariant links; a claim is only as
 * trustworthy as the verified code surfaces behind it. Pure module — no DB,
 * no LLM.
 *
 * Below UNCERTAIN_THRESHOLD the UI shows the yellow wash and offers the
 * structured alternative ("who's this really for?").
 */

const UNCERTAIN_THRESHOLD = 0.6;

function normalizePath(p) {
  if (typeof p !== 'string') return null;
  const trimmed = p.trim().replace(/^\.\//, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Exact match, or suffix leniency for basename-style citations: either side
 * ending with '/' + the other counts. A bare basename that matches multiple
 * known paths still verifies (any match is enough).
 */
function pathMatches(filePath, knownList) {
  for (const known of knownList) {
    if (known === filePath) return true;
    if (known.endsWith('/' + filePath)) return true;
    if (filePath.endsWith('/' + known)) return true;
  }
  return false;
}

/**
 * Mark each evidence entry verified/unverified against real analyzed paths.
 *
 * @param {Array<{filePath: string|null, symbol: string|null, note: string}>} evidence
 * @param {object} ctx
 * @param {string[]} ctx.knownPaths - from buildCodeSlice().knownPaths
 * @param {Array} [ctx.invariantLinks] - [{ filePath, symbol }] from invariant
 *   links (also count as known; file_path key accepted too)
 * @returns {Array} same entries, each gaining `verified: boolean`
 */
function verifyEvidence(evidence, ctx) {
  const entries = Array.isArray(evidence) ? evidence : [];
  const { knownPaths, invariantLinks } = ctx || {};

  const knownSet = new Set();
  for (const p of Array.isArray(knownPaths) ? knownPaths : []) {
    const norm = normalizePath(p);
    if (norm) knownSet.add(norm);
  }
  for (const link of Array.isArray(invariantLinks) ? invariantLinks : []) {
    const norm = normalizePath(link && (link.filePath || link.file_path));
    if (norm) knownSet.add(norm);
  }
  const knownList = [...knownSet];

  return entries.map((entry) => {
    const fp = normalizePath(entry && (entry.filePath || entry.file_path));
    const verified = fp != null && pathMatches(fp, knownList);
    return { ...entry, verified };
  });
}

/**
 * Pure deterministic confidence from verified evidence.
 *
 * @param {{ slot: 'objective'|'audience'|'core_job', evidence: Array<{verified?: boolean, filePath?: string|null}> }} opts
 * @returns {number} 0..1
 */
function scoreClaimConfidence({ slot, evidence }) {
  const entries = Array.isArray(evidence) ? evidence : [];
  const verified = entries.filter((e) => e && e.verified === true).length;

  if (verified >= 2) return 0.9;
  if (verified === 1) return 0.72;

  // The "yellow highlighter" zone: an audience claim with only unverified
  // evidence. Code rarely proves who it's for — absence isn't proof.
  if (slot === 'audience' && entries.length > 0) return 0.4;

  return 0.3;
}

module.exports = {
  verifyEvidence,
  scoreClaimConfidence,
  UNCERTAIN_THRESHOLD,
};
