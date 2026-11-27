'use strict';

// Build, push updates, heal and access loss, with an in-memory store and a
// fake GitHub. No network and no model: global fetch throws if anything
// reaches for it, and no Anthropic module may be loaded.

const { test } = require('node:test');
const assert = require('node:assert');

const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('no network in tests'); };

const { createCodeIndex, isAccessLoss } = require('./index');
const { fakeGithub, memoryStore } = require('./test-fakes');
const { AppError } = require('../../lib/app-error');

const AWS = 'AKIA' + 'QWERTYUIOPASDFGH';

const C1 = {
  'README.md': '# Shop\n',
  'src/server.js': "const pay = require('./pay');\nfunction start() {}\napp.post('/api/checkout', pay.charge);\n",
  'src/pay.js': `const KEY = '${AWS}';\nexport async function charge() {}\n`,
  'src/util/old-name.js': 'export function helper() {}\n',
  'src/gone.js': 'export const bye = () => 1;\n',
  '.env': `STRIPE_KEY=${AWS}\n`,
  'node_modules/left/index.js': 'nope',
  'package-lock.json': '{}',
};
const C2 = (() => {
  const f = { ...C1 };
  f['src/pay.js'] = "export async function charge() {}\nexport function refund() {}\n"; // edit
  f['src/util/new-name.js'] = f['src/util/old-name.js']; // rename
  delete f['src/util/old-name.js'];
  delete f['src/gone.js']; // delete
  f['src/new.js'] = "import { helper } from './util/new-name';\nexport class Cart {}\n"; // add
  return f;
})();
const F1 = { ...C1, 'src/server.js': 'function rewritten() {}\n' }; // force-pushed history

function setup({ limits = null, branches = { main: 'c1' } } = {}) {
  const commits = {
    c1: { files: C1 },
    c2: { files: C2, parent: 'c1' },
    c3: { files: { ...C2, 'src/three.js': 'export function three() {}\n' }, parent: 'c2' },
    f1: { files: F1 }, // not a descendant of c1
  };
  const gh = fakeGithub({ commits, branches });
  const store = memoryStore();
  const project = { id: 'p1', owner: 'acme', repo: 'shop', user_id: 'u1', branch: 'main', repo_url: 'https://github.com/acme/shop' };
  const logs = [];
  const index = createCodeIndex({
    store, clientFor: () => gh, enabled: () => true, limits,
    deployments: { async findById(id) { return id === project.id ? project : null; } },
    log: (o) => logs.push(o),
  });
  // A fresh, separate build of a commit, to compare against.
  async function freshSnapshot(sha) {
    const s2 = memoryStore();
    const g2 = fakeGithub({ commits, branches: { main: sha } });
    const i2 = createCodeIndex({ store: s2, clientFor: () => g2, enabled: () => true, deployments: { findById: async () => project }, log: () => {} });
    await i2.rebuild(project);
    return s2.snapshot('p1');
  }
  return { gh, store, project, index, logs, commits, freshSnapshot };
}

test('a full build stores the tree minus skipped paths, with secrets kept out', async () => {
  const { index, store, project, gh } = setup();
  const r = await index.rebuild(project);
  assert.strictEqual(r.status, 'ready');
  const snap = store.snapshot('p1');
  assert.deepStrictEqual(Object.keys(snap.files), ['.env', 'README.md', 'src/gone.js', 'src/pay.js', 'src/server.js', 'src/util/old-name.js']);
  assert.strictEqual(snap.files['.env'].content, null);
  assert.strictEqual(snap.files['.env'].skipped, 'never_readable');
  for (const f of store.files.get('p1').values()) {
    assert.ok(!String(f.content).includes(AWS), f.path);
  }
  assert.ok(snap.files['src/pay.js'].content.includes('[redacted secret]'));
  assert.deepStrictEqual(snap.files['src/server.js'].symbols, ['function:start:2', 'route:POST /api/checkout:3']);
  assert.deepStrictEqual(snap.edges, ['src/server.js>src/pay.js']);
  const repo = store.repos.get('p1');
  assert.strictEqual(repo.indexed_sha, 'c1');
  assert.strictEqual(repo.lease_token, null);
  assert.strictEqual(gh.calls.filter((c) => c[0] === 'tarball').length, 1);
});

