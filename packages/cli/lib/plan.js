'use strict';

// takeoff.yaml text in the plain shape every reader uses: the PR check, Ask
// and `takeoff mcp`. v1 files are migrated in memory (nothing is written
// back). A file with errors is reported, never guessed at.

const { validateText } = require('./validate');
const { migrateData } = require('./migrate');

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

/** Validated takeoff.yaml data → { product, areas, agreements }. */
function normalizeIntent(data) {
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
  return { present: true, ok: true, intent: normalizeIntent(data), errors: [] };
}

class PathError extends Error {}

const MAX_PATH = 1024;

/**
 * A repo-relative path as the PR check matches it: no leading "./", no empty
 * or "." segments. Throws PathError for anything a repo path can't be.
 */
function normalizeRepoPath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new PathError('`path` is required');
  let p = raw.trim();
  if (p.length > MAX_PATH) throw new PathError('That path is too long.');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(p)) throw new PathError('That path has characters a repo path never has.');
  if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.startsWith('~')) {
    throw new PathError('Paths are relative to the repo root, like src/app.js.');
  }
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new PathError('Paths can’t step outside the repo.');
    parts.push(seg);
  }
  if (!parts.length) throw new PathError('`path` is required');
  p = parts.join('/');
  return p;
}

module.exports = { normalizeIntent, loadIntent, normalizeRepoPath, PathError, MAX_REPO_PATH: MAX_PATH };
