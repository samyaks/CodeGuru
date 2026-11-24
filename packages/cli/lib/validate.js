'use strict';

const { parse } = require('./parse');
const {
  CURRENT_VERSION, ID_RE, AGREEMENT_ID_RE, EMAIL_RE, DATE_RE, KEYS, isRealDate,
} = require('./schema');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';

function fmtPath(path) {
  return path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : (s ? `${s}.${p}` : String(p))), '');
}

/**
 * Validate takeoff.yaml text (v1 or v2). Always returns; never throws.
 * v1 files (no `version`, or `version: 1`) are checked leniently and get a
 * warning pointing at `takeoff migrate`.
 *
 * @returns {{ ok: boolean, version: number|null, issues: import('./parse').Issue[], data: any }}
 */
function validateText(text) {
  const parsed = parse(text);
  const issues = [...parsed.issues];
  if (parsed.data === null && issues.length) {
    return { ok: false, version: null, issues, data: null };
  }

  const add = (severity, path, message) => {
    const pos = parsed.position(path);
    issues.push({ severity, path: fmtPath(path), message, line: pos ? pos.line : null, col: pos ? pos.col : null });
  };
  const error = (path, message) => add('error', path, message);
  const warn = (path, message) => add('warning', path, message);

  const data = parsed.data;
  if (!isObj(data)) {
    error([], 'takeoff.yaml must be a mapping with keys like version, product and areas.');
    return { ok: false, version: null, issues, data };
  }

  const version = data.version === undefined ? 1 : data.version;
  if (version === 1) {
    validateV1(data, { error, warn });
    return finish(issues, 1, data);
  }
  if (version !== CURRENT_VERSION) {
    error(['version'], `Unsupported version ${JSON.stringify(data.version)}. Use ${CURRENT_VERSION} (or run \`takeoff migrate\` on a v1 file).`);
    return finish(issues, null, data);
  }

  checkUnknown(data, KEYS.root, [], warn);

  // product
  if (!isObj(data.product)) {
    error(['product'], 'Missing `product`. Add a name and a plain-language summary.');
  } else {
    checkUnknown(data.product, KEYS.product, ['product'], warn);
    if (!isStr(data.product.name)) error(['product', 'name'], 'Product needs a `name`.');
    if (data.product.summary === undefined) warn(['product', 'summary'], 'Add a `summary`: what the product does and for whom. Agents read it first.');
    else if (!isStr(data.product.summary)) error(['product', 'summary'], '`summary` must be a non-empty string.');
  }

  // areas
  const areaIds = new Set();
  if (data.areas === undefined) {
    warn(['areas'], 'No `areas` yet. Areas tell Takeoff which paths each rule covers.');
  } else if (!Array.isArray(data.areas)) {
    error(['areas'], '`areas` must be a list.');
  } else {
    data.areas.forEach((area, i) => validateArea(area, ['areas', i], areaIds, { error, warn }));
  }

  // agreements
  if (data.agreements !== undefined) {
    if (!Array.isArray(data.agreements)) {
      error(['agreements'], '`agreements` must be a list.');
    } else {
      const seen = new Set();
      data.agreements.forEach((a, i) => validateAgreement(a, ['agreements', i], areaIds, seen, { error, warn }));
    }
  }

  return finish(issues, CURRENT_VERSION, data);
}

function finish(issues, version, data) {
  return { ok: !issues.some((i) => i.severity === 'error'), version, issues, data };
}

function checkUnknown(obj, allowed, path, warn) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      warn([...path, key], `Unknown key \`${key}\`. Expected one of: ${allowed.join(', ')}.`);
    }
  }
}

function validateStringList(value, path, label, { error }, { required = false, item = null } = {}) {
  if (value === undefined) {
    if (required) error(path, `\`${label}\` is required.`);
    return;
  }
  if (!Array.isArray(value)) {
    error(path, `\`${label}\` must be a list.`);
    return;
  }
  if (required && value.length === 0) error(path, `\`${label}\` needs at least one entry.`);
  value.forEach((v, i) => {
    if (!isStr(v)) error([...path, i], `Each entry in \`${label}\` must be a non-empty string.`);
    else if (item) item(v, [...path, i]);
  });
}

function validateRules(value, path, label, ctx) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    ctx.error(path, `\`${label}\` must be a list.`);
    return;
  }
  const ids = new Set();
  value.forEach((r, i) => {
    const p = [...path, i];
    if (isStr(r)) return;
    if (!isObj(r)) {
      ctx.error(p, `Each rule must be a string, or a mapping with \`text\` (and optional \`id\`).`);
      return;
    }
    checkUnknown(r, KEYS.rule, p, ctx.warn);
    if (!isStr(r.text)) ctx.error([...p, 'text'], 'Rule needs `text`.');
    if (r.id !== undefined) {
      if (typeof r.id !== 'string' || !ID_RE.test(r.id)) ctx.error([...p, 'id'], 'Rule `id` must be lowercase letters, numbers, `-` or `_`, starting with a letter.');
      else if (ids.has(r.id)) ctx.error([...p, 'id'], `Duplicate rule id \`${r.id}\` in this list.`);
      else ids.add(r.id);
    }
  });
}

