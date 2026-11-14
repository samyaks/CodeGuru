/**
 * Render: turn (manifest, repo files, inputs) into a list of file changes.
 * Pure — nothing is written. Patches are anchored line insertions; a patch
 * whose anchor does not match as expected throws, so nothing is half-applied.
 */
const fs = require('fs');
const path = require('path');

function resolveInputs(manifest, given = {}) {
  const out = {};
  for (const spec of manifest.inputs || []) {
    const v = given[spec.key] === undefined ? spec.default : given[spec.key];
    if (spec.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) throw new Error(`Input "${spec.key}" must be an integer.`);
      if (spec.min !== undefined && v < spec.min) throw new Error(`Input "${spec.key}" must be >= ${spec.min}.`);
      if (spec.max !== undefined && v > spec.max) throw new Error(`Input "${spec.key}" must be <= ${spec.max}.`);
    } else if (spec.type === 'string') {
      if (typeof v !== 'string' || /[\r\n{}]/.test(v)) throw new Error(`Input "${spec.key}" must be a plain string.`);
    } else {
      throw new Error(`Unsupported input type "${spec.type}" for "${spec.key}".`);
    }
    out[spec.key] = v;
  }
  for (const k of Object.keys(given)) {
    if (!(k in out)) throw new Error(`Unknown input "${k}".`);
  }
  return out;
}

function substitute(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Template placeholder {{${k}}} has no value.`);
    return String(vars[k]);
  });
}

function applyPatch(source, patch) {
  const lines = source.split('\n');
  const re = new RegExp(patch.match);
  const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) throw new Error(`Patch anchor not found: /${patch.match}/`);
  const insert = patch.text.replace(/\n$/, '').split('\n');
  switch (patch.op) {
    case 'after-last-match':
      lines.splice(hits[hits.length - 1] + 1, 0, ...insert);
      break;
    case 'after-only-match':
      if (hits.length !== 1) throw new Error(`Expected exactly one match for /${patch.match}/, found ${hits.length}.`);
      lines.splice(hits[0] + 1, 0, ...insert);
      break;
    case 'before-first-match':
      lines.splice(hits[0], 0, ...insert);
      break;
    default:
      throw new Error(`Unknown patch op "${patch.op}".`);
  }
  return lines.join('\n');
}

function patchPackageJson(raw, deps) {
  const indent = (raw.match(/^(\s+)"/m) || [, '  '])[1];
  const pkg = JSON.parse(raw);
  const existing = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const added = {};
  pkg.dependencies = pkg.dependencies || {};
  for (const [name, range] of Object.entries(deps || {})) {
    if (existing[name]) continue; // never override the user's chosen version
    pkg.dependencies[name] = range;
    added[name] = range;
  }
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  return { content: JSON.stringify(pkg, null, indent) + (raw.endsWith('\n') ? '\n' : ''), added };
}

function render({ manifest, dir, files, ctx, inputs }) {
  const vars = { ...resolveInputs(manifest, inputs), entryDir: ctx.entryDir || '' };
  const changes = [];

  for (const f of manifest.files || []) {
    const to = substitute(f.to, vars);
    if (files[to] !== undefined) throw new Error(`Refusing to overwrite existing file ${to}.`);
    const tpl = fs.readFileSync(path.join(dir, f.from), 'utf8');
    changes.push({ path: to, action: 'add', content: substitute(tpl, vars) });
  }

  if (ctx.entry && manifest.entryPatches) {
    let src = files[ctx.entry];
    for (const p of manifest.entryPatches) src = applyPatch(src, { ...p, text: substitute(p.text, vars) });
    // Marker lets preflight recognise an already-applied pack.
    src = src.replace(/\n*$/, `\n// jibe-pack:${manifest.id}@${manifest.version}\n`);
    changes.push({ path: ctx.entry, action: 'modify', content: src });
  }

  const { content, added } = patchPackageJson(files['package.json'], manifest.dependencies);
  if (Object.keys(added).length) changes.push({ path: 'package.json', action: 'modify', content });

  return {
    changes,
    dependenciesAdded: added,
    env: manifest.env || [],
    inputs: vars,
  };
}

module.exports = { render, resolveInputs, applyPatch, patchPackageJson, substitute };
