/**
 * Grounding-based confidence for Read claims (not LLM self-score).
 *
 * Mirrors the philosophy of intent/confidence.js: a claim is only as
 * trustworthy as the real code surfaces behind it. Evidence entries that
 * carry file paths we can verify against invariant links or map entities
 * count as "grounded"; everything else is inference.
 *
 * Below UNCERTAIN_THRESHOLD the UI shows the yellow wash and offers the
 * structured alternative ("who's this really for?").
 */

const UNCERTAIN_THRESHOLD = 0.6;

/**
 * Collect every file path we can independently verify: invariant links
 * and product-map entities. Used to decide whether an evidence entry is
 * truly file-grounded rather than a path the model made up.
 */
function knownFilePaths({ map, invariants }) {
  const known = new Set();
  for (const inv of Array.isArray(invariants) ? invariants : []) {
    for (const link of Array.isArray(inv && inv.links) ? inv.links : []) {
      const fp = link && (link.file_path || link.filePath);
      if (fp) known.add(fp);
    }
  }
  for (const ent of Array.isArray(map && map.entities) ? map.entities : []) {
    const fp = ent && (ent.file_path || ent.filePath);
    if (fp) known.add(fp);
  }
  return known;
}

function isGrounded(entry, known) {
  if (!entry) return false;
  const fp = entry.filePath || entry.file_path;
  if (!fp || typeof fp !== 'string') return false;
  // If we have verifiable sources, the path must come from them; if we have
  // none at all (thin map, no invariants) a concrete path is the best we get.
  return known.size === 0 ? true : known.has(fp);
}

/**
 * Score a single Read claim. Pure and deterministic.
 *
 * @param {object} opts
 * @param {'objective'|'audience'|'core_job'} opts.slot
 * @param {Array<{filePath: string|null, symbol: string|null, note: string}>} opts.evidence
 * @param {object|null} opts.map - product map (entities may carry file_path)
 * @param {Array} opts.invariants - intent statements with links [{file_path, symbol}]
 * @returns {number} 0..1
 */
function scoreClaimConfidence({ slot, evidence, map, invariants }) {
  const entries = Array.isArray(evidence) ? evidence : [];
  const known = knownFilePaths({ map, invariants });
  const grounded = entries.filter((e) => isGrounded(e, known)).length;

  if (grounded >= 2) return 0.85;
  if (grounded === 1) return 0.7;

  // The "yellow highlighter" zone: an audience claim inferred from persona
  // names alone. Code rarely proves who it's for — absence isn't proof.
  if (slot === 'audience' && entries.length > 0) return 0.4;

  return 0.3;
}

module.exports = {
  scoreClaimConfidence,
  knownFilePaths,
  UNCERTAIN_THRESHOLD,
};
