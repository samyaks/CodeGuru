'use strict';

/**
 * What the code index keeps, and how. Pure: no I/O.
 *
 * classifyPath(path)          -> { index: false } to leave a path out entirely,
 *                                or { index: true, neverReadable?: true }
 * prepareText(path, buffer)   -> { content, skippedReason, redactions, language }
 *
 * Left out entirely: vendored and build output, lockfiles, VCS folders.
 * Kept as a path with no text: never-readable files (.env, keys,
 * credentials), files over 512 KB, binaries, minified files, and any file
 * holding a private key block. Everything else is stored with secret-shaped
 * strings replaced by [redacted secret].
 */

const { PATTERNS } = require('../security/detectors/exposed-secrets');
const { inferLanguage } = require('../../lib/capture-utils');

const MAX_FILE_BYTES = 512 * 1024;
const REDACTED = '[redacted secret]';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor', '.svelte-kit',
  'target', 'out', '.expo', 'bower_components', '.venv', 'venv', '.terraform', '.gradle',
]);

const LOCKFILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb',
  'cargo.lock', 'poetry.lock', 'pipfile.lock', 'gemfile.lock', 'composer.lock', 'go.sum',
  'mix.lock', 'pubspec.lock', 'podfile.lock', 'packages.lock.json', 'uv.lock',
]);

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'psd', 'avif', 'heic',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war', 'whl',
  'exe', 'dll', 'so', 'dylib', 'a', 'o', 'class', 'pyc', 'pyo', 'wasm', 'bin', 'dat',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav', 'ogg', 'flac',
  'sqlite', 'sqlite3', 'db', 'parquet', 'onnx', 'pt', 'h5', 'pkl', 'npy', 'npz',
]);

// Files whose whole point is a secret. Their text is never stored.
const NEVER_READABLE_NAMES = [
  /^\.env(\..*)?$/i, /^.*\.env$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|p8|ppk|asc|gpg|kdbx|tfstate|tfvars)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials(\.[a-z]+)?$/i, /^.*[-_.]credentials\.(json|ya?ml|xml|ini)$/i,
  /^service[-_]?account.*\.json$/i, /^client_secret.*\.json$/i,
  /^\.(npmrc|pypirc|netrc|pgpass|htpasswd|git-credentials|dockercfg)$/i,
  /^secrets?\.(json|ya?ml|toml|ini|env)$/i,
];

const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

function baseName(p) {
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * A repo-relative path is safe when it has no empty, "." or ".." segment,
 * no backslash or NUL, and doesn't start with "/".
 */
function isSafePath(p) {
  if (typeof p !== 'string' || !p || p.length > 1024) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\u0000')) return false;
  return p.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

function isNeverReadable(p) {
  const name = baseName(p);
  return NEVER_READABLE_NAMES.some((re) => re.test(name));
}

function classifyPath(p) {
  if (!isSafePath(p)) return { index: false, reason: 'unsafe_path' };
  const parts = p.split('/');
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return { index: false, reason: 'skipped_dir' };
  const name = parts[parts.length - 1].toLowerCase();
  if (LOCKFILES.has(name)) return { index: false, reason: 'lockfile' };
  if (isNeverReadable(p)) return { index: true, neverReadable: true };
  return { index: true };
}

function isBinary(p, buf) {
  const name = baseName(p).toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot > 0 && BINARY_EXT.has(name.slice(dot + 1))) return true;
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i += 1) if (buf[i] === 0) return true;
  return false;
}

function isMinified(p, text) {
  if (/\.min\.(js|css|mjs)$/i.test(p)) return true;
  if (text.length < 5000) return false;
  const lines = text.split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return longest > 5000 && lines.length < text.length / 1000;
}

/** Replace every secret-shaped string; returns { text, count }. */
function redactSecrets(text) {
  let count = 0;
  let out = text;
  for (const { re } of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    out = out.replace(g, () => { count += 1; return REDACTED; });
  }
  return { text: out, count };
}

/**
 * Decide what to store for one file.
 * @param {string} p repo-relative path
 * @param {Buffer|string} data file bytes (or text)
 * @param {{ neverReadable?: boolean, size?: number }} [opts]
 */
function prepareText(p, data, { neverReadable = false, size = null } = {}) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data == null ? '' : data), 'utf8');
  const sizeBytes = size == null ? buf.length : size;
  const language = inferLanguage(p);
  const base = { content: null, redactions: 0, language, sizeBytes };
  if (neverReadable || isNeverReadable(p)) return { ...base, skippedReason: 'never_readable' };
  if (sizeBytes > MAX_FILE_BYTES || buf.length > MAX_FILE_BYTES) return { ...base, skippedReason: 'too_large' };
  if (isBinary(p, buf)) return { ...base, skippedReason: 'binary' };
  const text = buf.toString('utf8').replace(/\u0000/g, '');
  if (isMinified(p, text)) return { ...base, skippedReason: 'minified' };
  if (PRIVATE_KEY_RE.test(text)) return { ...base, skippedReason: 'private_key' };
  const { text: clean, count } = redactSecrets(text);
  return { ...base, content: clean, skippedReason: null, redactions: count };
}

module.exports = {
  MAX_FILE_BYTES,
  REDACTED,
  isSafePath,
  isNeverReadable,
  classifyPath,
  prepareText,
  redactSecrets,
};
