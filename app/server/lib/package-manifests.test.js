const { test } = require('node:test');
const assert = require('node:assert/strict');

const { collectPackageDeps, listPackageManifests, isPackageManifest } = require('./package-manifests');

const pkg = (deps, devDeps, extra = {}) => JSON.stringify({ dependencies: deps, devDependencies: devDeps, ...extra });

test('merges dependencies from every package.json and cites the declaring file', () => {
  const { deps, depFiles } = collectPackageDeps({
    'package.json': pkg({}, { turbo: '2.0.0' }),
    'apps/web/package.json': pkg({ next: '15.0.0', '@clerk/nextjs': '6.0.0' }),
    'packages/db/package.json': pkg({ '@supabase/supabase-js': '2.0.0' }),
    'apps/web/app/page.tsx': 'export default function Page() {}',
  });
  assert.equal(deps.next, '15.0.0');
  assert.equal(depFiles['@clerk/nextjs'], 'apps/web/package.json');
  assert.equal(depFiles['@supabase/supabase-js'], 'packages/db/package.json');
  assert.equal(depFiles.turbo, 'package.json');
});

test('the shallowest manifest wins when several declare the same dependency', () => {
  const { deps, depFiles } = collectPackageDeps({
    'app/client/package.json': pkg({ react: '18.0.0' }),
    'app/package.json': pkg({ react: '19.0.0', express: '5.0.0' }),
  });
  assert.equal(deps.react, '19.0.0');
  assert.equal(depFiles.react, 'app/package.json');
});

test('example, fixture and template apps do not count', () => {
  assert.equal(isPackageManifest('packages/qbo/examples/next/package.json'), false);
  assert.equal(isPackageManifest('test/fixtures/app/package.json'), false);
  assert.equal(isPackageManifest('node_modules/express/package.json'), false);
  assert.equal(isPackageManifest('apps/web/package.json'), true);
  const { deps } = collectPackageDeps({
    'package.json': pkg({ next: '15.0.0' }),
    'examples/express-demo/package.json': pkg({ express: '5.0.0' }),
  });
  assert.equal(deps.express, undefined);
});

test('lists manifests root first and skips unparseable ones', () => {
  const manifests = listPackageManifests({
    'apps/web/package.json': pkg({ next: '15.0.0' }),
    'packages/broken/package.json': '{ not json',
    'package.json': pkg({}),
  });
  assert.deepEqual(manifests.map((m) => m.path), ['package.json', 'apps/web/package.json']);
});

test('no manifests gives empty results', () => {
  assert.deepEqual(collectPackageDeps({ 'main.py': 'print(1)' }), { deps: {}, depFiles: {}, manifests: [] });
  assert.deepEqual(collectPackageDeps(undefined), { deps: {}, depFiles: {}, manifests: [] });
});
