const { test } = require('node:test');
const assert = require('node:assert');

const { resolveRepoAccess, clientForProject, appInstallationForRepo } = require('./github-access');

function makeDeps({ configured = true, grant = null, meta = null, metaError = null, repoInstallation = null } = {}) {
  const calls = { findForUserRepo: 0, clientForInstallation: [], findRepoInstallation: [] };
  const publicClient = {
    name: 'public',
    async fetchRepoMeta() {
      if (metaError) throw metaError;
      return meta;
    },
  };
  return {
    calls,
    publicClient,
    deps: {
      accessStore: {
        async findForUserRepo() {
          calls.findForUserRepo += 1;
          return grant;
        },
      },
      app: {
        isConfigured: () => configured,
        clientForInstallation: (id, scope) => {
          calls.clientForInstallation.push({ id, scope });
          return { name: `installation-${id}`, fetchRepoMeta: async () => ({ via: `installation-${id}` }) };
        },
        findRepoInstallation: async (owner, repo) => {
          calls.findRepoInstallation.push(`${owner}/${repo}`);
          return repoInstallation;
        },
      },
      publicClient,
    },
  };
}

const notFound = Object.assign(new Error('GitHub API 404'), { status: 404 });

test('a granted repo reads through its installation, scoped to that repo', async () => {
  const { deps, calls } = makeDeps({ grant: { installation_id: '42', private: true } });
  const access = await resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'secret' }, deps);
  assert.deepStrictEqual(await access.client.fetchRepoMeta('acme', 'secret'), { via: 'installation-42' });
  assert.strictEqual(access.installationId, 42);
  assert.strictEqual(access.private, true);
  assert.deepStrictEqual(calls.clientForInstallation, [{ id: '42', scope: { repo: 'secret' } }]);
});

test('an ungranted public repo reads with the server token', async () => {
  const { deps, publicClient } = makeDeps({ meta: { private: false } });
  const access = await resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'oss' }, deps);
  assert.strictEqual(access.client, publicClient);
  assert.strictEqual(access.installationId, null);
});

test('the server token never stands in for a private repo', async () => {
  const { deps } = makeDeps({ meta: { private: true } });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'samyaks', repo: 'private-thing' }, deps),
    (err) => err.statusCode === 403 && err.code === 'GITHUB_APP_REQUIRED',
  );
});

test('signed-out users are asked to sign in for private or missing repos', async () => {
  const { deps, calls } = makeDeps({ metaError: notFound });
  await assert.rejects(
    () => resolveRepoAccess({ userId: null, owner: 'acme', repo: 'secret' }, deps),
    (err) => err.statusCode === 401 && err.code === 'GITHUB_SIGNIN_REQUIRED',
  );
  assert.strictEqual(calls.findForUserRepo, 0);
});

test('without the app configured, private repos are refused outright', async () => {
  const { deps, calls } = makeDeps({ configured: false, meta: { private: true } });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'secret' }, deps),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.strictEqual(calls.findForUserRepo, 0);
});

test('a GitHub rate limit becomes a 429, an outage a 502', async () => {
  const rateLimited = Object.assign(new Error('GitHub API rate limit exceeded'), { status: 403 });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'oss' }, makeDeps({ metaError: rateLimited }).deps),
    (err) => err.statusCode === 429 && err.code === 'GITHUB_RATE_LIMITED',
  );
  const outage = Object.assign(new Error('GitHub API 502'), { status: 502 });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'oss' }, makeDeps({ metaError: outage }).deps),
    (err) => err.statusCode === 502 && err.code === 'GITHUB_UNAVAILABLE',
  );
});

test('clientForProject reads through the owner’s current grant, scoped to the repo', async () => {
  const { deps, calls } = makeDeps({ grant: { installation_id: '7' } });
  const set = [];
  deps.setInstallation = async (id, inst) => { set.push([id, inst]); };
  const client = clientForProject({ id: 'p1', user_id: 'u1', owner: 'acme', repo: 'secret', github_installation_id: null }, deps);
  assert.deepStrictEqual(await client.fetchRepoMeta('acme', 'secret'), { via: 'installation-7' });
  assert.deepStrictEqual(calls.clientForInstallation, [{ id: 7, scope: { repo: 'secret' } }]);
  assert.deepStrictEqual(set, [['p1', 7]], 'an older project learns its installation');
});

