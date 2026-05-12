/**
 * error-detail-leakage — flag patterns that send raw error details
 * (stack traces, request bodies, internal exception objects) back
 * to clients or to logs in a way that's likely to leak sensitive
 * info in production.
 *
 * Three sub-patterns:
 *   1. `res.status(...).send(err.stack)` or `res.send(error.stack)` —
 *      stack traces include file paths and sometimes config values.
 *      severity: medium.
 *   2. `res.json({ error: err })` (sending the WHOLE error object).
 *      severity: medium.
 *   3. `console.log(req.body)` / `console.error(req.body)` —
 *      logging full request bodies tends to capture passwords, PII,
 *      and tokens. severity: low.
 *
 * False-positive sources:
 *   - Dev-mode-guarded leaks (`if (process.env.NODE_ENV !== 'production') res.send(err.stack)`).
 *     We exclude lines whose enclosing function or block has a
 *     visible NODE_ENV check within the surrounding 8 lines. Coarse,
 *     but kills the most common false positive.
 *
 * CWE-209: Generation of Error Message Containing Sensitive Information.
 */

const NAME = 'error-detail-leakage';

const STACK_LEAK = /\bres\.(?:status\([^)]*\)\s*\.\s*)?(?:send|json|end)\s*\(\s*(?:[a-zA-Z_$][\w$]*\.stack|[a-zA-Z_$][\w$]*\.message\s*\+[^)]*\.stack)/;
// Match `res.json({ error: err })` / `res.send({ error: error })` —
// passing the WHOLE error object — but NOT `res.json({ error: err.message })`
// or `res.json({ error: error?.message })`, which are safe patterns.
// We require the variable to be followed by an object-property
// terminator (`,` `)` `}`), which rules out both `.x` and `?.x`
// property accesses, AND `+ ' suffix'` style concatenation (also
// dangerous, but already covered by STACK_LEAK when it ends in
// `.stack`).
const ERROR_OBJ_LEAK = /\bres\.(?:status\([^)]*\)\s*\.\s*)?(?:json|send)\s*\(\s*\{\s*error\s*:\s*(?:err|error|e|exception)\s*[,})]/;
// Body-in-logs. We special-case the rule to fire only on full bodies,
// not specific properties. `console.log(req.body.email)` is fine;
// `console.log(req.body)` is the issue.
const BODY_LOG = /\bconsole\.(?:log|info|debug|warn|error)\s*\(\s*[^)]*\breq(?:uest)?\.body\s*[,)]/;

const ENV_GUARD_PATTERN = /process\.env\.NODE_ENV\s*[!=]==?\s*['"](?:production|prod)['"]/;
const DEV_GUARD_PATTERN = /process\.env\.NODE_ENV\s*[!=]==?\s*['"](?:dev|development|test)['"]/;

const GUARD_WINDOW = 8;

function isLikelyServerCode(path) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return false;
  if (/(?:^|\/)(?:client|frontend|web|app\/client)\//.test(path)) return false;
  if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) return false;
  return true;
}

function withinDevGuard(lines, idx) {
  const start = Math.max(0, idx - GUARD_WINDOW);
  for (let i = start; i <= idx; i++) {
    const l = lines[i];
    if (ENV_GUARD_PATTERN.test(l) || DEV_GUARD_PATTERN.test(l)) return true;
  }
  return false;
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyServerCode(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      let match = null;
      if (STACK_LEAK.test(line)) match = { kind: 'res.send/json with err.stack', severity: 'medium', cwe: 'CWE-209' };
      else if (ERROR_OBJ_LEAK.test(line)) match = { kind: 'res.json sending the entire error object', severity: 'medium', cwe: 'CWE-209' };
      else if (BODY_LOG.test(line)) match = { kind: 'console.* of full req.body', severity: 'low', cwe: 'CWE-532' };
      if (!match) continue;

      // Skip dev-guarded leaks — that's fine.
      if (withinDevGuard(lines, i)) continue;

      const description = match.kind.startsWith('console')
        ? `Logging the entire \`req.body\` will capture every field your users send — including passwords, tokens, ` +
          `addresses, and credit-card-shaped strings. In production this fills your logs (and any log aggregator ` +
          `you ship to) with PII. Log a summary instead, or explicitly pick the fields you actually need.`
        : `${path}:${i + 1} sends an internal error detail back to the client. Stack traces leak file paths, library ` +
          `versions, and sometimes config values; whole error objects leak whatever the framework hung on them. In ` +
          `production, return a generic message and log the detail server-side. Wrap dev-mode leaks in ` +
          `\`if (process.env.NODE_ENV !== 'production')\`.`;

      findings.push({
        file: path,
        line: i + 1,
        severity: match.severity,
        cweId: match.cwe,
        title: `Error / request detail leaked to client at ${path}:${i + 1}`,
        description,
        evidence: [{ file: path, line: i + 1, reason: match.kind, snippet: line.trim().slice(0, 200) }],
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'medium',
  cweId: 'CWE-209',
  run,
};
