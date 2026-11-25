'use strict';

const YAML = require('yaml');
const { CURRENT_VERSION, ID_RE, EMAIL_RE, slugify } = require('./schema');

// v1 had no schema of its own in the repo, so `migrate` accepts every plain
// shape a hand-written file would reasonably take:
//
//   name | product: "Delta-V" | product: { name, summary }
//   summary | description: "..."
//   rules: [...]   never: [...]         (apply to the whole product)
//   areas: [{ name | id, path | paths, rules, never, creators }]
//
// Anything else is dropped and reported in `notes`, never silently.

const V1_KNOWN = new Set(['version', 'name', 'product', 'summary', 'description', 'rules', 'never', 'avoid', 'areas']);
const V1_AREA_KNOWN = new Set(['id', 'name', 'path', 'paths', 'creator', 'creators', 'rules', 'never', 'avoid', 'screens']);

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Rules as v2 accepts them: strings, or { text, id? } with a valid, unique id.
 * Anything dropped or changed is reported through `note`.
 */
function ruleList(v, where, note) {
  const out = [];
  const ids = new Set();
  for (const r of asList(v)) {
    if (nonEmpty(r)) {
      out.push(r);
    } else if (r && typeof r === 'object' && !Array.isArray(r) && nonEmpty(r.text)) {
      if (r.id === undefined) {
        out.push(r.text);
      } else if (typeof r.id === 'string' && ID_RE.test(r.id) && !ids.has(r.id)) {
        ids.add(r.id);
        out.push({ id: r.id, text: r.text });
      } else {
        note(`${where}: rule id ${JSON.stringify(r.id)} is not a valid, unique lowercase id; kept the rule without it.`);
        out.push(r.text);
      }
    } else {
      note(`${where}: dropped an entry that is not a rule (${JSON.stringify(r)}).`);
    }
  }
  return out;
}

function screenList(v, where, note) {
  const out = [];
  for (const sc of asList(v)) {
    if (sc && typeof sc === 'object' && nonEmpty(sc.name) && typeof sc.route === 'string'
      && sc.route.startsWith('/') && !sc.route.startsWith('//') && !/\s/.test(sc.route)) {
      out.push({ name: sc.name, route: sc.route });
    } else {
      note(`${where}: dropped a screen without a name and a route like \`/checkout\` (${JSON.stringify(sc)}).`);
    }
  }
  return out;
}

/**
 * @param {any} v1 parsed v1 data
 * @returns {{ data: object, notes: string[] }} v2 data, plus what could not be carried over
 */
function migrateData(v1) {
  const notes = [];
  const src = v1 && typeof v1 === 'object' && !Array.isArray(v1) ? v1 : {};

  let name = null;
  let summary = null;
  if (typeof src.product === 'string') name = src.product;
  else if (src.product && typeof src.product === 'object') {
    name = src.product.name;
    summary = src.product.summary || src.product.description;
  }
  name = nonEmpty(name) ? name : (nonEmpty(src.name) ? src.name : null);
  summary = nonEmpty(summary) ? summary : (nonEmpty(src.summary) ? src.summary : (nonEmpty(src.description) ? src.description : null));
  if (!name) {
    name = 'My product';
    notes.push('No product name found; set `product.name`.');
  }
  if (!summary) notes.push('No summary found; add `product.summary` (what the product does and for whom).');

  const product = { name };
  if (summary) product.summary = summary;

  const areas = [];
  const used = new Set();
  const uniqueId = (base) => {
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  for (const [i, a] of asList(src.areas).entries()) {
    if (!a || typeof a !== 'object') {
      notes.push(`areas[${i}] is not a mapping; dropped.`);
      continue;
    }
    const areaName = nonEmpty(a.name) ? a.name : (nonEmpty(a.id) ? a.id : `Area ${i + 1}`);
    const where = `Area "${areaName}"`;
    const note = (n) => notes.push(n);

    const rawPaths = asList(a.paths !== undefined ? a.paths : a.path);
    let paths = rawPaths.filter(nonEmpty);
    if (paths.length < rawPaths.length) notes.push(`${where}: dropped ${rawPaths.length - paths.length} path(s) that were not text.`);
    if (!paths.length) {
      paths = ['**'];
      notes.push(`${where} had no paths, so it now covers every file (\`**\`). Narrow it so Takeoff knows which files it covers.`);
    }
    const out = { id: uniqueId(nonEmpty(a.id) && ID_RE.test(a.id) ? a.id : slugify(areaName)), name: areaName, paths };

    const rawCreators = asList(a.creators !== undefined ? a.creators : a.creator);
    const creators = rawCreators.filter((c) => nonEmpty(c) && EMAIL_RE.test(c.trim())).map((c) => c.trim());
    const notEmails = rawCreators.filter((c) => !(nonEmpty(c) && EMAIL_RE.test(c.trim())));
    if (notEmails.length) notes.push(`${where}: creators must be email addresses; dropped ${notEmails.map((c) => JSON.stringify(c)).join(', ')}.`);
    if (creators.length) out.creators = creators;

    const rules = ruleList(a.rules, where, note);
    if (rules.length) out.rules = rules;
    const never = ruleList(a.never !== undefined ? a.never : a.avoid, where, note);
    if (never.length) out.never = never;
    const screens = screenList(a.screens, where, note);
    if (screens.length) out.screens = screens;

    for (const key of Object.keys(a)) {
      if (!V1_AREA_KNOWN.has(key)) notes.push(`${where}: unknown key \`${key}\` was not carried over.`);
    }
    areas.push(out);
  }

  const topNote = (n) => notes.push(n);
  const topRules = ruleList(src.rules, 'Top-level rules', topNote);
  const topNever = ruleList(src.never !== undefined ? src.never : src.avoid, 'Top-level never', topNote);
  if (topRules.length || topNever.length) {
    const general = { id: uniqueId('general'), name: 'General', paths: ['**'] };
    if (topRules.length) general.rules = topRules;
    if (topNever.length) general.never = topNever;
    areas.push(general);
    notes.push('Top-level `rules` / `never` moved into a "General" area covering every path.');
  }

  for (const key of Object.keys(src)) {
    if (!V1_KNOWN.has(key)) notes.push(`Unknown key \`${key}\` was not carried over.`);
  }

  return { data: { version: CURRENT_VERSION, product, areas, agreements: [] }, notes };
}

/** Stable text form of a v2 object. Empty `agreements` are left out. */
function stringifyV2(data) {
  const out = { version: data.version, product: data.product, areas: data.areas };
  if (Array.isArray(data.agreements) && data.agreements.length) out.agreements = data.agreements;
  return YAML.stringify(out, { lineWidth: 0 });
}

module.exports = { migrateData, stringifyV2 };
