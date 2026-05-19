/**
 * Capability-detector orchestrator.
 *
 * Replaces the single substring-soup `detectGaps()` block in `analyzer.js`
 * with one detector per capability. Each detector returns a structured
 * `CapabilityResult` with confidence + per-file evidence so downstream
 * consumers (context-generator, suggestion-ai, /api/analyze) can reason
 * about *why* a capability was flagged present/partial/missing instead of
 * relying on string membership.
 *
 * Detector contract:
 *   {
 *     name: string,                           // stable key used in registry output
 *     run(input) => Promise<CapabilityResult> // see shape below
 *   }
 *
 * CapabilityResult:
 *   {
 *     exists:     boolean,       // headline — drives legacy gap.X.exists
 *     confidence: number,        // 0.0 .. 1.0
 *     status:     'present' | 'partial' | 'missing',
 *     evidence:   Array<{ file: string, line?: number, snippet?: string, reason: string }>,
 *     extra?:     object,        // detector-specific fields preserved on the legacy gap row
 *   }
 *
 * input:
 *   {
 *     files:        Array<{ path: string, size?: number }>,
 *     fileContents: Object<path, string>,
 *     stack:        object,      // analyzer.detectStack() output
 *   }
 *
 * The runner executes every detector in parallel, swallows individual
 * failures (returns a missing-shape result + records the error in `extra`),
 * and returns an object keyed by detector.name.
 */

const auth          = require('./auth');
const database      = require('./database');
const deployment    = require('./deployment');
const errorHandling = require('./error-handling');
const testing       = require('./testing');
const permissions   = require('./permissions');
const envConfig     = require('./env-config');

const DETECTORS = [auth, database, deployment, errorHandling, testing, permissions, envConfig];

// Filter our own generated gap specs out before detectors run — otherwise
// generating `src/auth/.context.md` makes the next scan think auth exists.
function stripContextMd(input) {
  const isContext = (p) => /(?:^|\/)\.context\.md$/.test(p);
  const files = (input.files || []).filter((f) => f && f.path && !isContext(f.path));
  const fileContents = {};
  for (const [p, c] of Object.entries(input.fileContents || {})) {
    if (!isContext(p)) fileContents[p] = c;
  }
  return { ...input, files, fileContents };
}

async function runAllDetectors(input) {
  const safeInput = stripContextMd(input || {});
  const results = await Promise.all(
    DETECTORS.map(async (d) => {
      try {
        const r = await d.run(safeInput);
        return [d.name, normalizeResult(r)];
      } catch (err) {
        console.warn(`[capability-detectors] ${d.name} threw:`, err.message);
        return [d.name, {
          exists: false,
          confidence: 0,
          status: 'missing',
          evidence: [],
          extra: { error: err.message },
        }];
      }
    })
  );
  return Object.fromEntries(results);
}

function normalizeResult(r) {
  if (!r || typeof r !== 'object') {
    return { exists: false, confidence: 0, status: 'missing', evidence: [], extra: {} };
  }
  return {
    exists:     !!r.exists,
    confidence: Number.isFinite(r.confidence) ? r.confidence : 0,
    status:     r.status === 'present' || r.status === 'partial' || r.status === 'missing' ? r.status : 'missing',
    evidence:   Array.isArray(r.evidence) ? r.evidence : [],
    extra:      r.extra && typeof r.extra === 'object' ? r.extra : {},
  };
}

module.exports = { runAllDetectors, DETECTORS };
