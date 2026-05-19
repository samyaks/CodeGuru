/**
 * testing — does this codebase ship with any tests?
 *
 * Signals:
 *   - Test-named paths (`__tests__/`, `*.test.*`, `*.spec.*`, `tests/`,
 *     `spec/`).
 *   - Declared test-framework deps (jest, vitest, mocha, playwright,
 *     cypress, @testing-library/*).
 *   - Python: `pytest` / `unittest` imports in any file.
 *   - Go: any `*_test.go` file.
 *
 * Legacy gap shape: { exists, coverage } — `coverage` is `'unknown'` if
 * any tests were found (we don't actually measure %), `'none'` otherwise.
 */

const NAME = 'testing';

const JS_TEST_DEPS = [
  'jest', 'vitest', 'mocha', 'ava',
  'playwright', '@playwright/test',
  'cypress',
];

const JS_TEST_DEP_PREFIXES = ['@testing-library/'];

const PY_TEST_IMPORTS = [
  /^\s*import\s+pytest\b/,
  /^\s*import\s+unittest\b/,
  /^\s*from\s+pytest\b/,
  /^\s*from\s+unittest\b/,
];

const TEST_PATH_PATTERNS = [
  /(?:^|\/)__tests__\//,
  /(?:^|\/)(?:tests?|specs?)\//i,
  /\.test\.[\w.]+$/i,
  /\.spec\.[\w.]+$/i,
];

const GO_TEST_FILE_RE = /_test\.go$/;

const PATH_PER_FILE = 0.8;
const PATH_CAP = 0.95;
const DEP_SIGNAL = 0.7;
const PY_SIGNAL = 0.7;
const GO_SIGNAL = 0.95;

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function combine(signals) {
  let inv = 1;
  for (const s of signals) inv *= (1 - s);
  return 1 - inv;
}

function capAt(values, perItem, cap) {
  if (values <= 0) return 0;
  const raw = 1 - Math.pow(1 - perItem, values);
  return Math.min(raw, cap);
}

function findTestPaths(files) {
  const hits = [];
  for (const f of files) {
    for (const re of TEST_PATH_PATTERNS) {
      if (re.test(f.path)) {
        hits.push(f.path);
        break;
      }
    }
  }
  return hits;
}

function findJsTestDeps(fileContents) {
  const pkg = safeJson(fileContents['package.json']);
  if (!pkg) return [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hits = [];
  for (const name of JS_TEST_DEPS) {
    if (deps[name]) hits.push(name);
  }
  for (const dep of Object.keys(deps)) {
    if (JS_TEST_DEP_PREFIXES.some((p) => dep.startsWith(p))) hits.push(dep);
  }
  return hits;
}

function findPythonTestImports(fileContents) {
  const hits = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!path.endsWith('.py')) continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const re of PY_TEST_IMPORTS) {
        if (re.test(lines[i])) {
          hits.push({ file: path, line: i + 1, reason: 'python test import' });
          break;
        }
      }
      if (hits.length > 20) return hits;
    }
  }
  return hits;
}

function findGoTestFiles(files) {
  return files.filter((f) => GO_TEST_FILE_RE.test(f.path)).map((f) => f.path);
}

async function run({ files = [], fileContents = {} } = {}) {
  const evidence = [];
  const signals = [];

  const testPaths = findTestPaths(files);
  if (testPaths.length > 0) {
    signals.push(capAt(testPaths.length, PATH_PER_FILE, PATH_CAP));
    for (const p of testPaths.slice(0, 10)) {
      evidence.push({ file: p, reason: 'test-named path' });
    }
  }

  const depHits = findJsTestDeps(fileContents);
  if (depHits.length > 0) {
    signals.push(DEP_SIGNAL);
    for (const pkg of depHits.slice(0, 5)) {
      evidence.push({ file: 'package.json', reason: `declares ${pkg}` });
    }
  }

  const pyHits = findPythonTestImports(fileContents);
  if (pyHits.length > 0) {
    signals.push(PY_SIGNAL);
    for (const h of pyHits.slice(0, 5)) evidence.push(h);
  }

  const goTests = findGoTestFiles(files);
  if (goTests.length > 0) {
    signals.push(GO_SIGNAL);
    for (const p of goTests.slice(0, 5)) {
      evidence.push({ file: p, reason: '_test.go file' });
    }
  }

  const confidence = combine(signals);

  let status;
  if (confidence >= 0.7) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  const exists = status !== 'missing';
  const coverage = exists ? 'unknown' : 'none';

  return {
    exists,
    confidence,
    status,
    evidence,
    extra: { coverage },
  };
}

module.exports = { name: NAME, run };