function validateArea(area, path, areaIds, ctx) {
  if (!isObj(area)) {
    ctx.error(path, 'Each area must be a mapping with `id`, `name` and `paths`.');
    return;
  }
  checkUnknown(area, KEYS.area, path, ctx.warn);

  if (typeof area.id !== 'string' || !ID_RE.test(area.id)) {
    ctx.error([...path, 'id'], 'Area `id` must be lowercase letters, numbers, `-` or `_`, starting with a letter (e.g. `billing`).');
  } else if (areaIds.has(area.id)) {
    ctx.error([...path, 'id'], `Duplicate area id \`${area.id}\`.`);
  } else {
    areaIds.add(area.id);
  }
  if (!isStr(area.name)) ctx.error([...path, 'name'], 'Area needs a `name`.');

  validateStringList(area.paths, [...path, 'paths'], 'paths', ctx, {
    required: true,
    item: (v, p) => {
      if (v.startsWith('/')) ctx.warn(p, 'Paths are relative to the repo root; drop the leading `/`.');
      if (v.includes('\\')) ctx.warn(p, 'Use `/` in paths, not `\\`.');
    },
  });
  validateStringList(area.creators, [...path, 'creators'], 'creators', ctx, {
    item: (v, p) => { if (!EMAIL_RE.test(v)) ctx.error(p, `\`${v}\` is not an email address.`); },
  });
  validateRules(area.rules, [...path, 'rules'], 'rules', ctx);
  validateRules(area.never, [...path, 'never'], 'never', ctx);
}

function validateAgreement(a, path, areaIds, seen, ctx) {
  if (!isObj(a)) {
    ctx.error(path, 'Each agreement must be a mapping with `id`, `text`, `agreed_by` and `agreed_on`.');
    return;
  }
  checkUnknown(a, KEYS.agreement, path, ctx.warn);

  if (typeof a.id !== 'string' || !AGREEMENT_ID_RE.test(a.id)) {
    ctx.error([...path, 'id'], 'Agreement `id` must look like `agr_2026_11_24_annual_plan` (lowercase, `agr_` prefix).');
  } else if (seen.has(a.id)) {
    ctx.error([...path, 'id'], `Duplicate agreement id \`${a.id}\`.`);
  } else {
    seen.add(a.id);
  }
  if (!isStr(a.text)) ctx.error([...path, 'text'], 'Agreement needs `text`.');

  if (a.area !== undefined) {
    if (typeof a.area !== 'string') ctx.error([...path, 'area'], '`area` must be an area id.');
    else if (!areaIds.has(a.area)) ctx.error([...path, 'area'], `No area with id \`${a.area}\`. Defined areas: ${[...areaIds].join(', ') || '(none)'}.`);
  }

  validateStringList(a.agreed_by, [...path, 'agreed_by'], 'agreed_by', ctx, {
    required: true,
    item: (v, p) => { if (!EMAIL_RE.test(v)) ctx.error(p, `\`${v}\` is not an email address.`); },
  });

  if (a.agreed_on === undefined) ctx.error([...path, 'agreed_on'], 'Agreement needs `agreed_on` (YYYY-MM-DD).');
  else if (typeof a.agreed_on !== 'string' || !DATE_RE.test(a.agreed_on) || !isRealDate(a.agreed_on)) {
    ctx.error([...path, 'agreed_on'], '`agreed_on` must be a real date written YYYY-MM-DD.');
  }

  if (a.source !== undefined) {
    let okUrl = false;
    try { okUrl = /^https?:$/.test(new URL(String(a.source)).protocol); } catch { /* not a URL */ }
    if (!okUrl) ctx.error([...path, 'source'], '`source` must be an http(s) URL.');
  }
}

/**
 * v1 is lenient: it only has to be readable by `migrate`. Accepted shapes are
 * described in lib/migrate.js. Here we flag what migrate can't use.
 */
function validateV1(data, { error, warn }) {
  warn(['version'], 'This is a v1 file. Run `takeoff migrate` to upgrade it to v2.');
  for (const key of ['rules', 'never']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) error([key], `\`${key}\` must be a list.`);
  }
  if (data.areas !== undefined && !Array.isArray(data.areas)) error(['areas'], '`areas` must be a list.');
}

module.exports = { validateText, fmtPath };
