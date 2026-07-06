/**
 * Grounding-based confidence for invariants (not LLM self-score).
 *
 * Used to decide which invariants auto-confirm when a parent job is confirmed
 * (cascade) and which land in the explicit review queue.
 */

const AUTO_CONFIRM_THRESHOLD = 0.8;

/**
 * @param {object} opts
 * @param {Array} opts.links - statement links [{ file_path, symbol, link_status }]
 * @param {boolean|null} opts.satisfied - inline holds/broken from generation
 * @param {boolean} [opts.detectorBacked] - emitted from a security detector
 * @param {number|null} [opts.llmConfidence] - optional model score (tiebreaker only)
 * @returns {number} 0..1
 */
function scoreInvariantConfidence({ links, satisfied, detectorBacked, llmConfidence }) {
  if (detectorBacked) return 1.0;

  const linkList = Array.isArray(links) ? links : [];
  const healthy = linkList.filter((l) => l && l.link_status !== 'broken' && l.link_status !== 'needs_relink');
  const broken = linkList.some((l) => l && (l.link_status === 'broken' || l.link_status === 'needs_relink'));

  let score = 0.5;
  if (linkList.length === 1 && healthy.length === 1) score = 0.85;
  else if (linkList.length > 1 && !broken) score = 0.65;
  else if (broken) score = 0.35;
  else if (linkList.length === 0) score = 0.3;

  // Broken code surface lowers confidence even when links look fine.
  if (satisfied === false) score = Math.min(score, 0.4);
  if (satisfied === true) score = Math.max(score, 0.75);

  // LLM self-score is a small nudge only.
  if (typeof llmConfidence === 'number' && !Number.isNaN(llmConfidence)) {
    const clamped = Math.max(0, Math.min(1, llmConfidence));
    score = score * 0.85 + clamped * 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

function isAutoConfirmEligible(confidence) {
  return typeof confidence === 'number' && confidence >= AUTO_CONFIRM_THRESHOLD;
}

module.exports = {
  scoreInvariantConfidence,
  isAutoConfirmEligible,
  AUTO_CONFIRM_THRESHOLD,
};
