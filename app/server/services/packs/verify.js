/**
 * Verify: re-run the existing security detectors against the post-apply file
 * map and run cheap deterministic checks. Reuses the detector contract
 * (services/security/detectors/*) rather than defining a second one.
 */
const vm = require('vm');
const path = require('path');

const DETECTORS = {
  'missing-helmet': require('../security/detectors/missing-helmet'),
  'cors-wildcard': require('../security/detectors/cors-wildcard'),
};

async function runDetectors(names, files, ctx) {
  const input = {
    stack: { framework: ctx.framework === 'express' ? 'Express' : ctx.framework },
    structure: { entryPoints: ctx.entry ? [ctx.entry] : [] },
    fileContents: files,
    files: Object.keys(files).map((p) => ({ path: p })),
  };
  const out = {};
  for (const n of names) {
    if (!DETECTORS[n]) throw new Error(`Unknown detector "${n}" in pack manifest.`);
    out[n] = (await DETECTORS[n].run(input)) || [];
  }
  return out;
}

// Compile (don't run) every JS file the pack touched, as CommonJS.
function syntaxCheck(changes) {
  const errors = [];
  for (const c of changes) {
    if (!/\.(?:js|cjs)$/.test(c.path)) continue;
    try {
      new vm.Script(`(function (exports, require, module, __filename, __dirname) {${c.content}\n})`, { filename: c.path });
    } catch (e) {
      errors.push(`${c.path}: ${e.message}`);
    }
  }
  return errors;
}

async function verify(manifest, filesAfter, ctx, changes) {
  const spec = manifest.verify || {};
  const detectorFindings = await runDetectors(spec.detectors || [], filesAfter, ctx);
  const failed = Object.entries(detectorFindings).filter(([, f]) => f.length).map(([n]) => n);
  const checks = [];
  if ((spec.checks || []).includes('syntax')) {
    const touched = changes || Object.entries(filesAfter).map(([p, content]) => ({ path: p, content }))
      .filter((c) => /security\/hardening\.js$/.test(c.path) || c.path === ctx.entry);
    const errors = syntaxCheck(touched);
    checks.push({ name: 'syntax', ok: !errors.length, errors });
  }
  const ok = !failed.length && checks.every((c) => c.ok);
  return { ok, detectors: Object.fromEntries(Object.entries(detectorFindings).map(([n, f]) => [n, { ok: !f.length, findings: f.length }])), checks };
}

module.exports = { verify, runDetectors, syntaxCheck };
