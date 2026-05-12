/**
 * insecure-cookie-config — flag insecure session/cookie middleware
 * configuration in Express apps.
 *
 * Three distinct sub-checks, each emitted as its own finding so the
 * Reject flow can dismiss them independently:
 *
 *   1. `secure: false` set on cookie config in production. We can't
 *      know "in production" statically, but we can detect a hardcoded
 *      `secure: false` that isn't gated behind an env check on the
 *      same line.
 *   2. `httpOnly: false` — almost never the right answer; cookies
 *      readable from JS open the door to XSS-driven session theft.
 *   3. `sameSite` missing entirely from a cookie config block, OR
 *      explicit `sameSite: 'none'` without a sibling `secure: true`.
 *   4. Hardcoded weak session secrets — `secret: 'secret'`,
 *      `'dev'`, `'changeme'`, `'changethisinproduction'`, etc.
 *
 * Severity: high across the board. Cookie misconfig is the kind of
 * issue where users habitually ship "I'll fix it before prod" and
 * never do.
 *
 * CWE-614: Sensitive Cookie in HTTPS Session Without 'Secure' Attribute.
 * (Also covers CWE-1004 for httpOnly.)
 */

const NAME = 'insecure-cookie-config';

// Anchor on the names of common middleware that takes a cookie config:
// express-session, cookie-session, fastify-cookie, hono session, etc.
const COOKIE_MIDDLEWARE = /\b(?:expressSession|session|cookieSession|cookie\.serialize|res\.cookie|req\.session)\b/;
// Per-property checks. Each runs ONLY on a line we believe is inside
// a cookie config (we look up to LOOKBACK lines for an anchor call).
const SECURE_FALSE = /\bsecure\s*:\s*false\b/;
const HTTPONLY_FALSE = /\bhttpOnly\s*:\s*false\b/;
const SAMESITE_NONE = /\bsameSite\s*:\s*['"]none['"]/i;
const SAMESITE_PRESENT = /\bsameSite\s*:/;

const WEAK_SECRET = /\bsecret\s*:\s*['"](?:secret|dev|change[ -]?me|change[-_ ]?this|test|password|admin|default)['"]/i;
// Env-guarded variants — explicitly NOT a finding.
const ENV_GUARDED_SECURE_FALSE = /process\.env\.NODE_ENV.*!==?\s*['"]production['"]|process\.env\.NODE_ENV.*===?\s*['"](?:dev|development|test)['"]/;

const LOOKBACK = 12;

function isLikelyServerCode(path) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return false;
  if (/(?:^|\/)(?:client|frontend|web|app\/client)\//.test(path)) return false;
  if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) return false;
  return true;
}

function nearbyMiddlewareCall(lines, idx) {
  const start = Math.max(0, idx - LOOKBACK);
  for (let i = start; i <= idx; i++) {
    if (COOKIE_MIDDLEWARE.test(lines[i])) return true;
  }
  return false;
}

// Simple "is there a cookie/session config object that doesn't set
// sameSite anywhere in it?" check. We bound the object span to ~30
// lines forward from the anchor — beyond that we lose precision.
function findCookieBlocks(lines) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!COOKIE_MIDDLEWARE.test(lines[i])) continue;
    // Find the next opening `{` or treat the same line as the start.
    let openIdx = lines[i].indexOf('{');
    let start = i;
    if (openIdx === -1) {
      const next = lines.slice(i + 1, i + 5).findIndex((l) => l.includes('{'));
      if (next === -1) continue;
      start = i + 1 + next;
      openIdx = lines[start].indexOf('{');
    }
    // Scan forward for a matching `}` with naive brace counting.
    let depth = 0;
    let end = -1;
    for (let j = start; j < Math.min(lines.length, start + 30); j++) {
      const l = lines[j];
      for (const ch of l) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end !== -1) break;
    }
    if (end !== -1) blocks.push({ start, end, anchorLine: i });
  }
  return blocks;
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyServerCode(path)) continue;

    const lines = content.split('\n');

    // Per-line checks (1, 2, 4).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!nearbyMiddlewareCall(lines, i)) continue;

      if (SECURE_FALSE.test(line) && !ENV_GUARDED_SECURE_FALSE.test(line)) {
        findings.push({
          file: path, line: i + 1, severity: 'high', cweId: 'CWE-614',
          title: `Cookie set with secure: false in ${path}:${i + 1}`,
          description:
            `Cookies marked \`secure: false\` are sent over plain HTTP, which lets any network attacker steal the session. ` +
            `Set \`secure: true\` in production. If you need \`secure: false\` locally, gate it on \`process.env.NODE_ENV !== 'production'\` on the same line.`,
          evidence: [{ file: path, line: i + 1, reason: 'secure: false on cookie/session config', snippet: line.trim().slice(0, 200) }],
        });
      }

      if (HTTPONLY_FALSE.test(line)) {
        findings.push({
          file: path, line: i + 1, severity: 'high', cweId: 'CWE-1004',
          title: `Cookie set with httpOnly: false in ${path}:${i + 1}`,
          description:
            `\`httpOnly: false\` lets client-side JavaScript read this cookie. If your app has any XSS sink — or ever ships ` +
            `a third-party script that does — that script can read your users' session cookies. There is almost never a ` +
            `legitimate reason to set this to false; the default is correct.`,
          evidence: [{ file: path, line: i + 1, reason: 'httpOnly: false on cookie config', snippet: line.trim().slice(0, 200) }],
        });
      }

      if (SAMESITE_NONE.test(line)) {
        // sameSite=none is fine *only* if secure is also true. Look
        // for `secure: true` in the next 6 lines as a quick check.
        const nearby = lines.slice(i, Math.min(lines.length, i + 6)).join('\n');
        if (!/\bsecure\s*:\s*true\b/.test(nearby)) {
          findings.push({
            file: path, line: i + 1, severity: 'high', cweId: 'CWE-614',
            title: `sameSite: 'none' without secure in ${path}:${i + 1}`,
            description:
              `\`sameSite: 'none'\` is only valid when \`secure: true\` is also set; modern browsers reject the cookie otherwise. ` +
              `The intent here is to allow cross-site cookie use — make sure that's actually what you want, and pair it with secure.`,
            evidence: [{ file: path, line: i + 1, reason: "sameSite: 'none' without secure: true nearby", snippet: line.trim().slice(0, 200) }],
          });
        }
      }

      if (WEAK_SECRET.test(line)) {
        findings.push({
          file: path, line: i + 1, severity: 'high', cweId: 'CWE-798',
          title: `Weak hardcoded session secret in ${path}:${i + 1}`,
          description:
            `The session secret is a common dictionary word. Anyone who reads this file can forge a valid session. ` +
            `Generate a long random secret (32+ bytes from crypto.randomBytes) and load it from \`process.env.SESSION_SECRET\`.`,
          evidence: [{ file: path, line: i + 1, reason: 'Weak hardcoded session secret', snippet: line.trim().replace(/secret\s*:\s*['"][^'"]*['"]/i, 'secret: \"***REDACTED***\"').slice(0, 200) }],
        });
      }
    }

    // Block-level check (3): sameSite missing entirely.
    const blocks = findCookieBlocks(lines);
    for (const block of blocks) {
      const blockText = lines.slice(block.start, block.end + 1).join('\n');
      // Only flag if the block clearly is a cookie config — at least
      // one of the cookie-property keys is set.
      const looksLikeCookieConfig = /\b(?:secure|httpOnly|sameSite|maxAge|domain|path)\s*:/.test(blockText);
      if (!looksLikeCookieConfig) continue;
      if (SAMESITE_PRESENT.test(blockText)) continue;
      findings.push({
        file: path, line: block.anchorLine + 1, severity: 'medium', cweId: 'CWE-1275',
        title: `Cookie config missing sameSite in ${path}:${block.anchorLine + 1}`,
        description:
          `This cookie/session config doesn't set \`sameSite\`. The default varies by browser version (Lax in modern Chrome, ` +
          `historically None in older browsers) — and that ambiguity is the bug. Set \`sameSite: 'lax'\` for typical sessions ` +
          `or \`sameSite: 'strict'\` for high-sensitivity flows like admin auth.`,
        evidence: [{ file: path, line: block.anchorLine + 1, reason: 'Cookie config block has no sameSite property' }],
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'high',
  cweId: 'CWE-614',
  run,
};
