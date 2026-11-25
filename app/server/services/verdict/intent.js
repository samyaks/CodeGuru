'use strict';

// Read takeoff.yaml text into the shape the verdict check uses. v1 files are
// migrated in memory (nothing is written back). A file with errors is reported,
// never guessed at.

const { validateText, migrateData, FILENAME } = require('@takeoff/cli');

function textOf(item) {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object' && typeof item.text === 'string') return item.text.trim();
  return '';
}

function normalizeRules(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => ({ id: r && typeof r === 'object' && typeof r.id === 'string' ? r.id : null, text: textOf(r) }))
    .filter((r) => r.text);
}

function normalize(data) {
  const areas = (Array.isArray(data.areas) ? data.areas : []).filter((a) => a && typeof a === 'object').map((a) => ({
    id: String(a.id || ''),
    name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : String(a.id || ''),
    paths: (Array.isArray(a.paths) ? a.paths : []).filter((p) => typeof p === 'string'),
    creators: (Array.isArray(a.creators) ? a.creators : []).filter((c) => typeof c === 'string'),
    rules: normalizeRules(a.rules),
    never: normalizeRules(a.never),
  }));
  const agreements = (Array.isArray(data.agreements) ? data.agreements : [])
    .filter((g) => g && typeof g === 'object' && typeof g.text === 'string')
    .map((g) => ({ id: String(g.id || ''), area: String(g.area || ''), text: g.text.trim() }));
  return {
    product: {
      name: typeof data.product?.name === 'string' ? data.product.name : '',
      summary: typeof data.product?.summary === 'string' ? data.product.summary : '',
    },
    areas,
    agreements,
  };
}

/**
 * @param {string|null} text file contents, or null when the file is absent
 * @returns {{ present: boolean, ok: boolean, intent: object|null, errors: string[] }}
 */
function loadIntent(text) {
  if (text === null || text === undefined) return { present: false, ok: false, intent: null, errors: [] };
  const res = validateText(text);
  const errors = res.issues
    .filter((i) => i.severity === 'error')
    .map((i) => `${i.line ? `line ${i.line}: ` : ''}${i.path ? `${i.path}: ` : ''}${i.message}`);
  if (!res.ok) return { present: true, ok: false, intent: null, errors };
  const data = res.version === 1 ? migrateData(res.data).data : res.data;
  return { present: true, ok: true, intent: normalize(data), errors: [] };
}

/**
 * Which intent to check the PR against. The head's file wins (a PR that edits
 * intent is checked against its own edit); a head file with errors falls back
 * to the base, with a note.
 */
function chooseIntent(base, head) {
  if (head.ok) return { intent: head.intent, from: 'head', note: null };
  if (base.ok) {
    const note = head.present
      ? `This PR's ${FILENAME} has errors, so it was checked against the ${FILENAME} on the base branch.`
      : `This PR deletes ${FILENAME}, so it was checked against the ${FILENAME} on the base branch.`;
    return { intent: base.intent, from: 'base', note };
  }
  return { intent: null, from: null, note: null };
}

const key = (r) => r.text;

/** Area ids whose definition differs between base and head intent. */
function changedAreaIds(baseIntent, headIntent) {
  if (!baseIntent || !headIntent) return [];
  const sig = (intent, id) => {
    const a = intent.areas.find((x) => x.id === id);
    const agr = intent.agreements.filter((g) => g.area === id).map(key).sort();
    return a ? JSON.stringify([a.paths, a.rules.map(key), a.never.map(key), a.creators, agr]) : null;
  };
  const ids = new Set([...baseIntent.areas.map((a) => a.id), ...headIntent.areas.map((a) => a.id)]);
  return [...ids].filter((id) => headIntent.areas.some((a) => a.id === id) && sig(baseIntent, id) !== sig(headIntent, id));
}

module.exports = { loadIntent, chooseIntent, changedAreaIds, normalize };
