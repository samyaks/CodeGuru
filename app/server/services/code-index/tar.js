'use strict';

/**
 * Streaming reader for a gzipped tarball, such as GitHub's repo tarball.
 *
 *   for await (const entry of readTarGz(stream, opts)) { ... }
 *
 * Each entry is { path, size, data } for a regular file. `path` has its first
 * component removed (GitHub wraps everything in "owner-repo-sha/"). `data` is
 * a Buffer, or null when the file is bigger than opts.maxEntryBytes: those
 * bytes are read past without being kept, so memory stays bounded.
 *
 * Handles ustar names with prefix, pax 'x' headers (path, size), and GNU 'L'
 * long names. Directories, links, devices and global headers are skipped.
 *
 * Limits (each throws an Error with code TAR_TOO_LARGE):
 *   maxCompressedBytes    bytes read from the source
 *   maxUncompressedBytes  bytes after gunzip
 * A bad header checksum throws code TAR_CORRUPT.
 */

const zlib = require('zlib');
const { Transform, Readable } = require('stream');

const BLOCK = 512;
const MAX_META_BYTES = 64 * 1024; // pax / long-name records

function tarError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function cString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString('utf8');
}

function parseSize(buf) {
  const field = buf.subarray(124, 136);
  if (field[0] & 0x80) {
    // base-256 (GNU) for big files
    let n = 0;
    for (let i = 1; i < field.length; i += 1) n = n * 256 + field[i];
    return n;
  }
  const s = cString(buf, 124, 12).trim();
  if (!s) return 0;
  if (!/^[0-7]+$/.test(s)) throw tarError('TAR_CORRUPT', 'tar size field is not octal');
  return parseInt(s, 8);
}

function checksumOk(buf) {
  const stored = cString(buf, 148, 8).trim();
  if (!/^[0-7]+$/.test(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += (i >= 148 && i < 156) ? 32 : buf[i];
  return sum === parseInt(stored, 8);
}

function isZeroBlock(buf) {
  for (let i = 0; i < BLOCK; i += 1) if (buf[i] !== 0) return false;
  return true;
}

function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(buf.subarray(i, sp).toString('ascii'), 10);
    if (!Number.isFinite(len) || len <= 0 || i + len > buf.length) break;
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8'); // drop trailing \n
    const eq = rec.indexOf('=');
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

function stripFirst(p) {
  const clean = String(p || '').replace(/^\.\//, '');
  const slash = clean.indexOf('/');
  if (slash === -1) return '';
  return clean.slice(slash + 1).replace(/\/+$/, '');
}

function byteCounter(limit, code, label) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (limit && seen > limit) cb(tarError(code, `${label} is over ${limit} bytes`));
      else cb(null, chunk);
    },
  });
}

/**
 * @param {import('stream').Readable|ReadableStream} source gzipped tar bytes
 * @param {{ maxEntryBytes?: number, maxCompressedBytes?: number, maxUncompressedBytes?: number }} [opts]
 */
async function* readTarGz(source, opts = {}) {
  const {
    maxEntryBytes = 512 * 1024,
    maxCompressedBytes = 0,
    maxUncompressedBytes = 0,
  } = opts;

  const input = (source && typeof source.getReader === 'function') ? Readable.fromWeb(source) : source;
  const counted = byteCounter(maxCompressedBytes, 'TAR_TOO_LARGE', 'download');
  const gunzip = zlib.createGunzip();
  const unpacked = byteCounter(maxUncompressedBytes, 'TAR_TOO_LARGE', 'unpacked tarball');

  // Wire errors from every stage into the stream we read from.
  const fail = (err) => unpacked.destroy(err);
  input.on('error', fail);
  counted.on('error', fail);
  gunzip.on('error', fail);
  input.pipe(counted).pipe(gunzip).pipe(unpacked);

  let pending = Buffer.alloc(0);
  let state = 'header';
  let remaining = 0;
  let padding = 0;
  let parts = null; // Buffer[] while collecting
  let current = null; // { type, path, size }
  let nextPath = null; // from pax 'x' or GNU 'L'
  let nextSize = null; // from pax 'x'
  let zeroBlocks = 0;
  let done = false;

  try {
    for await (const chunk of unpacked) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;

      for (;;) {
        if (state === 'header') {
          if (pending.length < BLOCK) break;
          const h = pending.subarray(0, BLOCK);
          pending = pending.subarray(BLOCK);
          if (isZeroBlock(h)) {
            zeroBlocks += 1;
            if (zeroBlocks >= 2) { done = true; break; }
            continue;
          }
          zeroBlocks = 0;
          if (!checksumOk(h)) throw tarError('TAR_CORRUPT', 'tar header checksum does not match');

          const type = String.fromCharCode(h[156] || 0x30);
          let name = cString(h, 0, 100);
          const magic = cString(h, 257, 6);
          if (magic.startsWith('ustar')) {
            const prefix = cString(h, 345, 155);
            if (prefix) name = `${prefix}/${name}`;
          }
          let size = parseSize(h);
          if (type === '0' || type === '7' || type === '\0') {
            if (nextPath != null) name = nextPath;
            if (nextSize != null) size = nextSize;
            nextPath = null;
            nextSize = null;
          }
          current = { type, path: name, size };
          remaining = size;
          padding = (BLOCK - (size % BLOCK)) % BLOCK;

          const isMeta = type === 'x' || type === 'L' || type === 'g' || type === 'K';
          if (isMeta && size > MAX_META_BYTES) throw tarError('TAR_CORRUPT', 'tar metadata record is too big');
          const isFile = type === '0' || type === '7' || type === '\0';
          const keep = (type === 'x' || type === 'L') || (isFile && size <= maxEntryBytes);
          parts = keep ? [] : null;
          if (!isFile && !isMeta) { nextPath = null; nextSize = null; }
          state = 'body';
        }

        if (state === 'body') {
          if (remaining > 0) {
            if (!pending.length) break;
            const take = Math.min(remaining, pending.length);
            if (parts) parts.push(pending.subarray(0, take));
            pending = pending.subarray(take);
            remaining -= take;
            if (remaining > 0) break;
          }
          state = 'pad';
        }

        if (state === 'pad') {
          if (padding > 0) {
            const take = Math.min(padding, pending.length);
            pending = pending.subarray(take);
            padding -= take;
            if (padding > 0) break;
          }
          state = 'header';
          const { type, path: rawPath, size } = current;
          const body = parts ? Buffer.concat(parts) : null;
          parts = null;
          current = null;

          if (type === 'x') {
            const pax = parsePax(body);
            if (pax.path) nextPath = pax.path;
            if (pax.size && /^\d+$/.test(pax.size)) nextSize = parseInt(pax.size, 10);
          } else if (type === 'L') {
            nextPath = cString(body, 0, body.length);
          } else if (type === '0' || type === '7' || type === '\0') {
            const p = stripFirst(rawPath);
            if (p) yield { path: p, size, data: body };
          }
        }
      }
      if (done) break;
    }
    if (!done && (state !== 'header' || pending.length)) {
      throw tarError('TAR_CORRUPT', 'tarball ended in the middle of an entry');
    }
  } finally {
    input.unpipe?.();
    if (typeof input.destroy === 'function') input.destroy();
    counted.destroy();
    gunzip.destroy();
    unpacked.destroy();
  }
}

module.exports = { readTarGz, parsePax, stripFirst };
