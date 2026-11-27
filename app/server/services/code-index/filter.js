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
 * holding a private key block, and Kubernetes Secret manifests. Everything
 * else is stored with secret-shaped strings replaced by [redacted secret].
 *
 * Every pattern here is linear: bounded or literal-prefixed, with no
 * quantifiers that can overlap, because they run over repo files that
 * anyone can write.
 */

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
  /^\.env([.\-_].*)?$/i, /^.*\.env$/i, /^env\.[a-z0-9_-]+$/i, /^\.envrc$/i,
  /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|p8|ppk|asc|gpg|kdbx|tfvars|keytab|kubeconfig|ovpn)$/i,
  /\.tfstate(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials(\..*)?$/i, /^.*[-_.]credentials\.(json|ya?ml|xml|ini)$/i,
  /^service[-_]?account.*\.json$/i, /^client_secret.*\.json$/i,
  /^[._]?(npmrc|pypirc|netrc|pgpass|htpasswd|git-credentials|dockercfg|s3cfg|boto|yarnrc\.yml)$/i,
  /^secrets?\.(json|ya?ml|toml|ini|env)$/i,
  /^kubeconfig$/i,
];
// Whole paths that hold credentials whatever their name looks like.
const NEVER_READABLE_PATHS = [/(^|\/)\.docker\/config\.json$/i, /(^|\/)\.kube\/config$/i, /(^|\/)\.aws\/(credentials|config)$/i];

const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/;
const K8S_SECRET_RE = /^[ \t]*["']?kind["']?[ \t]*:[ \t]*["']?Secret["']?[ \t]*,?[ \t]*$/m;
const CONFIG_EXT = /\.(ya?ml|properties|ini|toml|conf|cfg|env|json|xml|tf|hcl)$/i;
// A line this long is data, not code; nothing on it is worth the scan.
const MAX_LINE_CHARS = 50000;

const SECRET_KEY_WORDS = '(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|auth)';

// [regex, configOnly]. Each is linear on its own.
const REDACT_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g],
  [/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{30,}/g],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [/(?:aws_?secret_?access_?key|secret_?access_?key)["']?[ \t]*[:=][ \t]*["']?[A-Za-z0-9\/+=]{40}/gi],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  [/\bglpat-[A-Za-z0-9_-]{15,}/g],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  [/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9_\/-]{20,}/g],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/g],
  [/\bwhsec_[A-Za-z0-9]{20,}/g],
  [/\bAIza[0-9A-Za-z_-]{35}/g],
  [/\bnpm_[A-Za-z0-9]{36}\b/g],
  [/\bSG\.[A-Za-z0-9_-]{16,32}\.[A-Za-z0-9_-]{30,50}/g],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  // scheme://user:password@host for any scheme
  [/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s'"`@\/:]{1,256}:[^\s'"`@]{1,256}@/gi],
  // A secret-looking name given a quoted literal: password = "....", 'token': '...', define('DB_PASSWORD', '...')
  [new RegExp(`${SECRET_KEY_WORDS}[A-Za-z0-9_]{0,40}["']?[ \\t]*(?:[:=]|=>|,)[ \\t]*["'][^'"\\s]{6,256}["']`, 'gi')],
  // In config files, unquoted too: password: hunter22, POSTGRES_PASSWORD=...
  [new RegExp(`${SECRET_KEY_WORDS}[A-Za-z0-9_.-]{0,40}["']?[ \\t]*[:=][ \\t]*[^\\s'"#,;{}]{8,256}`, 'gi'), true],
];

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
  return NEVER_READABLE_NAMES.some((re) => re.test(name)) || NEVER_READABLE_PATHS.some((re) => re.test(p));
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

/**
 * Replace every secret-shaped string; returns { text, count }.
 * `path` decides whether the config-file patterns apply.
 */
function redactSecrets(text, path = '') {
  const config = CONFIG_EXT.test(path) || isNeverReadable(path);
  let count = 0;
  let out = text;
  for (const [re, configOnly] of REDACT_PATTERNS) {
    if (configOnly && !config) continue;
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      if (m === REDACTED || m.endsWith(REDACTED)) return m;
      count += 1;
      return REDACTED;
    });
  }
  return { text: out, count };
}

function longestLine(text) {
  let longest = 0;
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    if (end - start > longest) longest = end - start;
    if (nl === -1) return longest;
    start = nl + 1;
  }
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
  if (isMinified(p, text) || longestLine(text) > MAX_LINE_CHARS) return { ...base, skippedReason: 'minified' };
  const secret = secretFileReason(p, text);
  if (secret) return { ...base, skippedReason: secret };
  const { text: clean, count } = redactSecrets(text, p);
  return { ...base, content: clean, skippedReason: null, redactions: count };
}

/**
 * Whether a file's whole text marks it as a secret: a private key block, or
 * a Kubernetes Secret manifest. Returns the skip reason, or null. Ask runs
 * this again at read time, so an index built before a rule existed is safe.
 */
function secretFileReason(p, text) {
  if (typeof text !== 'string') return null;
  if (PRIVATE_KEY_RE.test(text)) return 'private_key';
  if (/\.(ya?ml|json)$/i.test(p) && K8S_SECRET_RE.test(text)) return 'never_readable';
  return null;
}

module.exports = {
  MAX_FILE_BYTES,
  REDACTED,
  isSafePath,
  isNeverReadable,
  classifyPath,
  prepareText,
  redactSecrets,
  secretFileReason,
};
