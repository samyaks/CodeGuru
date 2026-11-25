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
    // An agreement without an area is product-wide (area: null).
    .map((g) => ({ id: String(g.id || ''), area: typeof g.area === 'string' && g.area.trim() ? g.area.trim() : null, text: g.text.trim() }));
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

const short = (t) => (t.length > 160 ? `${t.slice(0, 159)}…` : t);

/**
 * What a PR's edit to takeoff.yaml changes, worked out in code (the model is
 * never trusted to notice). `areaIds` are base areas whose rules, paths or
 * agreements the edit changes or removes.
 * @returns {{ changes: string[], areaIds: string[], productWide: boolean }}
 */
function diffIntent(base, head) {
  const changes = [];
  const areaIds = new Set();
  let productWide = false;
  const texts = (list) => new Set(list.map((r) => r.text));
  for (const a of base.areas) {
    const h = head.areas.find((x) => x.id === a.id);
    if (!h) {
      changes.push(`Removes the area "${short(a.name)}" and its rules.`);
      areaIds.add(a.id);
      continue;
    }
    if (JSON.stringify([...a.paths].sort()) !== JSON.stringify([...h.paths].sort())) {
      changes.push(`Changes which paths "${short(a.name)}" covers (from ${short(a.paths.join(', ') || 'none')} to ${short(h.paths.join(', ') || 'none')}).`);
      areaIds.add(a.id);
    }
    for (const kind of ['rules', 'never']) {
      const label = kind === 'rules' ? 'rule' : 'never-rule';
      const before = texts(a[kind]);
      const after = texts(h[kind]);
      for (const t of before) if (!after.has(t)) { changes.push(`Removes or rewords the ${label} "${short(t)}" in "${short(a.name)}".`); areaIds.add(a.id); }
      for (const t of after) if (!before.has(t)) { changes.push(`Adds the ${label} "${short(t)}" to "${short(a.name)}".`); areaIds.add(a.id); }
    }
    if (JSON.stringify([...a.creators].sort()) !== JSON.stringify([...h.creators].sort())) {
      changes.push(`Changes who the Creators of "${short(a.name)}" are.`);
      areaIds.add(a.id);
    }
  }
  for (const h of head.areas) {
    if (!base.areas.some((a) => a.id === h.id)) changes.push(`Adds a new area "${short(h.name)}".`);
  }
  const agrKey = (g) => `${g.area || ''}\u0000${g.text}`;
  const baseAgr = new Map(base.agreements.map((g) => [agrKey(g), g]));
  const headAgr = new Map(head.agreements.map((g) => [agrKey(g), g]));
  const note = (g, verb) => {
    changes.push(`${verb} the ${g.area ? `"${g.area}"` : 'product-wide'} agreement "${short(g.text)}".`);
    if (g.area) areaIds.add(g.area); else productWide = true;
  };
  for (const [k, g] of baseAgr) if (!headAgr.has(k)) note(g, 'Removes or rewords');
  for (const [k, g] of headAgr) if (!baseAgr.has(k)) note(g, 'Adds');
  if (base.product.summary !== head.product.summary || base.product.name !== head.product.name) {
    changes.push('Changes the product name or summary.');
  }
  return { changes, areaIds: [...areaIds].filter((id) => base.areas.some((a) => a.id === id)), productWide };
}

/**
 * Which intent to judge the PR against, and what the PR changes in it.
 *
 * The base branch's takeoff.yaml is the intent in effect, so it is what the
 * code is judged against, even when the PR edits takeoff.yaml: the author
 * can't loosen a rule in the same PR that breaks it. Edits to takeoff.yaml
 * are listed as proposed changes, and any edit means a person decides.
 *
 * @param {{ base, head, yamlInPr: boolean, yamlRemoved: boolean }} input  base/head from loadIntent
 * @returns {{ intent: object|null, from: 'base'|'head'|null, changes: string[], areaIds: string[], productWide: boolean, error: string|null }}
 */
function chooseIntent({ base, head, yamlInPr, yamlRemoved = false }) {
  const none = { changes: [], areaIds: [], productWide: false, error: null };
  if (!yamlInPr) {
    if (base.ok) return { ...none, intent: base.intent, from: 'base' };
    return { ...none, intent: null, from: null, error: base.errors[0] || `${FILENAME} could not be read` };
  }
  if (base.ok) {
    if (head.ok) return { ...diffIntent(base.intent, head.intent), intent: base.intent, from: 'base', error: null };
    const change = yamlRemoved || !head.present
      ? `Deletes ${FILENAME}.`
      : `Leaves ${FILENAME} with errors (${head.errors[0] || 'it could not be read'}).`;
    return { intent: base.intent, from: 'base', changes: [change], areaIds: base.intent.areas.map((a) => a.id), productWide: true, error: null };
  }
  if (head.ok) {
    const change = base.present ? `Fixes ${FILENAME}, which has errors on the base branch.` : `Adds ${FILENAME}.`;
    return { intent: head.intent, from: 'head', changes: [change], areaIds: [], productWide: false, error: null };
  }
  const errors = head.present ? head.errors : base.errors;
  return { ...none, intent: null, from: null, error: errors[0] || `${FILENAME} could not be read` };
}

module.exports = { loadIntent, chooseIntent, diffIntent, normalize };
