/**
 * Security score computation for the v2 Project model.
 *
 * Scoring is a deliberate parallel — but NOT a duplicate — of the
 * Readiness scorer. Both are 0–100 with higher = better, both surface
 * in the project header, and both recompute at the end of the takeoff
 * pipeline. The difference: Readiness measures what's BUILT; Security
 * measures what's RISKY. A project can be 100/100 ready and 40/100
 * secure if it ships every category but exposes secrets.
 *
 * Algorithm:
 *   start at 100, subtract weighted penalties per UNADDRESSED security
 *   gap, floor at 0.
 *
 *   critical = -15, high = -8, medium = -4, low = -1
 *
 * "Unaddressed" = `v2_status` in {'untriaged', 'in_progress'}. Rejected
 * gaps don't count (the user explicitly waved them off) and shipped
 * gaps don't count (the user fixed them, possibly with verification
 * still pending — that's the next iteration's problem).
 *
 * The weights are intentionally aggressive at the top end: a single
 * critical drops the project below 90 (the green/yellow boundary in
 * the v2 readiness UI), which is the right signal for "do not deploy."
 * Tuning these is a UX decision, not a math one — keep them in this
 * file so the call site never has to know.
 */

const SEVERITY_PENALTY = Object.freeze({
  critical: 15,
  high: 8,
  medium: 4,
  low: 1,
});

const SEVERITY_LEVELS = Object.freeze(['critical', 'high', 'medium', 'low']);

/**
 * Compute a security score and severity breakdown from a flat array of
 * gap rows (or in-memory finding objects). Each input must expose
 * either `security_severity` (DB column shape) or `severity` (in-memory
 * detector finding shape) — we accept both so the same function works
 * in the audit-self path (no DB) and in the pipeline (post-persist).
 *
 * Returns:
 *   {
 *     score: number,                     // 0..100
 *     severityBreakdown: { critical, high, medium, low },
 *     totalUnaddressed: number,
 *   }
 */
function computeSecurityScore(securityGaps) {
  const breakdown = { critical: 0, high: 0, medium: 0, low: 0 };
  let penalty = 0;

  if (Array.isArray(securityGaps)) {
    for (const gap of securityGaps) {
      const severity = String(gap?.security_severity || gap?.severity || '').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(SEVERITY_PENALTY, severity)) {
        // Unknown / null severity: skip silently. The DB constraint
        // prevents this on persisted rows, but in-memory findings can
        // still arrive malformed if a detector misbehaves — and we'd
        // rather report a slightly-too-high score than crash the
        // pipeline because of one bad detector.
        continue;
      }
      breakdown[severity] += 1;
      penalty += SEVERITY_PENALTY[severity];
    }
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  const totalUnaddressed = breakdown.critical + breakdown.high + breakdown.medium + breakdown.low;

  return { score, severityBreakdown: breakdown, totalUnaddressed };
}

module.exports = {
  computeSecurityScore,
  SEVERITY_PENALTY,
  SEVERITY_LEVELS,
};