test('a push with an edit, a rename, a delete and an add equals a fresh build', async () => {
  const { index, store, project, gh, freshSnapshot } = setup();
  await index.rebuild(project);
  gh.calls.length = 0;
  // GitHub moves the branch, then sends the push.
  const branches = { main: 'c2' };
  gh.fetchBranch = async (_o, _r, name) => { gh.calls.push(['branch', name]); return { commit: { sha: branches[name] } }; };
  const r = await index.onPush(project, { ref: 'refs/heads/main', before: 'c1', after: 'c2', forced: false });
  assert.strictEqual(r.status, 'ready');
  assert.strictEqual(r.full, false);
  assert.strictEqual(gh.calls.filter((c) => c[0] === 'tarball').length, 0, 'no tarball for a normal push');
  // Only the changed files were fetched: edit, rename target, add (the rename has the same blob but a new path).
  assert.strictEqual(gh.calls.filter((c) => c[0] === 'blob').length, 3);
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('c2'));
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c2');
});

test('a force push rebuilds from a tarball and equals a fresh build', async () => {
  const { index, store, project, gh, freshSnapshot } = setup({ branches: { main: 'c1' } });
  await index.rebuild(project);
  gh.fetchBranch = async () => ({ commit: { sha: 'f1' } });
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'f1', forced: true });
  assert.strictEqual(r.full, true);
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('f1'));
});

test('a missed push (indexed sha not an ancestor) also falls back to a full build', async () => {
  const { index, store, project, gh, freshSnapshot, logs } = setup();
  await index.rebuild(project);
  gh.fetchBranch = async () => ({ commit: { sha: 'f1' } });
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'f1', forced: false });
  assert.strictEqual(r.full, true);
  assert.ok(logs.some((l) => l.action === 'full_build_needed' && l.reason === 'compare_diverged'));
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('f1'));
});

test('two pushes arriving together apply once each, in order', async () => {
  const { index, store, project, gh, freshSnapshot } = setup();
  await index.rebuild(project);
  let head = 'c2';
  gh.fetchBranch = async () => ({ commit: { sha: head } });
  const first = index.onPush(project, { ref: 'refs/heads/main', after: 'c2' });
  head = 'c3';
  const second = index.onPush(project, { ref: 'refs/heads/main', after: 'c3' });
  const [a, b] = await Promise.all([first, second]);
  // The first run already sees the newest head; the second finds nothing left to do.
  assert.strictEqual(a.status, 'ready');
  assert.ok(b.unchanged || b.status === 'ready');
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c3');
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('c3'));
  // A redelivered old push never moves the index back.
  const again = await index.onPush(project, { ref: 'refs/heads/main', after: 'c2' });
  assert.ok(again.unchanged);
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c3');
});

test('an update that dies half way is healed on the next run', async () => {
  const { index, store, project, gh, freshSnapshot } = setup();
  await index.rebuild(project);
  gh.fetchBranch = async () => ({ commit: { sha: 'c2' } });
  const realBlob = gh.fetchBlobRaw;
  let n = 0;
  gh.fetchBlobRaw = async (...args) => { n += 1; if (n === 2) throw Object.assign(new Error('boom'), { status: 502 }); return realBlob(...args); };
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'c2' });
  assert.strictEqual(r.status, 'failed');
  const row = store.repos.get('p1');
  assert.strictEqual(row.status, 'failed');
  assert.strictEqual(row.indexed_sha, 'c1', 'the indexed sha only moves when the update finished');
  assert.ok(!/boom/.test(row.error), 'no raw error text is stored');
  gh.fetchBlobRaw = realBlob;
  const healed = await index.heal();
  assert.strictEqual(healed.checked, 1);
  assert.strictEqual(store.repos.get('p1').status, 'ready');
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('c2'));
});

test('a lease left by a crashed worker is taken over once it runs out', async () => {
  const { index, store, project } = setup();
  await index.rebuild(project);
  const row = store.repos.get('p1');
  Object.assign(row, { lease_token: 'other', lease_until: Date.now() + 60000, status: 'building' });
  assert.deepStrictEqual(await index.rebuild(project), { skipped: 'busy' });
  row.lease_until = Date.now() - 1;
  assert.strictEqual((await index.rebuild(project)).status, 'ready');
});

test('when GitHub says Takeoff can no longer read the repo, the index is deleted', async () => {
  for (const [where, err] of [
    ['fetchBranch', new AppError('x', 403, 'GITHUB_APP_REQUIRED')],
    ['fetchRepoMeta', Object.assign(new Error('GitHub API 404: Not Found'), { status: 404 })],
    ['fetchBranch', Object.assign(new Error('gone'), { installationGone: true, status: 401 })],
  ]) {
    const { index, store, project, gh } = setup();
    await index.rebuild(project);
    gh[where] = async () => { throw err; };
    const r = await index.rebuild(project);
    assert.strictEqual(r.status, 'deleted');
    assert.strictEqual(store.repos.has('p1'), false);
    assert.strictEqual(store.files.has('p1'), false);
  }
});

