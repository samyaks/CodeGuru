const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { evaluatePack, applyPack, writeChanges, readRepoFiles, listPacks } = require('./index');

const FIXTURE = path.join(__dirname, 'fixtures', 'express-basic');
const load = () => readRepoFiles(FIXTURE);

test('lists the hardening-express pack with a valid manifest', () => {
  const ids = listPacks().map((p) => p.manifest.id);
  assert.ok(ids.includes('hardening-express'));
});

test('fixture is eligible: missing-helmet triggers the pack', async () => {
  const r = await evaluatePack('hardening-express', load());
  assert.equal(r.eligible, true);
  assert.deepEqual(r.triggeredBy, ['missing-helmet']);
});

test('apply renders anchored patches, adds deps, and verifies clean', async () => {
  const files = load();
  const r = await applyPack('hardening-express', files);
  assert.equal(r.ok, true, JSON.stringify(r.verification));
  const byPath = Object.fromEntries(r.changes.map((c) => [c.path, c]));
  assert.deepEqual(Object.keys(byPath).sort(), ['package.json', 'security/hardening.js', 'server.js']);

  const server = byPath['server.js'].content.split('\n');
  const iRequire = server.findIndex((l) => l.includes("require('./security/hardening')"));
  const iApp = server.findIndex((l) => /^const app = express\(\)/.test(l));
  const iApply = server.findIndex((l) => l.trim() === 'applyHardening(app);');
  const iErr = server.findIndex((l) => l.includes('app.use(hardeningErrorHandler)'));
  const iListen = server.findIndex((l) => l.includes('app.listen('));
  assert.ok(iRequire > -1 && iRequire < iApp, 'import after requires, before app');
  assert.equal(iApply, iApp + 1, 'applyHardening directly after app creation');
  assert.ok(iErr > -1 && iErr < iListen, 'error handler before listen');
  assert.match(byPath['server.js'].content, /jibe-pack:hardening-express@0\.1\.0/);

  const pkg = JSON.parse(byPath['package.json'].content);
  assert.ok(pkg.dependencies.helmet && pkg.dependencies['express-rate-limit'] && pkg.dependencies.cors);
  assert.equal(pkg.dependencies.express, '^4.21.2', 'existing deps untouched');
  assert.match(byPath['security/hardening.js'].content, /limit: 100,/);
  assert.ok(r.env.some((e) => e.key === 'CORS_ORIGINS'));
  assert.equal(r.verification.checks[0].ok, true);
});

test('does not mutate the input file map', async () => {
  const files = load();
  const before = JSON.stringify(files);
  await applyPack('hardening-express', files);
  assert.equal(JSON.stringify(files), before);
});

test('custom input is applied; invalid input refuses', async () => {
  const ok = await applyPack('hardening-express', load(), { rateLimitPerMinute: 30 });
  assert.match(ok.changes.find((c) => c.path === 'security/hardening.js').content, /limit: 30,/);
  for (const bad of [{ rateLimitPerMinute: 0 }, { rateLimitPerMinute: '5; process.exit()' }, { nope: 1 }]) {
    const r = await applyPack('hardening-express', load(), bad);
    assert.equal(r.refused, true);
    assert.deepEqual(r.changes, []);
  }
});

test('idempotent: second apply on the result refuses as already applied', async () => {
  const files = load();
  const r = await applyPack('hardening-express', files);
  for (const c of r.changes) files[c.path] = c.content;
  const again = await applyPack('hardening-express', files);
  assert.equal(again.refused, true);
  assert.match(again.reason, /already/i);
  assert.equal((await evaluatePack('hardening-express', files)).eligible, false);
});

test('refuses when the repo does not match', async () => {
  const cases = {
    'no package.json': (f) => { delete f['package.json']; },
    'not express': (f) => { f['package.json'] = JSON.stringify({ dependencies: { fastify: '1' } }); },
    'esm project': (f) => { f['package.json'] = JSON.stringify({ type: 'module', dependencies: { express: '4' } }); },
    'no app.listen': (f) => { f['server.js'] = f['server.js'].replace('app.listen', 'start'); },
    'helmet already present': (f) => { f['package.json'] = JSON.stringify({ dependencies: { express: '4', helmet: '7' } }); },
    'two entry files': (f) => { f['other.js'] = f['server.js']; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const files = load();
    mutate(files);
    const r = await applyPack('hardening-express', files);
    assert.equal(r.refused, true, name);
    assert.deepEqual(r.changes, [], name);
  }
});

test('refuses to overwrite an existing security/hardening.js', async () => {
  const files = load();
  files['security/hardening.js'] = '// mine';
  const r = await applyPack('hardening-express', files);
  assert.equal(r.refused, true);
});

test('entry in a subdirectory gets the helper next to it', async () => {
  const files = load();
  files['src/server.js'] = files['server.js'];
  delete files['server.js'];
  const r = await applyPack('hardening-express', files);
  assert.equal(r.ok, true);
  assert.ok(r.changes.some((c) => c.path === 'src/security/hardening.js'));
});

test('writeChanges writes to disk and rejects path escape', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
  fs.cpSync(FIXTURE, tmp, { recursive: true });
  const r = await applyPack('hardening-express', readRepoFiles(tmp));
  writeChanges(tmp, r.changes);
  assert.ok(fs.existsSync(path.join(tmp, 'security', 'hardening.js')));
  assert.match(fs.readFileSync(path.join(tmp, 'server.js'), 'utf8'), /applyHardening\(app\)/);
  assert.throws(() => writeChanges(tmp, [{ path: '../evil.js', content: 'x' }]), /escapes/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
