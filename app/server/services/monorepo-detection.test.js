// Stack, capability and rule detection must read every package.json, not
// just the root one: monorepos and apps kept in a subfolder declare their
// real dependencies below it.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { detectStack } = require('./analyzer');
const { runAllDetectors } = require('./capability-detectors');
const { runStaticSuggestions } = require('./suggestion-rules');

const pkg = (deps, extra = {}) => JSON.stringify({ dependencies: deps, ...extra });

// Shaped like client-desk: a workspace root with no app dependencies.
const MONOREPO = {
  'package.json': JSON.stringify({ private: true, devDependencies: { turbo: '2.0.0' } }),
  'apps/web/package.json': pkg({ next: '15.0.0', react: '19.0.0', '@clerk/nextjs': '6.0.0' }, { devDependencies: { vitest: '2.0.0' } }),
  'packages/db/package.json': pkg({ '@supabase/supabase-js': '2.0.0' }),
  'apps/web/app/page.tsx': 'export default function Page() { return null; }',
  'apps/web/middleware.ts': "import { clerkMiddleware } from '@clerk/nextjs/server';\nexport default clerkMiddleware();",
};
const files = (contents) => Object.keys(contents).map((path) => ({ path }));

test('detectStack finds framework, database and auth in subfolder manifests', () => {
  const stack = detectStack(files(MONOREPO), MONOREPO);
  assert.equal(stack.runtime, 'node');
  assert.equal(stack.framework, 'Next.js');
  assert.equal(stack.database, 'Supabase');
  assert.equal(stack.auth, 'Clerk');
});

test('detectStack still reads a root-only package.json', () => {
  const contents = { 'package.json': pkg({ express: '5.0.0', pg: '8.0.0' }), 'server.js': '' };
  const stack = detectStack(files(contents), contents);
  assert.equal(stack.framework, 'Express');
  assert.equal(stack.database, 'PostgreSQL');
});

test('capability detectors cite the subfolder manifest that declares the dependency', async () => {
  const result = await runAllDetectors({ files: files(MONOREPO), fileContents: MONOREPO });
  const cites = (cap, file) => (result[cap].evidence || []).some((e) => e.file === file);
  assert.equal(result.auth.exists, true, 'Clerk in apps/web/package.json counts as auth');
  assert.ok(cites('auth', 'apps/web/package.json'));
  assert.ok(cites('database', 'packages/db/package.json'));
  assert.ok(cites('testing', 'apps/web/package.json'));
});

test('deployment reads scripts from subfolder manifests', async () => {
  const contents = {
    'package.json': JSON.stringify({ private: true }),
    'app/package.json': pkg({ express: '5.0.0' }, { scripts: { start: 'node server.js --port $PORT' } }),
  };
  const result = await runAllDetectors({ files: files(contents), fileContents: contents });
  assert.ok(result.deployment.evidence.some((e) => e.file === 'app/package.json'));
});

function suggestionsFor(contents, stack) {
  return runStaticSuggestions({
    stack,
    gaps: {},
    features: [],
    structure: { entryPoints: [], routeFiles: [] },
    fileContents: contents,
    fileTree: Object.keys(contents),
    buildPlan: {},
  });
}

test('Express rules fire for an Express app in a subfolder and cite its manifest', () => {
  const contents = {
    'package.json': JSON.stringify({ private: true }),
    'app/package.json': pkg({ express: '5.0.0' }),
  };
  const out = suggestionsFor(contents, { framework: null, runtime: 'node' });
  const helmet = out.find((s) => /helmet/i.test(s.title));
  assert.ok(helmet, 'helmet finding');
  assert.equal(helmet.evidence[0].file, 'app/package.json');
});

test('a hand-written rate limiter counts as rate limiting', () => {
  const contents = {
    'app/package.json': pkg({ express: '5.0.0' }),
    'app/server/app.js': "const { createRateLimit } = require('./lib/rate-limit');\napp.use(createRateLimit());",
  };
  const out = suggestionsFor(contents, { framework: 'Express', runtime: 'node' });
  assert.equal(out.some((s) => /rate limiting/i.test(s.title)), false);
});
