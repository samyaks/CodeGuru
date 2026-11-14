/**
 * Preflight: decide whether a pack can be applied to a repo, and locate the
 * anchors it needs. Refuse over guess — any doubt returns { ok: false, reason }.
 *
 * `files` is an in-memory map { 'relative/path': 'contents' } so the engine
 * is pure and testable; callers load it from disk or from a GitHub clone.
 */
const path = require('path');

const SKIP = /(?:^|\/)(?:node_modules|dist|build|\.next|coverage)\//;
const TEST_FILE = /(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/)/;

function parseJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function detectStack(files) {
  const pkg = parseJson(files['package.json']);
  if (!pkg) return { framework: null, pkg: null };
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return { framework: 'nextjs', pkg };
  if (deps.express) return { framework: 'express', pkg };
  return { framework: null, pkg };
}

// Find the single Express entry file: requires express, creates `app`, calls app.listen.
function findExpressEntry(files) {
  const candidates = Object.entries(files).filter(([p, c]) =>
    /\.(?:js|cjs)$/.test(p) && !SKIP.test(p) && !TEST_FILE.test(p) && typeof c === 'string' &&
    /require\(\s*['"]express['"]\s*\)/.test(c) &&
    /^(?:const|let|var)\s+app\s*=\s*express\(\)/m.test(c) &&
    /\bapp\.listen\(/.test(c));
  if (candidates.length === 1) return { entry: candidates[0][0] };
  if (candidates.length === 0) return { reason: 'No Express entry file found (needs require("express"), `const app = express()` and `app.listen(`).' };
  return { reason: `Multiple possible Express entry files (${candidates.map(([p]) => p).join(', ')}); cannot choose safely.` };
}

function preflight(manifest, files) {
  const { framework, pkg } = detectStack(files);
  if (!pkg) return { ok: false, reason: 'package.json missing or not valid JSON.' };
  if (!manifest.stacks.includes(framework)) {
    return { ok: false, reason: `Pack supports ${manifest.stacks.join(', ')}; detected ${framework || 'no supported framework'}.` };
  }
  const ctx = { framework, pkg };
  if (framework === 'express') {
    if (pkg.type === 'module') return { ok: false, reason: 'ESM projects ("type": "module") are not supported yet by this pack.' };
    const { entry, reason } = findExpressEntry(files);
    if (!entry) return { ok: false, reason };
    const src = files[entry];
    if (src.includes(`jibe-pack:${manifest.id}`) || /security\/hardening/.test(src)) {
      return { ok: false, reason: 'Pack already applied.' };
    }
    ctx.entry = entry;
    const dir = path.posix.dirname(entry);
    ctx.entryDir = dir === '.' ? '' : `${dir}/`;
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  // Don't layer on top of existing partial setups we would duplicate.
  if (manifest.id === 'hardening-express' && deps.helmet) {
    return { ok: false, reason: 'helmet is already a dependency; pack would duplicate existing hardening.' };
  }
  return { ok: true, ctx };
}

module.exports = { preflight, detectStack, findExpressEntry };
