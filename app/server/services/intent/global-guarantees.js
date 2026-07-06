/**
 * Global guarantees sweep — cross-cutting security/infra invariants.
 *
 * Emits scope='global' invariants from security detector definitions. These are
 * the *guarantees* ("state-changing routes require CSRF protection"); existing
 * security findings in `suggestions` remain the *violations*.
 */

const crypto = require('crypto');
const { intentStatements } = require('../../lib/db');
const { runSecurityDetectors } = require('../security');
const { scoreInvariantConfidence } = require('./confidence');

// Map detector name -> guarantee text (positive framing).
const DETECTOR_GUARANTEES = {
  'csrf-on-state-changing-routes': 'State-changing routes must be protected against CSRF when using cookie-based sessions',
  'exposed-secrets': 'Secrets and API keys must not be hard-coded in source files',
  'dotenv-committed': 'Environment files containing secrets must not be committed to the repository',
  'dependency-vulnerabilities': 'Dependencies must not include known critical vulnerabilities',
  'sql-injection-patterns': 'Database queries must not be built via unsanitized string concatenation',
  'cors-wildcard': 'CORS must not allow wildcard origins on authenticated endpoints',
  'eval-with-input': 'User input must not be passed to eval or dynamic code execution',
  'insecure-cookie-config': 'Session cookies must use secure, httpOnly, and sameSite settings',
  'missing-helmet': 'HTTP security headers must be configured via helmet or equivalent',
  'error-detail-leakage': 'Error responses must not expose stack traces or internal details to clients',
};

function findingToInvariant(finding) {
  const guarantee = DETECTOR_GUARANTEES[finding.detector]
    || `${finding.title} must not occur in production code`;
  const links = [{
    file_path: finding.file,
    symbol: null,
    link_status: 'healthy',
  }];
  const satisfied = false; // a finding means the guarantee is currently broken
  const confidence = scoreInvariantConfidence({ links, satisfied, detectorBacked: true });
  return {
    id: crypto.randomUUID(),
    text: guarantee,
    kind: 'constraint',
    status: 'candidate',
    source: 'inferred',
    feature_area: 'security',
    group_label: 'Security & safety basics',
    links,
    code_hash: null,
    satisfied,
    last_checked_at: new Date().toISOString(),
    scope: 'global',
    confirmed_via: null,
    confidence,
    archived: false,
  };
}

async function deleteCandidateGlobals(projectId) {
  const rows = await intentStatements.findByProjectId(projectId, {
    scope: 'global',
    status: 'candidate',
    archived: false,
  });
  for (const r of rows) {
    await intentStatements.delete(r.id, projectId);
  }
}

/**
 * Run the global sweep at analysis time.
 */
async function runGlobalGuarantees(projectId, codebaseModel) {
  const input = codebaseModel || {};
  const { findings } = await runSecurityDetectors(input);

  await deleteCandidateGlobals(projectId);

  const seen = new Set();
  const toInsert = [];
  for (const f of findings) {
    const key = `${f.detector}::${f.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push(findingToInvariant(f));
  }

  if (toInsert.length === 0) {
    return { swept: true, created: 0 };
  }

  await intentStatements.createBatch(toInsert.map((r) => ({ ...r, project_id: projectId })));
  return { swept: true, created: toInsert.length };
}

module.exports = {
  runGlobalGuarantees,
  findingToInvariant,
  DETECTOR_GUARANTEES,
};
