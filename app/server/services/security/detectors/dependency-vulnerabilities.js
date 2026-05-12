/**
 * dependency-vulnerabilities — query the GitHub Security Advisory
 * Database for CVEs against direct npm dependencies in package.json.
 *
 * Why GitHub Advisory and not `npm audit`: `npm audit` requires a
 * local node_modules tree, and the analyzer reads files via the
 * GitHub API only. The Advisory GraphQL endpoint takes a package
 * name + ecosystem and returns advisories applicable to any version —
 * which is exactly the data we have.
 *
 * Behavior:
 *   - Skips silently (returns []) when GITHUB_TOKEN is not set. The
 *     unauthenticated GraphQL endpoint requires it.
 *   - Reads only direct dependencies (dependencies + devDependencies);
 *     transitives are not visible without a lockfile resolution
 *     pass, which we explicitly skip in slice (b).
 *   - Batches up to BATCH_SIZE packages per GraphQL request via
 *     aliases. Most projects fit in 1–2 requests.
 *   - Reports advisories whose CVSS base score is >= MIN_CVSS (7.0
 *     per the spec). Maps to severity:
 *        9.0+ -> critical
 *        7.0–8.9 -> high
 *        4.0–6.9 -> medium  (only surfaced if it slipped past MIN_CVSS;
 *                            currently filtered out, kept for future
 *                            tuning)
 *
 * Limits / known gaps:
 *   - Does not check whether the *installed* version of the package
 *     actually falls in `vulnerableVersionRange`. We surface the
 *     advisory and let the user decide; otherwise we'd reimplement
 *     semver and dedupe across version ranges, which is enough work
 *     to deserve its own detector. False-positive rate from this
 *     trade-off is acceptable: the alternative is missing the user's
 *     vulnerable transitive that semver would have ruled out anyway.
 *   - Network call is best-effort. Any fetch error is logged and
 *     returns [] for that batch — the orchestrator's fail-soft
 *     contract demands we never crash the pipeline.
 *
 * CWE-1395: Dependency on Vulnerable Third-Party Component (umbrella).
 */

const NAME = 'dependency-vulnerabilities';
const MIN_CVSS = 7.0;
const BATCH_SIZE = 50;
const TIMEOUT_MS = 8000;
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

function severityForCvss(score) {
  if (typeof score !== 'number') return null;
  if (score >= 9.0) return 'critical';
  if (score >= 7.0) return 'high';
  if (score >= 4.0) return 'medium';
  return 'low';
}

function safeJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function buildBatchQuery(pkgs) {
  const fields = pkgs.map((pkg, i) => (
    `  pkg${i}: securityVulnerabilities(ecosystem: NPM, package: ${JSON.stringify(pkg)}, first: 5, orderBy: { field: UPDATED_AT, direction: DESC }) {
    nodes {
      severity
      vulnerableVersionRange
      advisory {
        ghsaId
        summary
        permalink
        cvss { score }
      }
    }
  }`
  )).join('\n');
  return `query {\n${fields}\n}`;
}

async function postGraphQL(query, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(GITHUB_GRAPHQL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'CodeGuru-SecurityScanner',
      },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`GHSA GraphQL ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function run({ fileContents }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    // Per the orchestrator's fail-soft contract, log once and skip.
    // The score will reflect the absence; the report view (Phase 3)
    // can surface "this detector skipped — set GITHUB_TOKEN" once we
    // have UI for it.
    console.log('[security/dependency-vulnerabilities] GITHUB_TOKEN not set; skipping');
    return [];
  }

  const pkg = safeJson(fileContents && fileContents['package.json']);
  if (!pkg) return [];

  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const pkgs = Object.keys(allDeps).filter(Boolean);
  if (pkgs.length === 0) return [];

  const findings = [];
  for (let i = 0; i < pkgs.length; i += BATCH_SIZE) {
    const batch = pkgs.slice(i, i + BATCH_SIZE);
    let data;
    try {
      const resp = await postGraphQL(buildBatchQuery(batch), token);
      if (resp.errors && resp.errors.length > 0) {
        console.warn(
          `[security/dependency-vulnerabilities] GraphQL errors on batch ${i / BATCH_SIZE}: ${resp.errors[0].message}`
        );
      }
      data = resp.data || {};
    } catch (err) {
      console.warn(`[security/dependency-vulnerabilities] batch ${i / BATCH_SIZE} failed: ${err.message}`);
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const pkgName = batch[j];
      const result = data[`pkg${j}`];
      if (!result || !Array.isArray(result.nodes) || result.nodes.length === 0) continue;

      // Pick the highest-severity advisory we found. One finding per
      // package keeps the gap list manageable; the `evidence` array
      // carries the runner-up advisories so the UI can show the full
      // list on expand.
      let best = null;
      for (const node of result.nodes) {
        const score = node.advisory?.cvss?.score;
        if (typeof score === 'number' && score < MIN_CVSS) continue;
        const sev = severityForCvss(score);
        if (!sev) continue;
        if (!best || (best.advisory?.cvss?.score || 0) < score) best = node;
      }
      if (!best) continue;

      const severity = severityForCvss(best.advisory?.cvss?.score) || 'high';
      const ghsa = best.advisory?.ghsaId || null;
      const summary = best.advisory?.summary || '(no summary)';

      findings.push({
        file: 'package.json',
        line: null,
        severity,
        cweId: 'CWE-1395',
        title: `Vulnerable dependency: ${pkgName}${ghsa ? ` (${ghsa})` : ''}`,
        description:
          `\`${pkgName}\` (declared as "${allDeps[pkgName]}") has a known security advisory: ${summary} ` +
          `Vulnerable range: ${best.vulnerableVersionRange || 'see advisory'}. ` +
          `Update to a patched version or pin a safe range. Advisory: ${best.advisory?.permalink || 'GHSA'}.`,
        evidence: result.nodes.slice(0, 5).map((n) => ({
          ghsaId: n.advisory?.ghsaId || null,
          summary: n.advisory?.summary || null,
          cvss: n.advisory?.cvss?.score ?? null,
          range: n.vulnerableVersionRange || null,
        })),
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'high',
  cweId: 'CWE-1395',
  run,
};
