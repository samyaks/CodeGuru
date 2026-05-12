/**
 * csrf-on-state-changing-routes — flag Express apps with cookie-based
 * sessions that accept POST / PUT / DELETE / PATCH requests on routes
 * NOT protected by CSRF middleware.
 *
 * Two phases:
 *   1. Determine whether the project is at risk: it must (a) look
 *      like Express AND (b) use cookie-based sessions
 *      (`express-session`, `cookie-session`, manual `req.session`,
 *      or `res.cookie` for auth). Pure JWT-in-Authorization-header
 *      apps don't have this problem (the cookie-not-attached behavior
 *      means a cross-origin POST can't impersonate the user).
 *   2. If at-risk, scan all source files for state-changing routes
 *      WITHOUT a CSRF middleware on the router or per-route. CSRF
 *      libraries we recognize: `csurf`, `csrf-csrf`, `lusca`, the
 *      newer `@dr.pogodin/csurf` fork, and bespoke
 *      `verifyCsrfToken` middlewares.
 *
 * If the project is JWT-only (no cookie-session deps, no `req.session`
 * usage, no `res.cookie` for auth tokens), this detector returns an
 * empty array. That avoids a flood of false positives on
 * authorization-header APIs.
 *
 * Severity: medium per detector finding. Most cookie-session apps
 * have only one or two state-changing routes that matter; the score
 * impact is bounded.
 *
 * CWE-352: Cross-Site Request Forgery (CSRF).
 */

const NAME = 'csrf-on-state-changing-routes';

function safeJson(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

function isExpressLike(stack) {
  const fw = String(stack?.framework || '').toLowerCase();
  return fw.includes('express') || fw === 'react + express';
}

function usesCookieSessions(fileContents, deps) {
  if (deps['express-session'] || deps['cookie-session']) return true;
  for (const content of Object.values(fileContents)) {
    if (typeof content !== 'string') continue;
    // Manual session attachment.
    if (/\breq\.session\b/.test(content)) return true;
    // Auth cookies set by the app explicitly.
    if (/res\.cookie\s*\(\s*['"](?:sb-access-token|access[_-]?token|session[_-]?id|auth)/i.test(content)) return true;
  }
  return false;
}

const CSRF_MIDDLEWARE_NAMES = [
  'csurf', 'csrf-csrf', 'lusca', '@dr.pogodin/csurf',
  'verifyCsrfToken', 'csrfProtection', 'csrf', 'doubleCsrfProtection',
];

function fileUsesCsrfProtection(content) {
  for (const name of CSRF_MIDDLEWARE_NAMES) {
    const safeName = name.replace(/[/.@-]/g, (m) => `\\${m}`);
    const re = new RegExp(`\\b${safeName}\\b`);
    if (re.test(content)) return true;
  }
  return false;
}

const STATE_CHANGING_ROUTE = /\b(?:router|app)\.(?:post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;

function isLikelyServerCode(path) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return false;
  if (/(?:^|\/)(?:client|frontend|web|app\/client)\//.test(path)) return false;
  if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) return false;
  return true;
}

async function run({ stack, fileContents }) {
  if (!isExpressLike(stack)) return [];
  if (!fileContents || typeof fileContents !== 'object') return [];

  const pkg = safeJson(fileContents['package.json']);
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};

  if (!usesCookieSessions(fileContents, deps)) {
    // Authorization-header / JWT-only apps don't have CSRF exposure
    // in the classic sense. Skip the entire detector.
    return [];
  }

  const findings = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyServerCode(path)) continue;

    if (fileUsesCsrfProtection(content)) continue; // file-level mitigation

    STATE_CHANGING_ROUTE.lastIndex = 0;
    let match;
    let surfacedFor = new Set();
    while ((match = STATE_CHANGING_ROUTE.exec(content)) !== null) {
      const routePath = match[1];
      // Heuristic: skip API routes that are clearly intended for
      // header-token clients only — webhook receivers, OAuth
      // callbacks, public collect endpoints. Webhook endpoints
      // verify signatures separately; flagging them as CSRF-vuln
      // is technically correct but practically noisy.
      if (/\/(?:webhook|callback|oauth|collect|public)/i.test(routePath)) continue;
      // One finding per (file, routePath) — multiple verbs on the
      // same path coalesce.
      const key = `${path}::${routePath}`;
      if (surfacedFor.has(key)) continue;
      surfacedFor.add(key);

      // Compute the line number from the match offset for a useful
      // anchor in the UI.
      const before = content.slice(0, match.index);
      const line = before.split('\n').length;

      findings.push({
        file: path,
        line,
        severity: 'medium',
        cweId: 'CWE-352',
        title: `State-changing route without CSRF protection: ${routePath}`,
        description:
          `${path}:${line} declares a state-changing route at \`${routePath}\` and the app uses cookie-based sessions, ` +
          `but no CSRF middleware (csurf, csrf-csrf, lusca, etc.) is applied in this file. A malicious site that a ` +
          `logged-in user visits can submit cross-origin requests to this endpoint and have the user's session cookie ` +
          `attached automatically. Add CSRF middleware to your router or globally, and include the token on every form / ` +
          `fetch call from your own frontend.`,
        evidence: [{ file: path, line, reason: 'State-changing route + cookie sessions + no CSRF middleware in file' }],
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'medium',
  cweId: 'CWE-352',
  run,
};
