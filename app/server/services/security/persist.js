/**
 * Translate normalized security findings into v2 Gap rows.
 *
 * Three terminal states for a finding, decided in this order:
 *
 *   1. SKIP — a row already exists for this fingerprint. The detector
 *      re-fired on a re-analysis but nothing changed. Don't disturb
 *      the user's triage state.
 *   2. UPGRADE — there's an existing non-security gap covering one of
 *      the finding's files (e.g. a generic "no input validation" gap
 *      that, on closer inspection, has security implications). Set
 *      is_security + severity + cwe_id + detector + fingerprint on the
 *      existing row instead of creating a sibling. The UI will then
 *      render the same gap with the security shield.
 *   3. INSERT — neither match. Create a brand-new v2 gap row tagged
 *      as security from the start.
 *
 * The "non-security gap" filter on UPGRADE is critical: without it,
 * detector A would happily clobber detector B's metadata on a row
 * already tagged by B. Persistence does NOT replace metadata on rows
 * that already have a security_fingerprint set.
 *
 * Categorization heuristic: Tier-1 findings map to existing v2_category
 * values via a small lookup. Code-level issues (eval, sql, secrets)
 * are 'broken'; missing-config issues (helmet, csrf, cors) are
 * 'missing_infrastructure'. Detectors can override by returning a
 * `category` field on the finding.
 */

const crypto = require('crypto');
const { suggestions } = require('../../lib/db');

// Detector → default v2 category. Sourced from the spec:
//   "category: usually 'broken' for code-level issues,
//    'missing_infrastructure' for things like 'no helmet' or 'no
//    CORS config'"
//
// Detectors not in this map default to 'broken'. Each detector can
// also expose `defaultCategory` on itself to take precedence over the
// table — useful when an entry doesn't fit either bucket cleanly.
const DEFAULT_CATEGORY_BY_DETECTOR = Object.freeze({
  'exposed-secrets':                'broken',
  'dotenv-committed':               'broken',
  'dependency-vulnerabilities':     'missing_infrastructure',
  'sql-injection-patterns':         'broken',
  'cors-wildcard':                  'missing_infrastructure',
  'eval-with-input':                'broken',
  'insecure-cookie-config':         'missing_infrastructure',
  'missing-helmet':                 'missing_infrastructure',
  'csrf-on-state-changing-routes':  'missing_infrastructure',
  'error-detail-leakage':           'broken',
});

// Severity → v1 priority (what the existing suggestions schema stores).
// Priority drives ordering in the gap list; severity drives the score.
// We translate so existing list-ordering keeps working without any
// special-casing for security rows.
const SEVERITY_TO_PRIORITY = Object.freeze({
  critical: 'critical',
  high:     'high',
  medium:   'medium',
  low:      'low',
});

function categoryFor(detectorName, finding) {
  if (finding && finding.category) return finding.category;
  return DEFAULT_CATEGORY_BY_DETECTOR[detectorName] || 'broken';
}

function makeGapId(projectId, fingerprint) {
  // The id stored on the row is the SHA-256 of (project_id, fingerprint)
  // truncated to 16 chars — same shape as `suggestions.createBatch`.
  // This keeps row ids stable across re-analyses, so a finding that
  // was rejected stays rejected and doesn't reappear under a fresh id.
  return crypto
    .createHash('sha256')
    .update(`${projectId}:sec:${fingerprint}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Persist a list of normalized findings against the project.
 *
 * Returns:
 *   {
 *     created:  number,
 *     upgraded: number,
 *     skipped:  number,
 *     errors:   [{ fingerprint, error }],
 *   }
 */
async function applySecurityFindings(projectId, findings) {
  const summary = { created: 0, upgraded: 0, skipped: 0, errors: [] };
  if (!projectId || !Array.isArray(findings) || findings.length === 0) {
    return summary;
  }

  // Aggregate-timing buckets so we can see whether the loop is
  // DB-bound on the existence check, the upgrade lookup, or the
  // insert itself. Logged once at the end of the function.
  const totalStart = Date.now();
  const tBucket = { fpLookup: 0, upgradeLookup: 0, applyFlags: 0, insert: 0 };

  for (const finding of findings) {
    try {
      // (1) SKIP — fingerprint already exists for this project.
      const tFp = Date.now();
      const existing = await suggestions.findV2GapByFingerprint(projectId, finding.fingerprint);
      tBucket.fpLookup += Date.now() - tFp;
      if (existing) {
        summary.skipped += 1;
        continue;
      }

      // (2) UPGRADE — there's an existing non-security gap whose
      //     affected_files include this finding's file. Tag it.
      const tUp = Date.now();
      const candidate = await suggestions.findUpgradeCandidate(projectId, finding.file);
      tBucket.upgradeLookup += Date.now() - tUp;
      if (candidate) {
        const tApply = Date.now();
        await suggestions.applySecurityFlags(candidate.id, projectId, {
          severity:    finding.severity,
          cweId:       finding.cweId,
          detector:    finding.detector,
          fingerprint: finding.fingerprint,
        });
        tBucket.applyFlags += Date.now() - tApply;
        summary.upgraded += 1;
        continue;
      }

      // (3) INSERT — fresh security-only gap.
      const category = categoryFor(finding.detector, finding);
      const priority = SEVERITY_TO_PRIORITY[finding.severity] || 'medium';
      const affectedFiles = [finding.file, ...(Array.isArray(finding.extraFiles) ? finding.extraFiles : [])]
        // dedupe while preserving order
        .filter((p, i, arr) => p && arr.indexOf(p) === i);

      const evidence = Array.isArray(finding.evidence) && finding.evidence.length > 0
        ? finding.evidence
        : [{ file: finding.file, line: finding.line, reason: `Detected by ${finding.detector}` }];

      const stableId = makeGapId(projectId, finding.fingerprint);

      const tIns = Date.now();
      await suggestions.createV2Gap({
        id:                  stableId,
        project_id:          projectId,
        type:                'fix',
        category:            'security',
        priority,
        title:               finding.title || `Security issue in ${finding.file}`,
        description:         finding.description || '',
        evidence,
        effort:              null,
        cursor_prompt:       null,
        affected_files:      affectedFiles,
        source:              'security',
        status:              'open',
        v2_status:           'untriaged',
        v2_category:         category,
        is_security:         true,
        security_severity:   finding.severity,
        cwe_id:              finding.cweId,
        security_detector:   finding.detector,
        security_fingerprint: finding.fingerprint,
      });
      tBucket.insert += Date.now() - tIns;
      summary.created += 1;
    } catch (err) {
      console.warn(
        `[security] persist failed for fingerprint ${finding?.fingerprint || '(unknown)'}: ${err.message}`
      );
      summary.errors.push({ fingerprint: finding?.fingerprint || null, error: err.message });
    }
  }

  console.log(JSON.stringify({
    event: 'stage_timing',
    stage: 'stage4b_persist_breakdown',
    projectId,
    ms: Date.now() - totalStart,
    findings: findings.length,
    fpLookupMs:      tBucket.fpLookup,
    upgradeLookupMs: tBucket.upgradeLookup,
    applyFlagsMs:    tBucket.applyFlags,
    insertMs:        tBucket.insert,
  }));

  return summary;
}

module.exports = {
  applySecurityFindings,
  DEFAULT_CATEGORY_BY_DETECTOR,
};
