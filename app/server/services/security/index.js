/**
 * Security orchestrator.
 *
 * Phase 1 / slice (a) ships the framework: a detector registry, a parallel
 * runner that tolerates per-detector failures, and a stable finding
 * shape consumed by `services/security/persist.js` and the audit-self
 * script. The 10 Tier-1 detectors and 6 Tier-2 detectors land in
 * follow-up commits — each registers itself by appending to TIER1 (or
 * TIER2) in this file, with the actual logic in its own file under
 * `detectors/`.
 *
 * Detector contract:
 *   { name: string, severity: 'critical'|'high'|'medium'|'low' (default for findings),
 *     cweId?: string, run: (input) => Promise<RawFinding[]> | RawFinding[] }
 *
 * RawFinding shape (what a detector returns):
 *   {
 *     file:        string,      // affected file path (used for fingerprint + UI)
 *     line?:       number,      // 1-based line number when known
 *     severity?:   'critical'|'high'|'medium'|'low',  // overrides detector default
 *     cweId?:      string,                            // overrides detector default
 *     title:       string,      // short headline for the gap card
 *     description: string,      // human-readable explanation
 *     evidence?:   any[],       // structured evidence preserved on the gap row
 *     extraFiles?: string[],    // other files implicated, beyond `file`
 *   }
 *
 * Important: detectors MUST NOT include the secret VALUE in any field
 * that gets persisted (file path + line number + redacted snippet are
 * fine; the raw key is not). The existing `services/suggestion-rules.js`
 * `ruleEnvInCode` already redacts before adding to evidence — Tier 1
 * `exposed-secrets.ts` will follow the same pattern.
 *
 * The runner is fail-safe: a thrown detector is logged and yields zero
 * findings rather than aborting the whole pipeline. This preserves the
 * "slice (a) commits the data model + integration scaffolding" contract
 * even when detectors misbehave.
 */

const crypto = require('crypto');

// Detector registry. Order doesn't matter — findings are deduped by
// fingerprint downstream.
const TIER1 = [
  require('./detectors/exposed-secrets'),
  require('./detectors/dotenv-committed'),
  require('./detectors/dependency-vulnerabilities'),
  require('./detectors/sql-injection-patterns'),
  require('./detectors/cors-wildcard'),
  require('./detectors/eval-with-input'),
  require('./detectors/insecure-cookie-config'),
  require('./detectors/missing-helmet'),
  require('./detectors/csrf-on-state-changing-routes'),
  require('./detectors/error-detail-leakage'),
];

const TIER2 = [
  // Tier 2 detectors (Claude-assisted) land in Phase 4.
];

const ALL_DETECTORS = [...TIER1, ...TIER2];

/**
 * Compute a stable fingerprint for a finding. The fingerprint is what
 * lets us de-dupe across analysis re-runs and identify upgrade
 * candidates (an existing non-security gap on the same file gets
 * tagged instead of producing a sibling row).
 *
 * Includes detector name so two detectors flagging the same line for
 * different reasons each get their own row. Does NOT include the
 * project id — we scope by project_id at the SQL layer instead, which
 * keeps the fingerprint portable for telemetry / log correlation.
 */
function computeFingerprint({ detector, file, line }) {
  const key = `${detector || 'unknown'}::${file || ''}::${line == null ? '' : String(line)}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
}

/**
 * Normalize a detector's raw output into the shape `persist.js`
 * expects. Drops findings that don't carry a file path (we can't
 * fingerprint them, and the UI has nowhere to show them).
 */
function normalizeFindings(detector, raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    if (!r.file || typeof r.file !== 'string') continue;

    const severity = r.severity || detector.severity || 'medium';
    const cweId = r.cweId || detector.cweId || null;
    const fingerprint = computeFingerprint({
      detector: detector.name,
      file: r.file,
      line: r.line,
    });

    out.push({
      detector: detector.name,
      file: r.file,
      line: typeof r.line === 'number' ? r.line : null,
      severity,
      cweId,
      title: r.title || `${detector.name}: ${r.file}`,
      description: r.description || '',
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      extraFiles: Array.isArray(r.extraFiles) ? r.extraFiles : [],
      fingerprint,
    });
  }
  return out;
}

/**
 * Run all registered detectors against an analyzer input. Returns a
 * combined list of findings plus a per-detector error log so the
 * caller can surface "X detector(s) failed" without crashing the
 * pipeline.
 *
 * `input` shape mirrors the analyzer output the takeoff pipeline
 * already produces:
 *   {
 *     stack, structure, fileContents, fileTree, gaps, deployInfo,
 *     features, meta
 *   }
 *
 * A detector receives the entire input; it picks the fields it cares
 * about. This keeps the orchestrator dumb (no per-detector wiring) at
 * the cost of a slightly larger arg object — fine since detectors run
 * in-process.
 */
async function runSecurityDetectors(input) {
  const safeInput = input || {};
  const findings = [];
  const errors = [];

  await Promise.all(ALL_DETECTORS.map(async (detector) => {
    if (!detector || typeof detector.run !== 'function' || !detector.name) {
      errors.push({ detector: detector?.name || '(anonymous)', error: 'invalid detector shape' });
      return;
    }
    try {
      const raw = await detector.run(safeInput);
      const normalized = normalizeFindings(detector, raw);
      findings.push(...normalized);
    } catch (err) {
      console.warn(`[security] detector "${detector.name}" failed: ${err.message}`);
      errors.push({ detector: detector.name, error: err.message });
    }
  }));

  return { findings, errors, detectorCount: ALL_DETECTORS.length };
}

/**
 * List the names of every detector that's currently registered. Used
 * by the audit-self script and the upcoming "Detected by" UI section.
 */
function listDetectorNames() {
  return ALL_DETECTORS.map((d) => d?.name).filter(Boolean);
}

module.exports = {
  runSecurityDetectors,
  listDetectorNames,
  computeFingerprint,
  normalizeFindings,
};