test('a missing branch or an expired token fails and keeps the index', async () => {
  for (const err of [
    Object.assign(new Error('Branch not found'), { status: 404 }),
    Object.assign(new Error('Bad credentials'), { status: 401 }),
  ]) {
    const { index, store, project, gh } = setup();
    await index.rebuild(project);
    gh.fetchBranch = async () => { throw err; };
    const r = await index.rebuild(project);
    assert.strictEqual(r.status, 'failed');
    assert.strictEqual(store.repos.get('p1').indexed_sha, 'c1');
    assert.strictEqual(store.files.get('p1').size, 6);
  }
});

test('rate limits and outages keep the index and mark it failed', async () => {
  const { index, store, project, gh } = setup();
  await index.rebuild(project);
  gh.fetchBranch = async () => ({ commit: { sha: 'c2' } });
  gh.fetchCompare = async () => { throw Object.assign(new Error('GitHub API 403: API rate limit exceeded'), { status: 403 }); };
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'c2' });
  assert.strictEqual(r.status, 'failed');
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c1');
  assert.strictEqual(store.files.get('p1').size, 6);
  assert.strictEqual(isAccessLoss(new AppError('slow', 429, 'GITHUB_RATE_LIMITED')), false);
  assert.strictEqual(isAccessLoss(Object.assign(new Error('x'), { status: 500 })), false);
});

test('over the limits, the index keeps no files and pushes leave it alone', async () => {
  const { index, store, project, gh } = setup({ limits: { maxFiles: 3 } });
  const r = await index.rebuild(project);
  assert.strictEqual(r.status, 'too_large');
  assert.strictEqual(store.files.get('p1').size, 0);
  gh.fetchBranch = async () => ({ commit: { sha: 'c2' } });
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', after: 'c2' }), { skipped: 'too_large' });
  assert.deepStrictEqual(await index.heal(), { checked: 0 });
});

test('pushes to other branches, without an index, or with Ask off do nothing', async () => {
  const { index, project, gh } = setup();
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', after: 'c1' }), { skipped: 'no_index' });
  await index.rebuild(project);
  gh.calls.length = 0;
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/feature', after: 'c2' }), { skipped: 'other_branch' });
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/tags/v1', after: 'c2' }), { skipped: 'other_branch' });
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', after: 'c1' }), { skipped: 'already_indexed' });
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', deleted: true }), { skipped: 'branch_deleted' });
  assert.strictEqual(gh.calls.length, 0);

  const off = createCodeIndex({ store: memoryStore(), clientFor: () => gh, enabled: () => false, deployments: { findById: async () => project } });
  assert.deepStrictEqual(await off.rebuild(project), { skipped: 'disabled' });
  assert.strictEqual(await off.ensureBuilt(project), null);
  const ownerless = { ...project, user_id: null };
  assert.deepStrictEqual(await index.rebuild(ownerless), { skipped: 'not_indexable' });
  assert.deepStrictEqual(await index.rebuild({ ...project, repo_url: 'local://x' }), { skipped: 'not_indexable' });
});

test('ensureBuilt starts a build only when there is no usable index', async () => {
  const { index, store, project, gh } = setup();
  assert.strictEqual(await index.ensureBuilt(project), null);
  await Promise.all([...index._queues.values()]);
  assert.strictEqual(store.repos.get('p1').status, 'ready');
  gh.calls.length = 0;
  const row = await index.ensureBuilt(project);
  assert.strictEqual(row.status, 'ready');
  assert.strictEqual(gh.calls.length, 0, 'a ready index is used as is');
});

test('a repo change on the project replaces the whole index', async () => {
  const { index, store, project, gh } = setup();
  await index.rebuild(project);
  const moved = { ...project, repo: 'shop2' };
  gh.fetchBranch = async () => ({ commit: { sha: 'c2' } });
  const r = await index.rebuild(moved);
  assert.strictEqual(r.status, 'ready');
  assert.strictEqual(store.repos.get('p1').repo, 'acme/shop2');
  assert.ok(!store.files.get('p1').has('src/gone.js'));
});

