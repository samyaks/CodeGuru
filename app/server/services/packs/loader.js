/**
 * Pack loader. A pack is a directory containing pack.json (see
 * PRODUCTION_PACK_SPEC.md) plus templates. Manifests are validated here so
 * the rest of the engine can trust their shape.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PACKS_DIR = path.join(__dirname, '..', '..', 'packs');

function validateManifest(m, dir) {
  const bad = (msg) => { throw new Error(`Invalid pack manifest in ${dir}: ${msg}`); };
  if (!m || typeof m !== 'object') bad('not an object');
  for (const k of ['id', 'version', 'capability']) {
    if (typeof m[k] !== 'string' || !m[k]) bad(`missing "${k}"`);
  }
  if (path.basename(dir) !== m.id) bad(`id "${m.id}" does not match directory name`);
  if (!Array.isArray(m.stacks) || !m.stacks.length) bad('"stacks" must be a non-empty array');
  for (const inp of m.inputs || []) {
    if (!inp.key || inp.default === undefined) bad(`input needs "key" and "default"`);
  }
  for (const e of m.env || []) {
    if (!e.key) bad('env entry needs "key"');
  }
  return m;
}

function loadPack(id, packsDir = DEFAULT_PACKS_DIR) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid pack id: ${id}`);
  const dir = path.join(packsDir, id);
  const manifestPath = path.join(dir, 'pack.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`Unknown pack: ${id}`);
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), dir);
  return { manifest, dir };
}

function listPacks(packsDir = DEFAULT_PACKS_DIR) {
  if (!fs.existsSync(packsDir)) return [];
  return fs.readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(packsDir, d.name, 'pack.json')))
    .map((d) => loadPack(d.name, packsDir));
}

module.exports = { loadPack, listPacks, validateManifest, DEFAULT_PACKS_DIR };
