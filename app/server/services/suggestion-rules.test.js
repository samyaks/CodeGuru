const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runStaticSuggestions } = require('./suggestion-rules');

const quietGaps = {
  auth: { exists: true },
  database: { exists: true, hasSchema: true },
  deployment: { exists: true, hasCI: true },
  permissions: { exists: true },
  testing: { exists: true },
  errorHandling: { exists: true },
  envConfig: { exists: true },
};

function run(fileContents, extras = {}) {
  return runStaticSuggestions({
    stack: extras.stack || {},
    gaps: extras.gaps || quietGaps,
    features: [],
    structure: extras.structure || { entryPoints: [], routeFiles: [] },
    fileContents,
    fileTree: Object.keys(fileContents),
    buildPlan: {},
  });
}

function localhostHit(fileContents) {
  return run(fileContents).find((s) => s.title.includes('localhost'));
}

test('localhost detector skips env-var fallbacks and NODE_ENV gates', () => {
  const hit = localhostHit({
    'app/server/app.js': [
      "const ALLOWED = [process.env.FRONTEND_URL || 'http://localhost:3000'];",
      "const FRONTEND_URL = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');",
      "const baseUrl = process.env.API_URL || `http://localhost:${PORT}`;",
      "if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';",
    ].join('\n'),
  });
  assert.equal(hit, undefined);
});

test('localhost detector skips docs, CI, and config files', () => {
  const hit = localhostHit({
    'README.md': 'open http://localhost:3000',
    '.github/workflows/ci.yml': 'curl -sf http://localhost:3001/health',
    'app/client/vite.config.ts': "const apiTarget = process.env.API_URL || 'http://localhost:3001';",
    'docs/deploy.md': 'sleep 2 && curl http://localhost:3001/health',
  });
  assert.equal(hit, undefined);
});

test('localhost detector flags a real hardcoded URL and cites the file', () => {
  const hit = localhostHit({
    'src/api.js': "const API = 'http://localhost:4000/api';\nexport function load() { return fetch(API); }",
  });
  assert.ok(hit);
  assert.equal(hit.cursor_prompt, null);
  assert.match(hit.description, /src\/api\.js:1/);
  assert.equal(hit.evidence[0].file, 'src/api.js');
  assert.equal(hit.evidence[0].line, 1);
});

test('static suggestions never ship a canned cursor prompt', () => {
  const results = run({
    'src/hardcoded.js': "const API = 'http://localhost:4000';",
  });
  assert.ok(results.length > 0);
  for (const s of results) {
    assert.equal(s.cursor_prompt, null, s.title);
  }
});

function expressFindings(suggestions) {
  return suggestions
    .map((s) => s.title)
    .filter((title) => /helmet|rate limiting/i.test(title));
}

test('Express rules skip Node apps that are not Express (e.g. Next.js)', () => {
  const pkg = JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } });
  const out = run({ 'package.json': pkg }, { stack: { framework: 'Next.js', runtime: 'node' } });
  assert.deepEqual(expressFindings(out), []);
});

test('Express rules still flag an Express app without helmet or rate limiting', () => {
  const pkg = JSON.stringify({ dependencies: { express: '5.0.0' } });
  const out = run({ 'package.json': pkg }, { stack: { framework: 'Express', runtime: 'node' } });
  assert.equal(expressFindings(out).length, 2);
});

test('Express rules apply when express is a dependency of another framework', () => {
  const pkg = JSON.stringify({ dependencies: { next: '15.0.0', express: '5.0.0' } });
  const out = run({ 'package.json': pkg }, { stack: { framework: 'Next.js', runtime: 'node' } });
  assert.equal(expressFindings(out).length, 2);
});