test('the repo default branch is indexed, whatever the project row says', async () => {
  const { gh, store, project, index } = setup({ branches: { main: 'c1', trunk: 'c2' } });
  gh.fetchRepoMeta = async () => ({ default_branch: 'trunk', private: true });
  assert.strictEqual((await index.rebuild(project)).status, 'ready');
  const row = store.repos.get('p1');
  assert.strictEqual(row.branch, 'trunk');
  assert.strictEqual(row.indexed_sha, 'c2');
  // Pushes to trunk count; pushes to the project's 'main' don't.
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', after: 'c1' }), { skipped: 'other_branch' });
  gh.fetchBranch = async () => ({ commit: { sha: 'c3' } });
  const r = await index.onPush(project, { ref: 'refs/heads/trunk', after: 'c3' });
  assert.strictEqual(r.status, 'ready');
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c3');
});

test('a push that lands while another worker holds the lease is applied after it', async () => {
  const { index, store, project, gh, freshSnapshot } = setup();
  await index.rebuild(project);
  // Another process holds the lease; the push is noted, not lost.
  const row = store.repos.get('p1');
  Object.assign(row, { lease_token: 'other', lease_until: Date.now() + 60000 });
  gh.fetchBranch = async () => ({ commit: { sha: 'c2' } });
  assert.deepStrictEqual(await index.onPush(project, { ref: 'refs/heads/main', after: 'c2' }), { skipped: 'busy' });
  assert.strictEqual(row.status, 'behind');
  // That worker finishes at c1, sees the push was noted after it claimed, and leaves the row behind.
  row.claimed_at = row.dirty_at - 1;
  const done = await store.release('p1', 'other', { status: 'ready', indexedSha: 'c1' });
  assert.deepStrictEqual(done, { ok: true, dirty: true });
  assert.strictEqual(row.status, 'behind');
  // The next sync (here, the nightly heal) catches up.
  await index.heal();
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'c2');
  assert.strictEqual(store.repos.get('p1').status, 'ready');
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('c2'));
});

test('full builds stop for the day once the budget is used, unless the owner asks', async () => {
  const { index, store, project, gh } = setup();
  await index.rebuild(project);
  const row = store.repos.get('p1');
  Object.assign(row, { full_builds: 8, full_window_start: Date.now() - 1000 });
  gh.fetchBranch = async () => ({ commit: { sha: 'f1' } });
  gh.calls.length = 0;
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'f1', forced: true });
  assert.deepStrictEqual(r, { skipped: 'build_budget' });
  assert.strictEqual(row.status, 'behind');
  assert.strictEqual(row.indexed_sha, 'c1');
  assert.ok(!gh.calls.some(([k]) => k === 'tarball'));
  assert.strictEqual((await index.rebuild(project)).status, 'ready');
  assert.strictEqual(store.repos.get('p1').indexed_sha, 'f1');
});

test('a failed build is not retried on every question', async () => {
  const { index, store, project, gh } = setup();
  gh.fail = (name) => (name === 'tarball' ? Object.assign(new Error('boom'), { status: 502 }) : null);
  await index.rebuild(project);
  assert.strictEqual(store.repos.get('p1').status, 'failed');
  gh.calls.length = 0;
  await index.ensureBuilt(project);
  await Promise.all([...index._queues.values()]);
  assert.strictEqual(gh.calls.length, 0);
  store.repos.get('p1').updated_at = new Date(Date.now() - 16 * 60 * 1000);
  gh.fail = null;
  await index.ensureBuilt(project);
  await Promise.all([...index._queues.values()]);
  assert.strictEqual(store.repos.get('p1').status, 'ready');
});

test('no network and no model were used', () => {
  assert.deepStrictEqual(fetchCalls, []);
  const loaded = Object.keys(require.cache).filter((k) => /anthropic/i.test(k));
  assert.deepStrictEqual(loaded, []);
});

test('a compare that 404s after a history rewrite rebuilds instead of deleting', async () => {
  const { index, store, project, gh, freshSnapshot } = setup();
  await index.rebuild(project);
  gh.fetchBranch = async () => ({ commit: { sha: 'f1' } });
  gh.fetchCompare = async () => { throw Object.assign(new Error('GitHub API 404: No common ancestor'), { status: 404 }); };
  const r = await index.onPush(project, { ref: 'refs/heads/main', after: 'f1' });
  assert.strictEqual(r.full, true);
  assert.strictEqual(store.repos.get('p1').status, 'ready');
  assert.deepStrictEqual(store.snapshot('p1'), await freshSnapshot('f1'));
});
