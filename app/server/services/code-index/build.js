'use strict';

/**
 * Full build: one tarball of the branch at `sha`, streamed and stored in
 * batches. No model is called.
 *
 * Files are upserted, then every row the build didn't write is swept, so a
 * rebuild never leaves the index empty while it runs.
 */

const crypto = require('crypto');
const { readTarGz } = require('./tar');
const { classifyPath, prepareText, MAX_FILE_BYTES } = require('./filter');
const { extractSymbols, extractSpecs, resolveEdges } = require('./extract');

const LIMITS = {
  maxFiles: 50000,
  maxTextBytes: 200 * 1024 * 1024,
  maxCompressedBytes: 500 * 1024 * 1024,
  maxUncompressedBytes: 4 * 1024 * 1024 * 1024,
  batchFiles: 200,
  batchBytes: 4 * 1024 * 1024,
};

/** git's own blob id for these bytes, so later pushes can skip unchanged files. */
function gitBlobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

/** One file, ready to store. `data` is the bytes, or null when too big to keep. */
function fileRecord(path, { data, size, blobSha = null, neverReadable = false }) {
  const prep = prepareText(path, data || Buffer.alloc(0), {
    neverReadable,
    size: data ? Math.max(size || 0, data.length) : Math.max(size || 0, MAX_FILE_BYTES + 1),
  });
  const content = prep.content;
  return {
    path,
    blobSha: blobSha || (data ? gitBlobSha(data) : null),
    sizeBytes: prep.sizeBytes,
    language: prep.language,
    content,
    skippedReason: prep.skippedReason,
    redactions: prep.redactions,
    symbols: content ? extractSymbols(path, content) : [],
    specs: content ? extractSpecs(path, content) : null,
  };
}

/** Recompute every import edge from the stored specs. */
async function rebuildEdges({ store, projectId, token }) {
  const [paths, specs] = await Promise.all([store.listPaths(projectId), store.listSpecs(projectId)]);
  const edges = resolveEdges(specs, paths);
  await store.replaceEdges(projectId, token, edges);
  return edges.length;
}

function tooLarge(sha, why) {
  return { status: 'too_large', indexedSha: sha, error: why };
}

/**
 * @param {object} ctx
 *   { projectId, owner, repo, sha, client, store, token, limits? }
 * @returns {Promise<{ status: 'ready'|'too_large', indexedSha, error?, files }>}
 */
async function fullBuild(ctx) {
  const { projectId, owner, repo, sha, client, store, token } = ctx;
  const limits = { ...LIMITS, ...(ctx.limits || {}) };

  const startedAt = await store.now();
  const res = await client.fetchTarball(owner, repo, sha);
  const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0);
  if (declared && declared > limits.maxCompressedBytes) {
    if (res.body && typeof res.body.cancel === 'function') await res.body.cancel().catch(() => {});
    await store.clearFiles(projectId, token);
    return tooLarge(sha, 'The repository download is over the size limit.');
  }

  let batch = [];
  let batchBytes = 0;
  let files = 0;
  let textBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const out = batch;
    batch = [];
    batchBytes = 0;
    await store.upsertFiles(projectId, token, out);
  };

  try {
    for await (const entry of readTarGz(res.body, {
      maxEntryBytes: MAX_FILE_BYTES,
      maxCompressedBytes: limits.maxCompressedBytes,
      maxUncompressedBytes: limits.maxUncompressedBytes,
    })) {
      const cls = classifyPath(entry.path);
      if (!cls.index) continue;
      files += 1;
      if (files > limits.maxFiles) {
        await store.clearFiles(projectId, token);
        return tooLarge(sha, `The repository has more than ${limits.maxFiles} files.`);
      }
      const rec = fileRecord(entry.path, { data: entry.data, size: entry.size, neverReadable: !!cls.neverReadable });
      const bytes = rec.content ? Buffer.byteLength(rec.content) : 0;
      textBytes += bytes;
      if (textBytes > limits.maxTextBytes) {
        await store.clearFiles(projectId, token);
        return tooLarge(sha, 'The repository has more text than the size limit.');
      }
      batch.push(rec);
      batchBytes += bytes;
      if (batch.length >= limits.batchFiles || batchBytes >= limits.batchBytes) await flush();
    }
  } catch (err) {
    if (err && err.code === 'TAR_TOO_LARGE') {
      await store.clearFiles(projectId, token);
      return tooLarge(sha, 'The repository download is over the size limit.');
    }
    throw err;
  }
  await flush();
  await store.sweepOlderThan(projectId, token, startedAt);
  await rebuildEdges({ store, projectId, token });
  return { status: 'ready', indexedSha: sha, files };
}

module.exports = { fullBuild, fileRecord, gitBlobSha, rebuildEdges, LIMITS };
