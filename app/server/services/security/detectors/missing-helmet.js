/**
 * missing-helmet — flag Express apps that don't use helmet for HTTP
 * security headers.
 *
 * helmet sets a bundle of headers (CSP, X-Frame-Options, X-Content-
 * Type-Options, Strict-Transport-Security, Referrer-Policy) with
 * sensible defaults. Without it, the app is more exposed to XSS,
 * clickjacking, and MIME-confusion attacks than it needs to be.
 *
 * The check has three "no" gates:
 *   1. Stack must look like Express (so we don't pester Next.js,
 *      Nuxt, FastAPI, or pure-frontend repos).
 *   2. `helmet` is NOT in package.json.
 *   3. No file imports / requires `helmet`.
 *
 * Anchor file for the finding: prefer the main server entry (the
 * structure detector already identifies these). Fall back to
 * `package.json`.
 *
 * Severity: medium. Not having helmet is a missing best-practice,
 * not an immediate vulnerability — important enough to surface,
 * not severe enough to dock the score by 8 points.
 *
 * CWE-693: Protection Mechanism Failure (missing security headers).
 */

const NAME = 'missing-helmet';

function safeJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function isExpressLike(stack) {
  if (!stack) return false;
  const fw = String(stack.framework || '').toLowerCase();
  if (fw.includes('express')) return true;
  if (fw.includes('react + express')) return true;
  return false;
}

function findEntryFile(structure, fileContents) {
  if (!structure) return null;
  // Prefer files the analyzer already classified as entry points.
  const entries = Array.isArray(structure.entryPoints) ? structure.entryPoints : [];
  for (const p of entries) {
    if (fileContents[p]) return p;
  }
  // Fall back to anything called server/app/index at the top level.
  for (const path of Object.keys(fileContents || {})) {
    if (/(?:^|\/)(?:server|app|index)\.(?:js|ts|mjs|cjs)$/.test(path)) return path;
  }
  return null;
}

async function run({ stack, structure, fileContents }) {
  if (!isExpressLike(stack)) return [];
  if (!fileContents || typeof fileContents !== 'object') return [];

  // (2) helmet declared as a dependency anywhere?
  const pkg = safeJson(fileContents['package.json']);
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.helmet) return [];
  }

  // (3) helmet imported / required anywhere in the source?
  for (const content of Object.values(fileContents)) {
    if (typeof content !== 'string') continue;
    if (/require\(['"]helmet['"]\)/.test(content)) return [];
    if (/from\s+['"]helmet['"]/.test(content)) return [];
  }

  const file = findEntryFile(structure, fileContents) || 'package.json';
  return [{
    file,
    line: 1,
    severity: 'medium',
    cweId: 'CWE-693',
    title: `Express app is missing helmet security headers`,
    description:
      `helmet is a one-line middleware that sets a bundle of HTTP security headers (Content-Security-Policy, ` +
      `X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy). Without it, the app ` +
      `is more exposed to XSS, clickjacking, and MIME-confusion attacks than it needs to be. ` +
      `Install with \`npm install helmet\` and add \`app.use(helmet())\` BEFORE any route definitions.`,
    evidence: [{ file, reason: 'Express stack detected; helmet is not a dependency and not imported anywhere' }],
  }];
}

module.exports = {
  name: NAME,
  severity: 'medium',
  cweId: 'CWE-693',
  run,
};
