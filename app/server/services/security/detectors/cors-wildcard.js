/**
 * cors-wildcard — flag CORS configurations that allow any origin.
 *
 * Two flavors:
 *   - Express middleware: `cors({ origin: '*' })`, `cors({ origin: true })`
 *     (the `true` shape reflects the request origin — equally
 *     permissive in practice).
 *   - Manual headers: `res.setHeader('Access-Control-Allow-Origin', '*')`.
 *
 * Severity:
 *   - medium by default.
 *   - high if the same call site (or the same file) also sets
 *     `credentials: true` / `Access-Control-Allow-Credentials: true`.
 *     Combining wildcard origin with credentials is what unlocks
 *     credentialed cross-origin requests; browsers REJECT this
 *     combination, but old/buggy clients accept it and the
 *     misconfiguration leaks intent.
 *
 * False positives we accept:
 *   - Devs who *intend* an open API (e.g. public read-only endpoints).
 *     The Reject flow handles these per project. We don't treat
 *     `// eslint-disable-next-line` style annotations as opt-outs;
 *     security reviews shouldn't be invisible to detectors.
 *
 * CWE-942: Permissive Cross-domain Policy with Untrusted Domains.
 */

const NAME = 'cors-wildcard';

// Match `cors({ ... origin: '*' ... })` or origin: true on its own line.
// We don't try to parse the entire object literal — we look for the
// `cors(` call, then inside the same line (or the next ~5 lines) for
// the offending key.
const CORS_CALL = /\bcors\s*\(/;
// `\b` after `["']\*["']` doesn't match (quote is non-word, next char
// is usually `,` which is also non-word, so no word boundary fires).
// Use a lookahead for end-of-value characters instead.
const ORIGIN_WILDCARD = /\borigin\s*:\s*(?:['"]\*['"]|true\b)(?=\s*[,}\)]|$)/;
const ACAO_WILDCARD = /Access-Control-Allow-Origin\s*['"]?\s*[:,]\s*['"]\*['"]/i;
const ACAO_SET_HEADER = /set(?:Header|header)\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/i;

const CREDENTIALS_FLAG = /\bcredentials\s*:\s*true\b/;
const ACAC_HEADER = /Access-Control-Allow-Credentials/i;

const LOOKAHEAD_LINES = 5;

function isLikelyServerCode(path) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return false;
  // Client-only React component files almost never set CORS — skip
  // them to keep the false-positive rate down.
  if (/(?:^|\/)(?:client|frontend|web|app\/client)\//.test(path)) return false;
  return true;
}

function lookaheadHas(lines, start, re) {
  const end = Math.min(lines.length, start + LOOKAHEAD_LINES);
  for (let i = start; i < end; i++) {
    if (re.test(lines[i])) return true;
  }
  return false;
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyServerCode(path)) continue;
    if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) continue;

    const lines = content.split('\n');
    const fileHasCredentials = CREDENTIALS_FLAG.test(content) || ACAC_HEADER.test(content);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let kind = null;

      if (CORS_CALL.test(line)) {
        // Inline: `cors({ origin: '*' })` on the same line. Otherwise
        // peek a few lines forward for the property.
        if (ORIGIN_WILDCARD.test(line) || lookaheadHas(lines, i + 1, ORIGIN_WILDCARD)) {
          kind = 'cors() middleware with origin: "*" or origin: true';
        }
      } else if (ACAO_WILDCARD.test(line) || ACAO_SET_HEADER.test(line)) {
        kind = 'manually-set Access-Control-Allow-Origin: *';
      }

      if (!kind) continue;

      // Combine-with-credentials check. If credentials shows up
      // anywhere in the file, escalate. This is coarse but accurate
      // for the typical pattern (a single `cors()` call + a sibling
      // `credentials: true` line a few lines down).
      const severity = fileHasCredentials ? 'high' : 'medium';
      findings.push({
        file: path,
        line: i + 1,
        severity,
        cweId: 'CWE-942',
        title: `Permissive CORS configuration in ${path}:${i + 1}`,
        description:
          `${kind}. ` +
          (severity === 'high'
            ? `This file also enables credentialed CORS. Modern browsers reject the combination, but the intent here is to allow ANY origin to make authenticated cross-origin requests — which would mean any website your users visit could read their data.`
            : `Any origin can make cross-origin requests to your API. For a public read-only endpoint this is fine; for anything user-specific, change \`origin\` to an allowlist of trusted hostnames or a function that validates the request \`Origin\` header.`),
        evidence: [{ file: path, line: i + 1, reason: kind, snippet: line.trim().slice(0, 200) }],
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'medium',
  cweId: 'CWE-942',
  run,
};
