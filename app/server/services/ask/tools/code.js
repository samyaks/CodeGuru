'use strict';

/**
 * Code tools: search_code, find_symbol, list_files, read_file, find_usages.
 * They read only Takeoff's stored code index, never GitHub. When there is no
 * usable index yet they say so (and a build is started), rather than
 * reading the repo live.
 */

const { globMatches } = require('../../verdict/globs');
const {
  AskToolError, normalizePath, normalizeGlob, likePrefixOf, likeSuffixOf, searchTerms, refusedPath, cleanText,
  unsafeContent, redactedCount, clampInt, short,
} = require('./safety');

const LIMITS = Object.freeze({
  searchHits: 15,
  snippetChars: 300,
  symbols: 20,
  listPaths: 200,
  readLines: 400,
  readBytes: 24 * 1024,
  fileReads: 6,
  usages: 30,
  searchRows: 500,
  listRows: 20000,
});

const SKIP_REASONS = {
  never_readable: 'This file holds keys or credentials, so Takeoff never stores or shows its text.',
  private_key: 'This file holds a private key, so Takeoff never stores or shows its text.',
  too_large: 'This file is too large to store, so its text isn’t available.',
  binary: 'This is a binary file, so it has no text to show.',
  skipped_dir: 'This is in a vendored, generated or dependency folder, so its text isn’t stored.',
  lockfile: 'Lockfiles aren’t stored.',
  minified: 'This file is minified, so its text isn’t stored.',
  unsafe_path: 'This path can’t be read.',
};

const sha12 = (sha) => String(sha || '').slice(0, 12);

/** The index this question reads, once. Starts a build when there is none. */
function index(ctx) {
  // The promise is cached, so tool calls made side by side share one read.
  if (!ctx.cache.index) ctx.cache.index = readIndex(ctx);
  return ctx.cache.index;
}

async function readIndex(ctx) {
  const { project, deps } = ctx;
  let row = null;
  try { row = await deps.codeIndex.getRepo(project.id); } catch { row = null; }
  let value;
  if (row && row.indexed_sha && ['ready', 'behind'].includes(row.status)) {
    value = { ok: true, sha: row.indexed_sha, behind: row.status === 'behind' };
  } else {
    if (deps.ensureBuilt) Promise.resolve(deps.ensureBuilt(project)).catch(() => {});
    let reason = 'Takeoff is still storing this repo’s code, so code questions can’t be answered yet. Try again in a few minutes.';
    if (row && row.status === 'too_large') reason = 'This repo is too large for Takeoff to store, so code questions can’t be answered. Plan questions still can.';
    else if (row && row.status === 'failed') reason = 'Takeoff couldn’t store this repo’s code last time it tried; it will try again. Plan questions still work.';
    value = { ok: false, reason };
  }
  return value;
}

function notReady(ix) {
  return { available: false, reason: ix.reason, sources: [] };
}

function header(ix) {
  return {
    available: true,
    code_as_of: ix.sha,
    note: ix.behind ? 'Recent pushes may not be in the stored code yet.' : undefined,
  };
}

/**
 * Registers a code source. `text` is what the model was shown, kept so a
 * citation is checked against that and not against a later re-read.
 */
function codeSource(ctx, ix, path, start, end, text = null) {
  const id = start ? `code:${path}@${sha12(ix.sha)}:L${start}-${end}` : `code:${path}@${sha12(ix.sha)}`;
  ctx.addSource(id, { kind: 'code', path, sha: ix.sha, start: start || null, end: end || null, text });
  return id;
}

/** Lines around the first lines that contain a term. */
function snippetFor(text, terms, max) {
  const lines = text.split('\n');
  const lower = terms.map((t) => t.toLowerCase());
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].toLowerCase();
    if (lower.some((t) => l.includes(t))) {
      const start = Math.max(0, i - 1);
      let end = Math.min(lines.length - 1, i + 2);
      let snippet = lines.slice(start, end + 1).join('\n');
      while (snippet.length > max && end > i) { end -= 1; snippet = lines.slice(start, end + 1).join('\n'); }
      return { start: start + 1, end: end + 1, text: short(snippet, max) };
    }
  }
  return { start: 1, end: Math.min(lines.length, 3), text: short(lines.slice(0, 3).join('\n'), max) };
}

/** search_code(query, path_glob?) */
async function searchCode(ctx, input = {}) {
  const terms = searchTerms(input.query);
  const glob = normalizeGlob(input.path_glob);
  const ix = await index(ctx);
  if (!ix.ok) return notReady(ix);
  const rows = await ctx.deps.codeIndex.search(ctx.project.id, {
    terms, likePrefix: likePrefixOf(glob), likeSuffix: likeSuffixOf(glob), limit: LIMITS.searchRows,
  });
  // Ranked paths first; text is read only for the few files shown.
  const passing = rows.filter((r) => (!glob || globMatches(glob, r.path)) && !refusedPath(r.path));
  const wanted = passing.slice(0, LIMITS.searchHits + 5).map((r) => r.path);
  const texts = new Map((await ctx.deps.codeIndex.contents(ctx.project.id, wanted)).map((r) => [r.path, r]));
  const hits = [];
  let dropped = 0;
  for (const p of wanted) {
    if (hits.length >= LIMITS.searchHits) break;
    const row = texts.get(p);
    if (!row || row.content == null || unsafeContent(row.content, p)) { dropped += 1; continue; }
    const { text } = cleanText(row.content, p);
    const snip = snippetFor(text, terms, LIMITS.snippetChars);
    hits.push({
      source_id: codeSource(ctx, ix, p, snip.start, snip.end, snip.text),
      path: p,
      lines: `${snip.start}-${snip.end}`,
      snippet: snip.text,
    });
  }
  const matchedAll = rows.length ? rows[0].matchedAll !== false : true;
  return {
    ...header(ix),
    query: terms.join(' '),
    match: matchedAll ? 'all words' : 'some words (no file has all of them)',
    hits,
    more: passing.length - dropped > hits.length || rows.length >= LIMITS.searchRows,
    sources: hits.map((h) => h.source_id),
  };
}

