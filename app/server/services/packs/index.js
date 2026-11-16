/**
 * Production Pack engine (prototype). See PRODUCTION_PACK_SPEC.md.
 *
 *   evaluatePack(id, files)       → eligible? (preflight + trigger detectors)
 *   applyPack(id, files, inputs)  → { ok, changes, ... } in memory, verified
 *   writeChanges(rootDir, changes)→ writes to disk (caller opens the PR)
 *   readRepoFiles(rootDir)        → files map for a checkout
 */
const fs = require('fs');
const path = require('path');
const { loadPack, listPacks, DEFAULT_PACKS_DIR } = require('./loader');
const { preflight } = require('./preflight');
const { render } = require('./render');
const { verify, runDetectors } = require('./verify');

async function evaluatePack(id, files, { packsDir } = {}) {
  const { manifest } = loadPack(id, packsDir);
  const pre = preflight(manifest, files);
  if (!pre.ok) return { id, eligible: false, reason: pre.reason };
  const findings = await runDetectors(manifest.triggers || [], files, pre.ctx);
  const triggered = Object.entries(findings).filter(([, f]) => f.length).map(([n]) => n);
  if (!triggered.length) return { id, eligible: false, reason: 'No gap detected for this pack.' };
  return { id, eligible: true, triggeredBy: triggered };
}

async function applyPack(id, files, inputs = {}, { packsDir } = {}) {
  const { manifest, dir } = loadPack(id, packsDir);
  const pre = preflight(manifest, files);
  if (!pre.ok) return { ok: false, refused: true, reason: pre.reason, changes: [] };

  let rendered;
  try {
    rendered = render({ manifest, dir, files, ctx: pre.ctx, inputs });
  } catch (e) {
    return { ok: false, refused: true, reason: e.message, changes: [] };
  }

  const after = { ...files };
  for (const c of rendered.changes) after[c.path] = c.content;
  const verification = await verify(manifest, after, pre.ctx, rendered.changes);
  return { ok: verification.ok, refused: false, packId: manifest.id, version: manifest.version, ...rendered, verification };
}

function writeChanges(rootDir, changes) {
  for (const c of changes) {
    const abs = path.resolve(rootDir, c.path);
    if (!abs.startsWith(path.resolve(rootDir) + path.sep)) throw new Error(`Path escapes repo: ${c.path}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, c.content);
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
function readRepoFiles(rootDir, { maxBytes = 500000 } = {}) {
  const out = {};
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (fs.statSync(abs).size <= maxBytes && /\.(?:js|cjs|mjs|ts|json|md)$/.test(e.name)) {
        out[path.relative(rootDir, abs).split(path.sep).join('/')] = fs.readFileSync(abs, 'utf8');
      }
    }
  })(rootDir);
  return out;
}

module.exports = { evaluatePack, applyPack, writeChanges, readRepoFiles, listPacks, loadPack, DEFAULT_PACKS_DIR };
