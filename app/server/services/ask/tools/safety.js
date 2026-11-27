'use strict';

/**
 * Shared checks for Ask's read-only tools (Milestone 8, PR 3). The tools
 * enforce these themselves; nothing depends on the model's prompt.
 */

const { isNeverReadable, redactSecrets, secretFileReason, REDACTED } = require('../../code-index/filter');

class AskToolError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'AskToolError';
    this.code = code;
  }
}

const MAX_PATH = 1024;

/**
 * A repo-relative path, normalized. Refuses absolute paths, `..`, empty
 * segments after cleaning, backslashes and control characters.
 */
function normalizePath(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new AskToolError('`path` is required');
  let p = raw.trim();
  if (p.length > MAX_PATH) throw new AskToolError('That path is too long.');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(p)) throw new AskToolError('That path has characters a repo path never has.');
  if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.startsWith('~')) {
    throw new AskToolError('Paths are relative to the repo root, like src/app.js.');
  }
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new AskToolError('Paths can’t step outside the repo.');
    parts.push(seg);
  }
  if (!parts.length) throw new AskToolError('`path` is required');
  p = parts.join('/');
  return p;
}

/** A glob for list_files / search_code, length-limited. `null` when absent. */
function normalizeGlob(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new AskToolError('`path_glob` must be text');
  const g = raw.trim().replace(/^\.\//, '');
  if (!g) return null;
  if (g.length > 200) throw new AskToolError('That pattern is too long.');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\\]/.test(g) || g.startsWith('/') || g.split('/').includes('..')) {
    throw new AskToolError('Patterns are relative to the repo root, like src/**/*.js.');
  }
  return g;
}

/** The literal start of a glob, as an escaped LIKE prefix (or null). */
function likePrefixOf(glob) {
  if (!glob) return null;
  const i = glob.search(/[*?[{]/);
  const lit = i === -1 ? glob : glob.slice(0, i);
  if (!lit) return null;
  return `${lit.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The literal end of a glob's last segment, as an escaped LIKE suffix (or
 * null). The glob for every .sql file gives `%.sql`. Paths that match it always end
 * with it, so it only narrows the rows SQL returns; the glob still decides.
 */
function likeSuffixOf(glob) {
  if (!glob) return null;
  const m = glob.match(/[*?\]}]([^*?[\]{}]*)$/);
  if (!m) return null;
  const lit = m[1].slice(m[1].lastIndexOf('/') + 1);
  if (!lit) return null;
  return `%${lit.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
}

/** Words a full-text query can use: letters, digits and _, lower case, at most 8. */
function searchTerms(query) {
  if (typeof query !== 'string' || !query.trim()) throw new AskToolError('`query` is required');
  if (query.length > 300) throw new AskToolError('That search is too long.');
  const words = query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((w) => w.length >= 2 && w.length <= 80);
  const uniq = [...new Set(words)].slice(0, 8);
  if (!uniq.length) throw new AskToolError('Search for at least one word of two letters or more.');
  return uniq;
}

/** Never shown to the model: keys, credentials, .env files and the like. */
function refusedPath(path) {
  return isNeverReadable(path);
}

/** Redact again before the model sees text, in case a pattern was added since the index was built. */
function cleanText(text, path) {
  if (typeof text !== 'string') return { text: '', redactions: 0 };
  const { text: out, count } = redactSecrets(text, path);
  return { text: out, redactions: count };
}

/**
 * Whether a stored file's whole text marks it as a secret (a private key
 * block, a Kubernetes Secret). Checked at read time too, for indexes built
 * before a rule existed. Returns the skip reason, or null.
 */
function unsafeContent(text, path) {
  return secretFileReason(path, text);
}

/** How many secrets were hidden in this text. */
function redactedCount(text) {
  return typeof text === 'string' ? text.split(REDACTED).length - 1 : 0;
}

function clampInt(raw, { min, max, fallback }) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new AskToolError('Expected a number.');
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function short(text, max) {
  const t = String(text == null ? '' : text);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** An ISO date (YYYY-MM-DD or full), at most `maxDays` back. */
function sinceDate(raw, { defaultDays, maxDays, now = Date.now() }) {
  const floor = now - maxDays * 86400000;
  if (raw == null || raw === '') return new Date(Math.max(floor, now - defaultDays * 86400000));
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new AskToolError('`since` must be a date like 2026-11-01.');
  return new Date(Math.max(floor, Math.min(d.getTime(), now)));
}

module.exports = {
  AskToolError, normalizePath, normalizeGlob, likePrefixOf, likeSuffixOf, searchTerms, refusedPath, cleanText,
  unsafeContent, redactedCount, clampInt, short, sinceDate,
};