/** find_symbol(name) */
async function findSymbol(ctx, input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 200) throw new AskToolError('`name` is required');
  const ix = await index(ctx);
  if (!ix.ok) return notReady(ix);
  const rows = await ctx.deps.codeIndex.findSymbols(ctx.project.id, name, { limit: LIMITS.symbols });
  const found = rows.filter((r) => !refusedPath(r.path)).map((r) => ({
    source_id: codeSource(ctx, ix, r.path, r.line, r.line),
    name: r.symbol,
    kind: r.kind,
    path: r.path,
    line: r.line,
    exact: !!r.exact,
  }));
  return { ...header(ix), name, found, sources: found.map((f) => f.source_id) };
}

/** list_files(path_glob) */
async function listFiles(ctx, input = {}) {
  const glob = normalizeGlob(input.path_glob);
  const ix = await index(ctx);
  if (!ix.ok) return notReady(ix);
  const rows = await ctx.deps.codeIndex.listPathsUnder(ctx.project.id, {
    likePrefix: likePrefixOf(glob), likeSuffix: likeSuffixOf(glob), limit: LIMITS.listRows,
  });
  const files = [];
  let total = 0;
  for (const r of rows) {
    if (glob && !globMatches(glob, r.path)) continue;
    // Key and credential files are left out of listings, names included.
    if (refusedPath(r.path)) continue;
    total += 1;
    if (files.length < LIMITS.listPaths) {
      files.push({ path: r.path, readable: !r.skipped_reason, size: Number(r.size_bytes) || 0 });
    }
  }
  return {
    ...header(ix),
    pattern: glob,
    files,
    total_matching: rows.length >= LIMITS.listRows ? `${total}+` : total,
    more: total > files.length,
    sources: [],
  };
}

/** read_file(path, start?, end?) */
async function readFile(ctx, input = {}) {
  const path = normalizePath(input.path);
  if (refusedPath(path)) {
    return { available: true, path, readable: false, reason: SKIP_REASONS.never_readable, sources: [] };
  }
  const ix = await index(ctx);
  if (!ix.ok) return notReady(ix);
  const row = await ctx.deps.codeIndex.readFile(ctx.project.id, path);
  if (!row) return { ...header(ix), path, exists: false, reason: 'There is no file at that path in the stored code.', sources: [] };
  if (row.skipped_reason || row.content == null) {
    return { ...header(ix), path, exists: true, readable: false, reason: SKIP_REASONS[row.skipped_reason] || 'This file’s text isn’t stored.', sources: [] };
  }
  // The whole file is checked, since a slice can start inside a key block.
  const secret = unsafeContent(row.content, path);
  if (secret) return { ...header(ix), path, exists: true, readable: false, reason: SKIP_REASONS[secret], sources: [] };
  // Only reads that return text count toward the cap.
  if (ctx.counters.fileReads >= LIMITS.fileReads) {
    return { ...header(ix), path, exists: true, readable: false, reason: `This question has already read ${LIMITS.fileReads} files, the most it can.`, sources: [] };
  }
  ctx.counters.fileReads += 1;
  const lines = row.content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const start = clampInt(input.start, { min: 1, max: Math.max(1, total), fallback: 1 });
  let end = clampInt(input.end, { min: start, max: Math.max(start, total), fallback: Math.min(total, start + LIMITS.readLines - 1) });
  end = Math.min(end, start + LIMITS.readLines - 1, Math.max(total, start));
  // Keep within the byte cap, whole lines only.
  let bytes = 0;
  let last = start - 1;
  for (let i = start - 1; i < end; i += 1) {
    const b = Buffer.byteLength(lines[i] || '') + 1;
    if (bytes + b > LIMITS.readBytes && last >= start) break;
    bytes += b;
    last = i + 1;
  }
  end = Math.max(start, last);
  const { text } = cleanText(lines.slice(start - 1, end).join('\n'), path);
  const numbered = text.split('\n').map((l, i) => `${start + i}\t${l.length > 2000 ? `${l.slice(0, 2000)}…` : l}`).join('\n');
  return {
    ...header(ix),
    source_id: codeSource(ctx, ix, path, start, end, text),
    path,
    lines: `${start}-${end}`,
    total_lines: total,
    truncated: end < total,
    secrets_hidden: redactedCount(text) > 0 || undefined,
    text: numbered,
    reads_left: LIMITS.fileReads - ctx.counters.fileReads,
    sources: [`code:${path}@${sha12(ix.sha)}:L${start}-${end}`],
  };
}

/** find_usages(path): files that import it. */
async function findUsages(ctx, input = {}) {
  const path = normalizePath(input.path);
  const ix = await index(ctx);
  if (!ix.ok) return notReady(ix);
  const from = (await ctx.deps.codeIndex.importersOf(ctx.project.id, path, { limit: LIMITS.usages + 1 }))
    .filter((p) => !refusedPath(p));
  const shown = from.slice(0, LIMITS.usages).map((p) => ({ source_id: codeSource(ctx, ix, p), path: p }));
  return {
    ...header(ix),
    path,
    imported_by: shown,
    more: from.length > LIMITS.usages,
    note: 'Only relative and @/ or ~/ imports in JavaScript, TypeScript and Python are tracked.',
    sources: shown.map((s) => s.source_id),
  };
}

module.exports = { searchCode, findSymbol, listFiles, readFile, findUsages, LIMITS, snippetFor };
