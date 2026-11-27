'use strict';

/**
 * Apply the commits between the indexed sha and `toSha` by fetching only the
 * files that changed. No model is called.
 *
 * Returns { needFull: true, reason } when a fresh tarball build is the right
 * answer instead: the indexed sha isn't an ancestor of the new head (force
 * push or a missed push), or the compare lists 300 files or more (GitHub
 * stops listing there).
 */

const { classifyPath, MAX_FILE_BYTES } = require('./filter');
const { fileRecord, rebuildEdges } = require('./build');

const COMPARE_FILE_LIMIT = 300;
const FETCH_CONCURRENCY = 4;

/** Read a fetch Response body, stopping once it passes `limit` bytes (returns null). */
async function readLimited(res, limit) {
  const body = res && res.body;
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > limit ? null : buf;
  }
  const chunks = [];
  let total = 0;
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(Buffer.from(value));
    }
  } else {
    for await (const value of body) {
      total += value.length;
      if (total > limit) { if (typeof body.destroy === 'function') body.destroy(); return null; }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param {object} ctx
 *   { projectId, owner, repo, fromSha, toSha, client, store, token }
 * @returns {Promise<{ status: 'ready', indexedSha, changed, removed } | { needFull: true, reason } | { status: 'ready', indexedSha, unchanged: true }>}
 */
async function applyPush(ctx) {
  const { projectId, owner, repo, fromSha, toSha, client, store, token } = ctx;
  if (!fromSha) return { needFull: true, reason: 'no_index' };
  if (fromSha === toSha) return { status: 'ready', indexedSha: toSha, unchanged: true };

  // The branch head was just read, so a 404 here means the old commit is
  // gone (history rewritten), not that the repo is out of reach.
  let cmp;
  try {
    cmp = await client.fetchCompare(owner, repo, fromSha, toSha);
  } catch (err) {
    if (err && err.status === 404) return { needFull: true, reason: 'compare_not_found' };
    throw err;
  }
  if (!cmp || (cmp.status !== 'ahead' && cmp.status !== 'identical')) {
    return { needFull: true, reason: `compare_${cmp && cmp.status ? cmp.status : 'unknown'}` };
  }
  if (!Array.isArray(cmp.files)) return { needFull: true, reason: 'compare_no_files' };
  const files = cmp.files;
  if (files.length >= COMPARE_FILE_LIMIT) return { needFull: true, reason: 'compare_too_big' };

  const remove = new Set();
  const fetchList = []; // { path, sha, neverReadable }
  let pathSetChanged = false;
  for (const f of files) {
    const name = f && f.filename;
    if (typeof name !== 'string') continue;
    if (f.status === 'removed') { remove.add(name); pathSetChanged = true; continue; }
    if (f.status === 'renamed' && typeof f.previous_filename === 'string') {
      remove.add(f.previous_filename);
      pathSetChanged = true;
    }
    if (f.status === 'unchanged') continue;
    if (f.status === 'added' || f.status === 'renamed' || f.status === 'copied') pathSetChanged = true;
    const cls = classifyPath(name);
    if (!cls.index) { remove.add(name); continue; }
    remove.delete(name);
    fetchList.push({ path: name, sha: typeof f.sha === 'string' ? f.sha : null, neverReadable: !!cls.neverReadable });
  }

  const known = await store.blobShas(projectId, fetchList.map((f) => f.path));
  const todo = fetchList.filter((f) => !(f.sha && known.get(f.path) === f.sha));

  const fetchOne = async (f) => {
    // Never-readable files keep their path and nothing else: no need to fetch them.
    if (f.neverReadable) return fileRecord(f.path, { data: Buffer.alloc(0), size: 0, blobSha: f.sha, neverReadable: true });
    if (!f.sha) return null;
    let res;
    try {
      res = await client.fetchBlobRaw(owner, repo, f.sha);
    } catch (err) {
      // A submodule's entry points at a commit, not a blob, and a tarball has
      // no file for it either: leave the path out, as a full build would.
      if (err && (err.status === 404 || err.status === 422)) return null;
      throw err;
    }
    const data = await readLimited(res, MAX_FILE_BYTES);
    return fileRecord(f.path, { data, size: data ? data.length : MAX_FILE_BYTES + 1, blobSha: f.sha });
  };
  // Fetched and stored a slice at a time, so at most ~20 MB of blobs is held.
  let changed = 0;
  let anySpecs = false;
  for (let start = 0; start < todo.length; start += 40) {
    const slice = todo.slice(start, start + 40);
    const fetched = await mapLimit(slice, FETCH_CONCURRENCY, fetchOne);
    const records = [];
    fetched.forEach((rec, i) => {
      if (rec) records.push(rec);
      else { remove.add(slice[i].path); pathSetChanged = true; }
    });
    if (records.length) await store.upsertFiles(projectId, token, records);
    changed += records.length;
    if (records.some((r) => r.specs)) anySpecs = true;
  }
  if (remove.size) await store.deletePaths(projectId, token, [...remove]);
  // A changed file may have gained or lost imports, so edges are recomputed
  // whenever anything changed (from stored specs: no file is read again).
  if (pathSetChanged || anySpecs || changed > 0) await rebuildEdges({ store, projectId, token });
  return { status: 'ready', indexedSha: toSha, changed, removed: remove.size };
}

module.exports = { applyPush, readLimited, COMPARE_FILE_LIMIT };