test('clientForProject stops reading a private repo once the owner has no grant', async () => {
  const { deps } = makeDeps({ grant: null, meta: { private: true } });
  const cleared = [];
  deps.clearInstallation = async (id) => { cleared.push(id); };
  const client = clientForProject({ id: 'p1', user_id: 'u1', owner: 'acme', repo: 'secret', github_installation_id: 7 }, deps);
  await assert.rejects(() => client.fetchRepoMeta('acme', 'secret'), (err) => err.code === 'GITHUB_APP_REQUIRED');
  assert.deepStrictEqual(cleared, ['p1']);
});

test('clientForProject reads a public repo with the server token, and never a private one', async () => {
  const pub = makeDeps({ meta: { private: false, name: 'oss' } });
  const c1 = clientForProject({ id: 'p1', user_id: null, owner: 'acme', repo: 'oss' }, pub.deps);
  assert.deepStrictEqual(await c1.fetchRepoMeta('acme', 'oss'), { private: false, name: 'oss' });
  const priv = makeDeps({ meta: { private: true } });
  const c2 = clientForProject({ id: 'p2', user_id: null, owner: 'samyaks', repo: 'mine' }, priv.deps);
  await assert.rejects(() => c2.fetchRepoMeta('samyaks', 'mine'), (err) => err.statusCode === 401 || err.statusCode === 403);
  assert.strictEqual(clientForProject(null, pub.deps), pub.publicClient);
});

test('appInstallationForRepo trusts the scan’s grant without asking GitHub', async () => {
  const { deps, calls } = makeDeps({ repoInstallation: 99 });
  assert.strictEqual(await appInstallationForRepo({ owner: 'acme', repo: 'web', knownInstallationId: '42' }, deps), 42);
  assert.deepStrictEqual(calls.findRepoInstallation, []);
});

test('appInstallationForRepo asks GitHub when the user has no grant (e.g. an org owner installed it)', async () => {
  const { deps, calls } = makeDeps({ repoInstallation: 99 });
  assert.strictEqual(await appInstallationForRepo({ owner: 'acme', repo: 'web' }, deps), 99);
  assert.deepStrictEqual(calls.findRepoInstallation, ['acme/web']);
});

test('appInstallationForRepo is null without the app configured', async () => {
  const { deps, calls } = makeDeps({ configured: false, repoInstallation: 99 });
  assert.strictEqual(await appInstallationForRepo({ owner: 'acme', repo: 'web' }, deps), null);
  assert.deepStrictEqual(calls.findRepoInstallation, []);
});

function goneDeps({ meta }) {
  const cleared = [];
  const gone = Object.assign(new Error('GitHub API 404'), { status: 404, installationGone: true });
  const publicClient = {
    async fetchRepoMeta() { return meta; },
    async fetchCommits() { return ['public']; },
  };
  const deps = {
    accessStore: { findForUserRepo: async () => ({ installation_id: 7 }) },
    app: { isConfigured: () => true, clientForInstallation: () => ({ fetchCommits: async () => { throw gone; } }) },
    publicClient,
    clearInstallation: async (id) => { cleared.push(id); },
  };
  return { deps, cleared, gone };
}

test('a gone installation falls back to the server token for a public repo and is cleared', async () => {
  const { deps, cleared } = goneDeps({ meta: { private: false } });
  const client = clientForProject({ id: 'p1', user_id: 'u1', owner: 'acme', repo: 'web', github_installation_id: 7 }, deps);
  assert.deepStrictEqual(await client.fetchCommits('acme', 'web'), ['public']);
  assert.deepStrictEqual(cleared, ['p1']);
});

test('a gone installation never lets the server token read a private repo', async () => {
  const { deps, cleared, gone } = goneDeps({ meta: { private: true } });
  const client = clientForProject({ id: 'p1', user_id: 'u1', owner: 'acme', repo: 'web', github_installation_id: 7 }, deps);
  await assert.rejects(() => client.fetchCommits('acme', 'web'), (err) => err === gone);
  assert.deepStrictEqual(cleared, []);
});
