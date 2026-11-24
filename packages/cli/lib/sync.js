'use strict';

const fs = require('fs');
const path = require('path');
const { validateText } = require('./validate');
const { migrateData } = require('./migrate');
const { renderBlock, applyBlock, TARGETS } = require('./generate');
const { FILENAME } = require('./schema');

class TakeoffError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'TakeoffError';
    this.issues = issues;
  }
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Generate the agent instruction files from takeoff.yaml.
 *
 * @param {{ dir?: string, file?: string, check?: boolean, dryRun?: boolean }} opts
 * @returns {{ results: Array<{ path: string, action: 'created'|'updated'|'unchanged' }>, notes: string[], inSync: boolean }}
 * @throws {TakeoffError} when takeoff.yaml is missing/invalid or a target's markers are broken
 */
function sync({ dir = process.cwd(), file = null, check = false, dryRun = false } = {}) {
  const yamlPath = file ? path.resolve(dir, file) : path.join(dir, FILENAME);
  const text = readIfExists(yamlPath);
  if (text === null) throw new TakeoffError(`${path.relative(dir, yamlPath) || FILENAME} not found.`);

  const v = validateText(text);
  const errors = v.issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new TakeoffError(`${path.basename(yamlPath)} has ${errors.length} error(s); fix them first (run \`takeoff validate\`).`, v.issues);

  const notes = [];
  let data = v.data;
  if (v.version === 1) {
    data = migrateData(v.data).data;
    notes.push('takeoff.yaml is v1; generated from an in-memory upgrade. Run `takeoff migrate` to upgrade the file.');
  }

  const block = renderBlock(data);
  const planned = TARGETS.map((t) => {
    const target = path.join(dir, t.path);
    const existing = readIfExists(target);
    const { text: next, error } = applyBlock(existing, block, { prefix: t.prefix });
    if (error) throw new TakeoffError(`${t.path}: ${error}`);
    const action = existing === null ? 'created' : (next === existing ? 'unchanged' : 'updated');
    return { target, rel: t.path, next, action };
  });

  if (!check && !dryRun) {
    for (const p of planned) {
      if (p.action === 'unchanged') continue;
      fs.mkdirSync(path.dirname(p.target), { recursive: true });
      fs.writeFileSync(p.target, p.next);
    }
  }

  return {
    results: planned.map((p) => ({ path: p.rel, action: p.action })),
    notes,
    inSync: planned.every((p) => p.action === 'unchanged'),
  };
}

module.exports = { sync, TakeoffError, readIfExists };
