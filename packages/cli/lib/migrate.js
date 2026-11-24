'use strict';

const YAML = require('yaml');
const { CURRENT_VERSION, slugify } = require('./schema');

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

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function ruleList(v) {
  return asList(v).filter((r) => nonEmpty(r) || (r && typeof r === 'object' && nonEmpty(r.text)));
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
    const paths = asList(a.paths !== undefined ? a.paths : a.path).filter(nonEmpty);
    if (!paths.length) notes.push(`Area "${areaName}" has no paths; add some so Takeoff knows which files it covers.`);
    const out = { id: uniqueId(nonEmpty(a.id) && /^[a-z][a-z0-9_-]*$/.test(a.id) ? a.id : slugify(areaName)), name: areaName, paths };
    const creators = asList(a.creators !== undefined ? a.creators : a.creator).filter(nonEmpty);
    if (creators.length) out.creators = creators;
    const rules = ruleList(a.rules);
    if (rules.length) out.rules = rules;
    const never = ruleList(a.never !== undefined ? a.never : a.avoid);
    if (never.length) out.never = never;
    areas.push(out);
  }

  const topRules = ruleList(src.rules);
  const topNever = ruleList(src.never !== undefined ? src.never : src.avoid);
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
