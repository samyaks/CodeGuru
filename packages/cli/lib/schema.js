'use strict';

// takeoff.yaml schema v2. One place for the constants the parser, validator,
// migrator and generator share.

const CURRENT_VERSION = 2;
const FILENAME = 'takeoff.yaml';

const MARKER_START = '<!-- takeoff:start -->';
const MARKER_END = '<!-- takeoff:end -->';

const ID_RE = /^[a-z][a-z0-9_-]*$/;
const AGREEMENT_ID_RE = /^agr_[a-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const KEYS = {
  root: ['version', 'product', 'areas', 'agreements'],
  product: ['name', 'summary'],
  area: ['id', 'name', 'paths', 'creators', 'rules', 'never', 'screens'],
  screen: ['name', 'route'],
  rule: ['id', 'text'],
  agreement: ['id', 'area', 'text', 'agreed_by', 'agreed_on', 'source'],
};

function isRealDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "Billing & pricing" → "billing-pricing". Empty input gives "area". */
function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z]/.test(slug) ? slug : (slug ? `a-${slug}` : 'area');
}

module.exports = {
  CURRENT_VERSION, FILENAME, MARKER_START, MARKER_END,
  ID_RE, AGREEMENT_ID_RE, EMAIL_RE, DATE_RE, KEYS, isRealDate, slugify,
};
